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
const CODES_FILE = path.join(config.dataDir, 'codes.json');
export const MEDIA_DIR = path.join(config.dataDir, 'media');

/* ------------------------------ الحالة ------------------------------ */

const blank = () => ({ users: [], posts: [], messages: [], statuses: [] });
let db = blank();

/** أكواد التحقق النشطة. */
const codes = new Map(); // phone -> { code, expires, tries, lastSent }

function persistCodes() {
  try {
    const obj = {};
    const now = Date.now();
    for (const [p, val] of codes.entries()) {
      if (val && val.expires > now) obj[p] = val;
    }
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(CODES_FILE, JSON.stringify(obj), 'utf8');
  } catch { /* أفضل جهد */ }
}

function loadCodes() {
  try {
    if (fs.existsSync(CODES_FILE)) {
      const obj = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
      const now = Date.now();
      for (const [p, val] of Object.entries(obj)) {
        if (val && val.expires > now) codes.set(p, val);
      }
    }
  } catch { /* تجاهل */ }
}

/* ----------------------------- التحميل ------------------------------ */

function isValidHttpUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  loadCodes();
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = {
      users: Array.isArray(raw?.users) ? raw.users : [],
      posts: Array.isArray(raw?.posts) ? raw.posts : [],
      messages: Array.isArray(raw?.messages) ? raw.messages : [],
      statuses: Array.isArray(raw?.statuses) ? raw.statuses : [],
    };
  } catch {
    db = blank(); // أول تشغيل أو ملف تالف → نبدأ من جديد
  }
  if (remoteOn) {
    // النسخة البعيدة هي المصدر الصحيح على الاستضافات المؤقتة
    fetch(`${config.supabaseUrl}/rest/v1/app_state?id=eq.main&select=data`, {
      headers: sbHeaders(),
      signal: AbortSignal.timeout(6000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => {
        const remote = rows?.[0]?.data;
        if (remote && Array.isArray(remote.users) && remote.users.length) {
          db = {
            users: Array.isArray(remote.users) ? remote.users : [],
            posts: Array.isArray(remote.posts) ? remote.posts : [],
            messages: Array.isArray(remote.messages) ? remote.messages : [],
            statuses: Array.isArray(remote.statuses) ? remote.statuses : [],
          };
          console.log(`تم تحميل الحالة من Supabase (${db.users.length} أعضاء، ${db.messages.length} رسالة)`);
        } else if (remote) {
          db = {
            users: Array.isArray(remote.users) ? remote.users : [],
            posts: Array.isArray(remote.posts) ? remote.posts : [],
            messages: Array.isArray(remote.messages) ? remote.messages : [],
            statuses: Array.isArray(remote.statuses) ? remote.statuses : [],
          };
        }
      })
      .catch(() => {
        // فشل الاتصال بقاعدة Supabase الاختيارية — الاعتماد على التخزين المحلي
      });
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

const remoteOn = !!(config.supabaseUrl && config.supabaseKey && isValidHttpUrl(config.supabaseUrl));
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
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok || res.status === 201) remoteDirty = false;
  } catch {
    // Supabase اختياري — إذا فشل الحفظ الخارجي لا تتأثر العمليات المحلية
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
  persistCodes();
  return codes.get(phone);
}
export function clearCode(phone) {
  codes.delete(phone);
  persistCodes();
}

/** تنظيف دوري: لا نحذف الأكواد تلقائياً لضمان عدم انتهاء الصلاحية. */
export function pruneCodes() {
  /* تم إيقاف انتهاء الصلاحية بناءً على طلب المستخدم */
}

/* ----------------------------- المستخدمون ---------------------------- */

export const members = () => (Array.isArray(db?.users) ? db.users : []);
export const seatsLeft = () => Math.max(0, config.maxMembers - members().length);

export function userByPhone(phone) {
  return members().find((u) => u && u.phone === phone) || null;
}
export function userByToken(token) {
  if (!token) return null;
  const h = hashToken(token);
  return members().find((u) => u && u.tokenHash === h) || null;
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

/** حذف عضو من الدائرة + منشوراته ورسائله. */
export function removeUser(user) {
  // حذف المنشورات والتعليقات الخاصة بالعضو
  for (const p of db.posts.filter((x) => x.userId === user.id)) {
    removePost(p);
  }
  // حذف التعليقات على منشورات الآخرين
  for (const p of db.posts) {
    p.comments = p.comments.filter((c) => c.userId !== user.id);
  }
  // حذف رسائل العضو
  for (const m of db.messages.filter((x) => x.userId === user.id)) {
    removeMessage(m);
  }
  // إزالة العضو من قائمة المقروء
  for (const m of db.messages) {
    if (m.readBy) m.readBy = m.readBy.filter((id) => id !== user.id);
  }
  // إزالة الإعجابات
  for (const p of db.posts) {
    p.likes = p.likes.filter((id) => id !== user.id);
  }
  db.users = db.users.filter((u) => u.id !== user.id);
  save();
}

/* ---------------------------- البحث ------------------------------ */

export function searchPosts(query) {
  const q = query.toLowerCase();
  return db.posts.filter((p) => p.text.toLowerCase().includes(q));
}

export function searchMessages(query) {
  const q = query.toLowerCase();
  return db.messages.filter((m) => m.text.toLowerCase().includes(q));
}

export function setChatBackground(user, bg) {
  user.chatBackground = bg; // { file, url } or null
  save();
}

/** ما يُرسل للعملاء (بدون أي أسرار). */
export const publicUser = (u) => ({
  id: u.id,
  phone: u.phone,
  name: u.name,
  createdAt: u.createdAt,
  lastSeen: u.lastSeen,
  chatBackground: u.chatBackground || null,
});

/* ------------------------- المنشورات والتعليقات ----------------------- */

export const posts = () => (Array.isArray(db?.posts) ? db.posts : []);

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

export const messages = () => (Array.isArray(db?.messages) ? db.messages : []);

export function addMessage(user, { text, photo, audio, replyTo }) {
  const msg = {
    id: uid(),
    userId: user.id,
    text: text || '',
    photo: photo || null,
    audio: audio || null, // { file, url, duration }
    replyTo: replyTo || null, // { id, authorName, text }
    reactions: {}, // { "👍": [userId1, ...] }
    readBy: [user.id], // صاحب الرسالة يقرأها تلقائياً
    createdAt: Date.now(),
  };
  db.messages.push(msg);
  prune();
  save();
  return msg;
}

/** علّم الرسالة كمقروءة من المستخدم */
export function markRead(msg, userId) {
  if (!msg.readBy) msg.readBy = [];
  if (!msg.readBy.includes(userId)) {
    msg.readBy.push(userId);
    save();
  }
  return msg.readBy;
}

export function toggleMessageReaction(msg, userId, emoji) {
  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
  const idx = msg.reactions[emoji].indexOf(userId);
  if (idx >= 0) {
    msg.reactions[emoji].splice(idx, 1);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
  } else {
    // إزالة أي تفاعل سابق لنفس المستخدم ليبقى تفاعل واحد كواتساب
    for (const em of Object.keys(msg.reactions)) {
      msg.reactions[em] = msg.reactions[em].filter((id) => id !== userId);
      if (msg.reactions[em].length === 0) delete msg.reactions[em];
    }
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    msg.reactions[emoji].push(userId);
  }
  save();
  return msg.reactions;
}

export function messageById(id) {
  return messages().find((m) => m && m.id === id) || null;
}

export function removeMessage(msg) {
  db.messages = messages().filter((m) => m && m.id !== msg.id);
  if (msg.photo) deleteMedia(msg.photo.file);
  if (msg.audio) deleteMedia(msg.audio.file);
  save();
}

/* ----------------------- الحالات والمستجدات (Status) ------------------- */

export const statuses = () => {
  if (!Array.isArray(db?.statuses)) db.statuses = [];
  const valid24h = Date.now() - 24 * 60 * 60 * 1000;
  return db.statuses.filter((s) => s && s.createdAt > valid24h);
};

export function addStatus(user, { text, photo, bgColor }) {
  if (!db.statuses) db.statuses = [];
  const status = {
    id: uid(),
    userId: user.id,
    text: text || '',
    photo: photo || null,
    bgColor: bgColor || '#008069',
    viewers: [user.id],
    createdAt: Date.now(),
  };
  db.statuses.push(status);
  save();
  return status;
}

export function viewStatus(status, userId) {
  if (!status.viewers) status.viewers = [];
  if (!status.viewers.includes(userId)) {
    status.viewers.push(userId);
    save();
  }
  return status.viewers;
}

export function statusById(id) {
  if (!db.statuses) return null;
  return db.statuses.find((s) => s.id === id) || null;
}

export function removeStatus(status) {
  if (!db.statuses) return;
  db.statuses = db.statuses.filter((s) => s.id !== status.id);
  if (status.photo) deleteMedia(status.photo.file);
  save();
}

/* -------------------------------- الصور والوسائط ------------------------------ */

export function saveMedia(bytes, ext = 'jpg', mime = 'image/jpeg') {
  const file = uid() + '.' + ext;
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, file), bytes);
  } catch (err) {
    console.error('local media save error:', err?.message || err);
  }

  if (remoteOn) {
    fetch(`${config.supabaseUrl}/storage/v1/object/media/${file}`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Content-Type': mime },
      body: bytes,
      signal: AbortSignal.timeout(10000),
    }).catch(() => {
      // Supabase storage اختياري — لا توقف العمليات المحلية في حالة عدم توفره
    });
  }

  return { file, url: '/media/' + file };
}

function deleteMedia(file) {
  if (!file) return;
  try {
    fs.unlinkSync(path.join(MEDIA_DIR, file));
  } catch { /* غير موجود */ }

  if (remoteOn) {
    fetch(`${config.supabaseUrl}/storage/v1/object/media/${file}`, {
      method: 'DELETE',
      headers: sbHeaders(),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }
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
