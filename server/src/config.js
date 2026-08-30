/**
 * ماسنجر لايت — إعدادات السيرفر.
 * كل قيمة يمكن تغييرها بمتغير بيئة، ولا يوجد أي اعتماد على مكتبات خارجية.
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

  /** اسم الدائرة (يظهر في شاشة الدخول). */
  appName: process.env.APP_NAME || 'ماسنجر لايت',

  /** الحد الأقصى لعدد الأعضاء — التطبيق مخصص لدائرة صغيرة فقط. */
  maxMembers: Math.max(2, int(process.env.MAX_MEMBERS, 5)),

  /**
   * رمز انضمام اختياري: إذا ضُبط فلن يستطيع أحد التسجيل إلا من يعرفه.
   * يمنع الغرباء من احتلال مقاعد الدائرة (لأن الكود يظهر داخل التطبيق
   * في وضع الدائرة الخاصة بدون مزوّد SMS).
   */
  joinCode: (process.env.JOIN_CODE || '').trim(),

  /** مجلد البيانات (قاعدة JSON + الصور). */
  dataDir: process.env.DATA_DIR || join(ROOT, 'data'),
  webDir: process.env.WEB_DIR || join(ROOT, '..', 'web'),

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

  /** مدة صلاحية كود التحقق (دقائق) ومحاولات إدخاله والفاصل بين الطلبات. */
  codeTtlMs: int(process.env.CODE_TTL_MIN, 10) * 60 * 1000,
  codeMaxTries: 6,
  codeResendMs: int(process.env.CODE_RESEND_MS, 25000),
};

/** رقم هاتف موحّد: أرقام فقط (مع رمز الدولة) بين ٧ و١٥ رقماً. */
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}
