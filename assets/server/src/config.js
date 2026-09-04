/**
 * ماسنجر لايت — إعدادات السيرفر (نسخة مفتوحة).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

const int = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',

  appName: process.env.APP_NAME || 'ماسنجر لايت',

  /** فتح التسجيل لأي شخص — غير محدود */
  maxMembers: Infinity,

  /** بدون رمز انضمام — مفتوح للجميع */
  joinCode: '',

  dataDir: process.env.DATA_DIR || join(ROOT, 'data'),
  webDir: process.env.WEB_DIR || join(ROOT, '..', 'web'),

  retention: {
    messages: int(process.env.MAX_MESSAGES, 5000),
    posts: int(process.env.MAX_POSTS, 500),
  },

  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',

  maxPhotoBytes: int(process.env.MAX_PHOTO_KB, 400) * 1024,

  codeTtlMs: 365 * 24 * 60 * 60 * 1000,
  codeMaxTries: 100,
  codeResendMs: 2000,
};

export function toAsciiDigits(str) {
  return String(str ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

export function normalizePhone(raw) {
  const digits = toAsciiDigits(raw).replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}
