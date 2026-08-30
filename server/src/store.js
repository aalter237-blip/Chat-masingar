/**
 * ماسنجر لايت — مخزن بيانات بملف JSON واحد (+ مجلد صغير للصور).
 *
 * التطبيق مصمم لدائرة من ٥ أشخاص فقط، لذلك لا حاجة لقاعدة بيانات
 * ثقيلة: ملف JSON واحد أصغر وأخف من أي قاعدة، ويُحفظ تلقائياً بعد
 * كل تعديل. الأرشيف يُقلَّم باستمرار (آخر N منشور/رسالة) حتى لا
 * يكبر حجم التخزين مع الوقت.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { config } from './config.js';

const DB_FILE = path.join(config.dataDir, 'app.json');
export const MEDIA_DIR = path.join(config.dataDir, 'media');

/* ------------------------------ الحالة ------------------------------ */

const blank = () => ({ users: [], posts: [], messages: [] });
let db = blank();

/** أكواد التحقق في الذاكرة فقط — لا تُحفظ على القرص. */
const codes = new Map(); // phone -> { code, expires, tries, lastSent }

/* ----------------------------- التحميل ------------------------------ */

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = { ...blank(), ...raw };
  } catch {
    db = blank(); // أول تشغيل أو ملف تالف → نبدأ من جديد
  }
  if (remoteOn) {
    // النسخة البعيدة هي المصدر الصحيح على الاستضافات المؤقتة
    fetch(`${config.supabaseUrl}/rest/v1/app_state?id=eq.main&select=data`, {
      headers: sbHeaders(),
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => {
        const remote = rows?.[0]?.data;
        if (remote && Array.isArray(remote.users) && remote.users.length) {
          db = { ...blank(), ...remote };
          console.log(`تم تحميل الحالة من Supabase (${db.users.length} أعضاء، ${db.messages.length} رسالة)`);
        } else if (remote) {
          db = { ...blank(), ...remote };
        }
      })
      .catch((e) => console.error('remote load error:', e.message));
  }
}

/* ------------------------------ الحفظ ------------------------------- */

let saveTimer = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      console.error('save failed:', err.message);
    }
  }, 200);
  scheduleRemoteSave();
}

export function flushSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db), 'utf8');
  } catch { /* أفضل جهد */ }
}

/* ------------------- حفظ خارجي اختياري (Supabase) --------------------
 *
 * للاستضافات المجانية التي تمسح القرص عند إعادة التشغيل (Render وغيرها):
 * الحالة كاملة (أعضاء/منشورات/رسائل) تُحفظ كسطر واحد في جدول app_state،
 * والصور في حاوية storage باسم media — بدون أي مكتبة إضافية (fetch فقط).
 * إذا لم تُضبط المتغيرات يعمل التطبيق محلياً كما هو تماماً.
 * ------------------------------------------------------------------ */

const remoteOn = !!(config.supabaseUrl && config.supabaseKey);
let remoteTimer = null;
let remoteDirty = false;

const sbHeaders = (json = false) => ({
  Authorization: `Bearer ${config.supabaseKey}`,
  apikey: config.supabaseKey,
  ...(json ? { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' } : {}),
});

function scheduleRemoteSave() {
  if (!remoteOn) return;
  remoteDirty = true;
  if (remoteTimer) return;
  remoteTimer = setTimeout(async () => {
    remoteTimer = null;
    await flushRemote();
  }, 3000);
}

/** يرفع الحالة الحالية إلى Supabase (أفضل جهد). */
export async function flushRemote() {
  if (!remoteOn || !remoteDirty) return;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/app_state`, {
      method: 'POST',
      headers: sbHeaders(true),
      body: JSON.stringify({ id: 'main', data: db, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok || res.status === 201) remoteDirty = false;
    else console.error('remote save failed:', res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.error('remote save error:', err.message); // تُعاد المحاولة مع الحفظ التالي
  }
}

/** شبكة أمان: رفع دوري كل دقيقة إذا بقيت تغييرات غير مرفوعة. */
if (remoteOn) {
  setInterval(() => { if (remoteDirty && !remoteTimer) flushRemote(); }, 60_000).unref();
}

/* ------------------------------ أدوات ------------------------------- */

export const uid = () => randomUUID().slice(0, 12);
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

export function newToken() {
  const token = randomBytes(24).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

/* -------------------------- أكواد التحقق ---------------------------- */

export function codeFor(phone) {
  return codes.get(phone) || null;
}
export function setCode(phone) {
  const code = String(randomBytes(3).readUIntBE(0, 3) % 1000000).padStart(6, '0');
  codes.set(phone, { code, expires: Date.now() + config.codeTtlMs, tries: 0, lastSent: Date.now() });
  return codes.get(phone);
}
export function clearCode(phone) {
  codes.delete(phone);
}

/** تنظيف دوري: أكواد منتهية الصلاحية لا تبقى في الذاكرة (للعمل المتواصل ٢٤/٧). */
export function pruneCodes() {
  const now = Date.now();
  for (const [phone, entry] of codes) {
    if (now > entry.expires) codes.delete(phone);
  }
}

/* ----------------------------- المستخدمون ---------------------------- */

export const members = () => db.users;
export const seatsLeft = () => Math.max(0, config.maxMembers - db.users.length);

export function userByPhone(phone) {
  return db.users.find((u) => u.phone === phone) || null;
}
export function userByToken(token) {
  if (!token) return null;
  const h = hashToken(token);
  return db.users.find((u) => u.tokenHash === h) || null;
}

export function addUser({ phone, name }) {
  const { token, tokenHash } = newToken();
  const user = {
    id: uid(),
    phone,
    name,
    tokenHash,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  db.users.push(user);
  save();
  return { user, token };
}

/** جلسة جديدة لمستخدم قائم (تُبطل أي جلسة سابقة لنفس الحساب). */
export function issueToken(user) {
  const { token, tokenHash } = newToken();
  user.tokenHash = tokenHash;
  save();
  return { token };
}

export function touchUser(user) {
  user.lastSeen = Date.now();
  save();
}

export function renameUser(user, name) {
  user.name = name;
  save();
}

/** ما يُرسل للعملاء (بدون أي أسرار). */
export const publicUser = (u) => ({
  id: u.id,
  phone: u.phone,
  name: u.name,
  createdAt: u.createdAt,
  lastSeen: u.lastSeen,
});

/* ------------------------- المنشورات والتعليقات ----------------------- */

export const posts = () => db.posts;

export function addPost(user, { text, photo }) {
  const post = {
    id: uid(),
    userId: user.id,
    text: text || '',
    photo: photo || null, // { file, url }
    likes: [],
    comments: [],
    createdAt: Date.now(),
  };
  db.posts.push(post);
  prune();
  save();
  return post;
}

export function postById(id) {
  return db.posts.find((p) => p.id === id) || null;
}

export function removePost(post) {
  db.posts = db.posts.filter((p) => p.id !== post.id);
  if (post.photo) deleteMedia(post.photo.file);
  save();
}

export function toggleLike(post, userId) {
  const i = post.likes.indexOf(userId);
  if (i >= 0) post.likes.splice(i, 1);
  else post.likes.push(userId);
  save();
  return [...post.likes];
}

export function addComment(post, user, text) {
  const comment = { id: uid(), userId: user.id, text, createdAt: Date.now() };
  post.comments.push(comment);
  save();
  return comment;
}

/* ------------------------------ الدردشة ------------------------------ */

export const messages = () => db.messages;

export function addMessage(user, { text, photo }) {
  const msg = {
    id: uid(),
    userId: user.id,
    text: text || '',
    photo: photo || null,
    createdAt: Date.now(),
  };
  db.messages.push(msg);
  prune();
  save();
  return msg;
}

export function messageById(id) {
  return db.messages.find((m) => m.id === id) || null;
}

export function removeMessage(msg) {
  db.messages = db.messages.filter((m) => m.id !== msg.id);
  if (msg.photo) deleteMedia(msg.photo.file);
  save();
}

/* -------------------------------- الصور ------------------------------ */

export function saveMedia(bytes) {
  const file = uid() + '.jpg';
  if (remoteOn) {
    // رفع مباشر إلى Supabase Storage (حاوية media) — الرابط عام للقراءة
    fetch(`${config.supabaseUrl}/storage/v1/object/media/${file}`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Content-Type': 'application/octet-stream' },
      body: bytes,
      signal: AbortSignal.timeout(15000),
    }).catch((e) => console.error('media upload error:', e.message));
    return { file, url: `${config.supabaseUrl}/storage/v1/object/public/media/${file}` };
  }
  fs.writeFileSync(path.join(MEDIA_DIR, file), bytes);
  return { file, url: '/media/' + file };
}

function deleteMedia(file) {
  if (!file) return;
  if (remoteOn) {
    fetch(`${config.supabaseUrl}/storage/v1/object/media/${file}`, {
      method: 'DELETE',
      headers: sbHeaders(),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
    return;
  }
  try {
    fs.unlinkSync(path.join(MEDIA_DIR, file));
  } catch { /* غير موجود */ }
}

/* ------------------------------ الأرشفة ------------------------------ */

/**
 * تُبقي آخر N رسالة وآخر N منشوراً فقط، وتحذف صور المنشورات المحذوفة
 * — هكذا يبقى حجم التخزين بضع ميجابايت فقط مهما طال الاستخدام.
 */
function prune() {
  let changed = false;

  if (db.messages.length > config.retention.messages) {
    const dropped = db.messages.slice(0, db.messages.length - config.retention.messages);
    for (const m of dropped) if (m.photo) deleteMedia(m.photo.file);
    db.messages = db.messages.slice(-config.retention.messages);
    changed = true;
  }

  if (db.posts.length > config.retention.posts) {
    const dropped = db.posts.slice(0, db.posts.length - config.retention.posts);
    for (const p of dropped) if (p.photo) deleteMedia(p.photo.file);
    db.posts = db.posts.slice(-config.retention.posts);
    changed = true;
  }
  if (changed) save();
}
