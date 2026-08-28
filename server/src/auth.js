import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { log, randomCode, safeEqual, now } from './util.js';
import * as store from './store.js';

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
 * Send a verification code.
 * provider 'none'   -> code is returned to the caller (development / demo)
 * provider 'console'-> code is printed in the server log
 * provider 'twilio' -> Twilio Verify / Messages API
 * provider 'http'   -> generic POST {to, code} webhook
 */
export async function sendOtp(phone) {
  const code = randomCode();
  const expires = now() + config.otpTtlMs;
  store.saveOtp(phone, code, expires);

  let delivered = false;
  try {
    if (config.smsProvider === 'twilio' && config.twilioSid && config.twilioToken) {
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
      if (!res.ok) log('sms: twilio error', res.status, await res.text().catch(() => ''));
    } else if (config.smsProvider === 'http' && config.smsHttpUrl) {
      const res = await fetch(config.smsHttpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: config.smsHttpToken ? `Bearer ${config.smsHttpToken}` : '' },
        body: JSON.stringify({ to: '+' + phone, phone: '+' + phone, code, app: 'masingar' }),
      });
      delivered = res.ok;
      if (!res.ok) log('sms: webhook error', res.status);
    } else if (config.smsProvider === 'console') {
      log(`sms: verification code for +${phone} is ${code}`);
      delivered = true;
    } else {
      // 'none' - development mode: the API response carries the code.
      log(`sms: [dev mode] verification code for +${phone} is ${code}`);
    }
  } catch (err) {
    log('sms: send failed ->', err.message);
  }
  return { code, expires, delivered, provider: config.smsProvider };
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
