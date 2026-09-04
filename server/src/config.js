/**
 * ماسنجر لايت — إعدادات السيرفر.
 * كل قيمة يمكن تغييرها بمتغير بيئة، ولا يوجد أي اعتماد على مكتبات خارجية.
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

/* تحميل متغيرات البيئة من ملف .env تلقائياً إن وجد لدعم WispByte والسيرفرات المحلية */
function loadDotEnv() {
  const candidates = [
    join(process.cwd(), '.env'),
    join(ROOT, '..', '.env'),
    join(ROOT, '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
      } catch { /* أفضل جهد */ }
      break;
    }
  }
}
loadDotEnv();

const int = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};

function resolveWebDir() {
  const candidates = [
    process.env.WEB_DIR && fs.existsSync(join(process.env.WEB_DIR, 'index.html')) ? process.env.WEB_DIR : null,
    process.env.WEB_DIR && fs.existsSync(join(process.env.WEB_DIR, 'web', 'index.html')) ? join(process.env.WEB_DIR, 'web') : null,
    join(ROOT, '..', 'web'),
    join(ROOT, 'web'),
    join(process.cwd(), 'web'),
    process.cwd(),
  ].filter(Boolean);

  for (const dir of candidates) {
    const absDir = resolve(dir);
    if (fs.existsSync(join(absDir, 'index.html'))) {
      return absDir;
    }
  }
  return resolve(ROOT, '..', 'web');
}

function resolveDataDir() {
  if (process.env.DATA_DIR) return resolve(process.env.DATA_DIR);
  if (fs.existsSync(join(process.cwd(), 'data'))) return join(process.cwd(), 'data');
  if (fs.existsSync(join(ROOT, 'data'))) return join(ROOT, 'data');
  return join(process.cwd(), 'data');
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  /** دعم متغيرات البورت القياسية بما فيها SERVER_PORT المخصص للوحة WispByte و Pterodactyl */
  port: int(process.env.PORT || process.env.SERVER_PORT, 3000),
  host: process.env.HOST || process.env.SERVER_IP || '0.0.0.0',

  /** اسم الدائرة (يظهر في شاشة الدخول). */
  appName: process.env.APP_NAME || 'ماسنجر لايت',

  /** الحد الأقصى لعدد الأعضاء — غير محدود دائماً */
  maxMembers: Infinity,

  /** لا يوجد رمز انضمام — الدخول والتسجيل برقم الهاتف والاسم مباشرة. */
  joinCode: '',

  /** مجلد البيانات (قاعدة JSON + الصور). */
  dataDir: resolveDataDir(),
  webDir: resolveWebDir(),

  /** أرشفة صغيرة تلقائية (آخر N عنصر يُحفظ). */
  retention: {
    messages: int(process.env.MAX_MESSAGES, 1000),
    posts: int(process.env.MAX_POSTS, 200),
  },

  /**
   * حفظ خارجي اختياري عبر Supabase (مجاني وبلا بطاقة):
   * يُستخدم مع الاستضافات المجانية التي تمسح القرص عند إعادة التشغيل
   * (مثل Render) — بدونه تبقى البيانات على قرص السيرفر فقط.
   */
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',

  /** أقصى حجم لصورة واحدة بعد ضغطها في المتصفح. */
  maxPhotoBytes: int(process.env.MAX_PHOTO_KB, 300) * 1024,

  /** مدة صلاحية كود التحقق (بدون انتهاء — يبقى الكود صالحاً حتى استخدامه). */
  codeTtlMs: 365 * 24 * 60 * 60 * 1000, // عام كامل (بدون انتهاء)
  codeMaxTries: 100, // عدد محاولات كبير لمنع الإغلاق الخاطئ
  codeResendMs: 2000, // إمكانية إعادة الطلب فوراً
};

/** تحويل الأرقام العربية والفارسية إلى أرقام إنجليزية قياسية. */
export function toAsciiDigits(str) {
  return String(str ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

/** رقم هاتف موحّد: أرقام فقط (مع رمز الدولة) بين ٧ و١٥ رقماً. */
export function normalizePhone(raw) {
  const digits = toAsciiDigits(raw).replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}
