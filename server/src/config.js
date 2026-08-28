/**
 * Masingar Chat - server configuration.
 * Every value can be overridden with an environment variable.
 * Kept dependency free on purpose (no dotenv) so the server boots anywhere.
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

const secret = process.env.JWT_SECRET || randomBytes(48).toString('hex');

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

  /** OTP behaviour: 'none' (dev, code returned in API) | 'console' | 'twilio' | 'http' */
  smsProvider: process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? 'console' : 'none'),
  smsHttpUrl: process.env.SMS_HTTP_URL || '',
  smsHttpToken: process.env.SMS_HTTP_TOKEN || '',
  twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFrom: process.env.TWILIO_FROM || '',
  otpLength: Number(process.env.OTP_LENGTH || 6),
  otpTtlMs: Number(process.env.OTP_TTL_MS || 5 * 60 * 1000),

  /** Demo users are created on first boot when the users table is empty. */
  demoSeed: process.env.DEMO_SEED !== 'false',

  /** TURN / STUN */
  turnSecret: process.env.TURN_SECRET || '',
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
