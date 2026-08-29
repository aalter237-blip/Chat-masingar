/**
 * Masingar Chat - server configuration.
 * Every value can be overridden with an environment variable.
 * Kept dependency free on purpose (no dotenv) so the server boots anywhere.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

/**
 * JWT signing secret.
 *
 * Best: set JWT_SECRET explicitly via the environment.
 * Fallback: a random secret is generated on first boot and persisted to
 * `data/.jwt-secret` (mode 0600), so user sessions survive server restarts
 * even when no environment variable was configured.
 */
function loadOrCreateJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = join(ROOT, 'data', '.jwt-secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* first boot: create below */ }
  const generated = randomBytes(48).toString('hex');
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(file, generated + '\n', { mode: 0o600 });
  return generated;
}
const secret = loadOrCreateJwtSecret();

/**
 * TextBee credentials (https://textbee.dev) - read ONLY from the environment.
 * No credentials live in the source tree: put your API key in deploy/.env.
 * (The key that was committed here before is compromised - rotate it in the
 * TextBee dashboard if you ever used it.)
 */
const textbeeKey = process.env.TEXTBEE_API_KEY || '';
const textbeeDevice = process.env.TEXTBEE_DEVICE_ID || '';

/** With a gateway configured the verification code is sent as a real SMS. */
const smsDefault = textbeeKey
  ? 'textbee'
  : (process.env.NODE_ENV === 'production' ? 'console' : 'none');

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  /** Public base URL used to build media links (set it in production). */
  publicUrl: process.env.PUBLIC_URL || '',

  /** Database file (sqlite). */
  dbPath: process.env.DB_PATH || join(ROOT, 'data', 'masingar.db'),
  uploadsDir: process.env.UPLOADS_DIR || join(ROOT, 'uploads'),
  webDir: process.env.WEB_DIR || join(ROOT, '..', 'web'),

  jwtSecret: secret,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '90d',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || '365d',

  /** Default country calling code used when a phone number has none. */
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '967',

  /**
   * OTP behaviour:
   *   'none'     -> dev, the verification code is returned by the API
   *   'console'  -> the code is printed in the server log
   *   'textbee'  -> sent as a real SMS through https://textbee.dev (your Android
   *                 phone acts as the gateway, messages leave from your SIM)
   *   'twilio'   -> Twilio Messages API
   *   'http'     -> generic POST {to, code, app} webhook
   *   'whatsapp' -> message delivered on WhatsApp through the official Meta
   *                 Cloud API (no QR code, no local gateway process)
   */
  smsProvider: process.env.SMS_PROVIDER || smsDefault,
  smsHttpUrl: process.env.SMS_HTTP_URL || '',
  smsHttpToken: process.env.SMS_HTTP_TOKEN || '',
  twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFrom: process.env.TWILIO_FROM || '',

  /** TextBee (https://textbee.dev) - Android phone as an SMS gateway. */
  textbeeApiKey: textbeeKey,
  textbeeDeviceId: textbeeDevice,

  /**
   * WhatsApp (https://developers.facebook.com/docs/whatsapp/cloud-api)
   * Business-initiated OTP messages MUST use an approved template, so we send
   * the code as the first body parameter of a configurable template. No QR code
   * is involved: the server talks straight to the Meta Cloud API.
   */
  whatsappBaseUrl: (process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || 'v20.0',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME || 'masingar_otp',
  whatsappTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar',
  whatsappTimeoutMs: Number(process.env.WHATSAPP_TIMEOUT_MS || 10000),
  whatsappRetries: Number(process.env.WHATSAPP_RETRIES ?? 1),
  whatsappRetryDelayMs: Number(process.env.WHATSAPP_RETRY_DELAY_MS || 1500),

  /**
   * The gateway forwards the message to a phone, so it can be slow or briefly
   * unreachable. Every attempt is bounded by a timeout, a failed attempt is
   * retried once, and a refusal from the gateway (4xx: bad key, unknown device,
   * no credits) is never retried because it would not change the answer.
   */
  textbeeTimeoutMs: Number(process.env.TEXTBEE_TIMEOUT_MS || 10000),
  textbeeRetries: Number(process.env.TEXTBEE_RETRIES ?? 1),
  textbeeRetryDelayMs: Number(process.env.TEXTBEE_RETRY_DELAY_MS || 1500),
  textbeeBaseUrl: (process.env.TEXTBEE_BASE_URL || 'https://api.textbee.dev').replace(/\/+$/, ''),

  /** Body of the verification SMS. `${code}` (or {{code}}) is replaced. */
  smsText: process.env.SMS_TEXT || 'ماسنجر: كود التحقق هو ${code}',
  otpLength: Number(process.env.OTP_LENGTH || 6),
  otpTtlMs: Number(process.env.OTP_TTL_MS || 5 * 60 * 1000),

  /**
   * Demo users are only created when this is switched on explicitly. A real
   * deployment has none: every account is a real phone number that verified
   * itself with a one time code.
   */
  demoSeed: process.env.DEMO_SEED === 'true',

  /**
   * True for a throwaway box: no SMS gateway is configured, so the server
   * hands the verification code back to whoever asks for it. Clients use it to
   * show the demo shortcuts; it must never be true on a real deployment.
   */
  demoMode: process.env.DEMO_SEED === 'true' || (process.env.SMS_PROVIDER || smsDefault) === 'none',

  /** TURN / STUN */
  turnSecret: process.env.TURN_SECRET || '',
  /**
   * When no private TURN (TURN_SECRET+TURN_HOST) is configured, hand clients
   * a zero-cost public relay so calls still connect on restrictive mobile
   * networks. Set FREE_TURN=false once you run your own coturn only.
   */
  freeTurn: (process.env.FREE_TURN || 'true') !== 'false',
  turnUrls: (process.env.TURN_URLS ||
    'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  turnHost: process.env.TURN_HOST || '', // e.g. turn.example.com
  turnPort: Number(process.env.TURN_PORT || 3478),
  turnTlsPort: Number(process.env.TURN_TLS_PORT || 5349),
  turnTcpPort: Number(process.env.TURN_TCP_PORT || 443),
  turnRealm: process.env.TURN_REALM || 'masingar',
  turnCredentialTtl: Number(process.env.TURN_CREDENTIAL_TTL || 6 * 3600),

  /** Firebase Cloud Messaging (optional, needed for calls while the app is closed) */
  fcmProjectId: process.env.FCM_PROJECT_ID || '',
  fcmClientEmail: process.env.FCM_CLIENT_EMAIL || '',
  fcmPrivateKey: (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n'),

  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 32),
  /** Seconds without a websocket ping before a socket is dropped. */
  socketTimeout: Number(process.env.SOCKET_TIMEOUT || 70),

  logLevel: process.env.LOG_LEVEL || 'info',
};

export const isProd = config.env === 'production';
