import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { log, randomCode, safeEqual, now } from './util.js';
import * as store from './store.js';
import * as telegram from './telegram.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, phone: user.phone, typ: 'access' }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
  });
}

export function signRefreshToken(user, sessionId) {
  return jwt.sign({ sub: user.id, sid: sessionId, typ: 'refresh' }, config.jwtSecret, {
    expiresIn: config.refreshTokenTtl,
  });
}

export function verifyToken(token, expected = 'access') {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (expected && payload.typ !== expected) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------- OTP -------------------------------- */

/**
 * Body of the verification SMS (TextBee / Twilio).
 * `${code}` and `{{code}}` are replaced by the one time code.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one SMS through TextBee.
 *
 * @returns true when the gateway accepted the message. A refusal (4xx) is
 * reported immediately; a network error or a server error is retried.
 */
async function textbeeSend(phone, code) {
  const base = String(config.textbeeBaseUrl || 'https://api.textbee.dev').replace(/\/+$/, '');
  const url = config.textbeeDeviceId
    ? `${base}/api/v1/gateway/devices/${encodeURIComponent(config.textbeeDeviceId)}/send-sms`
    : `${base}/api/v1/gateway/send-sms`;
  const attempts = Math.max(1, Number(config.textbeeRetries) + 1);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.textbeeApiKey,
        },
        body: JSON.stringify({
          recipients: ['+' + phone],
          message: otpText(code),
        }),
        signal: AbortSignal.timeout(Number(config.textbeeTimeoutMs) || 10000),
      });

      if (res.ok) return true;

      const detail = (await res.text().catch(() => '')).slice(0, 200);
      if (res.status < 500) {
        log(`sms: textbee refused (${res.status})`, detail);
        return false;
      }
      log(`sms: textbee error ${res.status} (attempt ${attempt}/${attempts})`, detail);
    } catch (err) {
      log(`sms: textbee attempt ${attempt}/${attempts} failed ->`, err.message);
    }
    if (attempt < attempts) await sleep(Number(config.textbeeRetryDelayMs) || 1500);
  }
  return false;
}

export function otpText(code) {
  return String(config.smsText || '${code}')
    .replace(/\$\{code\}/g, code)
    .replace(/\{\{code\}\}/g, code);
}

/**
 * Send a verification code.
 *
 * Delivery chain (first success wins, so the code always reaches the user):
 *   1. telegram -> a Telegram message from the OTP bot to the chat that
 *                  linked the user's phone number (official Bot API)
 *   2. sms      -> the configured SMS provider (textbee / twilio / http)
 *   3. console  -> printed in the server log (used as a safety net whenever a
 *                  gateway is configured, so a login can never dead-end)
 *
 * The returned `channel` tells the client how the code was actually sent.
 */
export async function sendOtp(phone) {
  const code = randomCode();
  const expires = now() + config.otpTtlMs;
  store.saveOtp(phone, code, expires);

  const provider = config.smsProvider;
  let delivered = false;
  let deliveredVia = '';
  let lastError = '';

  // 1) Telegram bot (official API — primary channel when configured)
  if (config.telegramBotToken) {
    const r = await telegram.sendOtp(phone, code);
    if (r.ok) {
      delivered = true;
      deliveredVia = 'telegram';
    } else {
      lastError = r.error || 'telegram غير متاح';
      log(`otp: telegram delivery to +${phone} failed -> ${lastError}`);
    }
  }

  // 2) SMS providers
  if (!delivered && provider === 'textbee' && config.textbeeApiKey) {
    delivered = await textbeeSend(phone, code);
    if (delivered) deliveredVia = 'textbee';
    else if (!delivered) log(`sms: textbee could not deliver the code to +${phone}`);
  }
  if (!delivered && provider === 'twilio' && config.twilioSid && config.twilioToken) {
    const basic = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64');
    const body = new URLSearchParams({
      To: '+' + phone,
      From: config.twilioFrom || 'Masingar',
      Body: `Masingar code: ${code}`,
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    delivered = res.ok;
    if (delivered) deliveredVia = 'twilio';
    else log('sms: twilio error', res.status, await res.text().catch(() => ''));
  }
  if (!delivered && provider === 'http' && config.smsHttpUrl) {
    const res = await fetch(config.smsHttpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: config.smsHttpToken ? `Bearer ${config.smsHttpToken}` : '' },
      body: JSON.stringify({ to: '+' + phone, phone: '+' + phone, code, app: 'masingar' }),
    });
    delivered = res.ok;
    if (delivered) deliveredVia = 'http';
    else log('sms: webhook error', res.status);
  }

  // 3) Console safety net: whenever a gateway is configured but failed, print
  // the code in the server log so the admin can still log the user in.
  if (!delivered && (provider === 'console' || provider === 'telegram' || config.telegramBotToken)) {
    log(`otp: verification code for +${phone} is ${code}${lastError ? ` (telegram failed: ${lastError})` : ''}`);
    delivered = true;
    deliveredVia = 'console';
  }

  if (!delivered) log(`otp: no channel could deliver the code to +${phone}`);
  return { code, expires, delivered, provider, channel: deliveredVia, error: delivered ? undefined : lastError };
}

export function checkOtp(phone, code) {
  const rec = store.readOtp(phone);
  if (!rec) return { ok: false, reason: 'not_found' };
  if (now() > rec.expires) {
    store.clearOtp(phone);
    return { ok: false, reason: 'expired' };
  }
  if (rec.attempts >= 8) return { ok: false, reason: 'too_many_attempts' };
  if (!safeEqual(rec.code, String(code || '').trim())) {
    store.bumpOtpAttempts(phone);
    return { ok: false, reason: 'invalid' };
  }
  store.clearOtp(phone);
  return { ok: true };
}

/* --------------------------- issue session --------------------------- */

export function issueSession(user, device = '') {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user, 'pending');
  const expires = now() + 365 * 24 * 3600 * 1000;
  const sessionId = store.createSession(user.id, refreshToken, expires, device);
  const finalRefresh = signRefreshToken(user, sessionId);
  // refresh token embeds the session id, so re-write it once the row exists
  store.deleteSession(refreshToken);
  store.createSession(user.id, finalRefresh, expires, device);
  return {
    accessToken,
    refreshToken: finalRefresh,
    expiresIn: Math.floor((expires - now()) / 1000),
  };
}
