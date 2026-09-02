/**
 * ماسنجر لايت — واجهة REST مختصرة.
 *
 * المصادقة: رقم هاتف + كود تحقق. في وضع الدائرة الخاصة (بدون مزوّد SMS)
 * يظهر الكود مباشرة داخل التطبيق — لا رسائل ولا تكاليف. ويمكن حماية
 * التسجيل برمز انضمام (JOIN_CODE) حتى لا يدخل الغرباء.
 */
import express from 'express';
import { config, normalizePhone, toAsciiDigits } from './config.js';
import * as store from './store.js';
import { broadcast, onlineIds } from './realtime.js';

export const api = express.Router();

/* --------------------------- حماية الطلبات --------------------------- */

/** حماية بسيطة في الذاكرة: حد أقصى 10 طلبات تسجيل/تحقق لكل IP في الدقيقة. */
const rateBuckets = new Map();
function rateLimit(ip, key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const k = `${ip}:${key}`;
  let entry = rateBuckets.get(k);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    rateBuckets.set(k, entry);
  }
  entry.count++;
  return entry.count <= max;
}
/* تنظيف دوري لمنع تراكم الذاكرة */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) {
    if (now - v.start > 120_000) rateBuckets.delete(k);
  }
}, 60_000).unref?.();

/* --------------------------- أدوات مساعدة --------------------------- */

const cleanText = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

/** يستخرج صورة مضغوطة (data:image/jpeg;base64,...) ويتأكد أنها JPEG حقيقي. */
function parsePhoto(input) {
  if (!input) return { ok: true, photo: null };
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(input));
  if (!m) return { ok: false, status: 400, code: 'bad_photo', message: 'صيغة الصورة غير مدعومة (JPEG فقط)' };
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length < 100) return { ok: false, status: 400, code: 'bad_photo', message: 'الصورة فارغة' };
  if (bytes.length > config.maxPhotoBytes)
    return { ok: false, status: 413, code: 'photo_too_big', message: `الصورة أكبر من ${Math.round(config.maxPhotoBytes / 1024)} كيلوبايت` };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return { ok: false, status: 400, code: 'bad_photo', message: 'محتوى الصورة غير صالح' };
  return { ok: true, photo: store.saveMedia(bytes, 'jpg', 'image/jpeg') };
}

function parseAudio(input, duration = 0) {
  if (!input) return { ok: true, audio: null };
  const m = /^data:audio\/(webm|ogg|mp4|wav|aac|mpeg|mp3);base64,([A-Za-z0-9+/=]+)$/.exec(String(input));
  const rawBase64 = m ? m[2] : (String(input).includes('base64,') ? String(input).split('base64,')[1] : null);
  if (!rawBase64) return { ok: false, status: 400, code: 'bad_audio', message: 'صيغة الصوت غير صالحة' };
  const bytes = Buffer.from(rawBase64, 'base64');
  if (bytes.length < 50) return { ok: false, status: 400, code: 'bad_audio', message: 'التسجيل الصوتي فارغ' };
  if (bytes.length > 4 * 1024 * 1024)
    return { ok: false, status: 413, code: 'audio_too_big', message: 'التسجيل الصوتي أكبر من 4 ميجابايت' };
  const ext = m && m[1] === 'mpeg' ? 'mp3' : (m ? m[1] : 'webm');
  return { ok: true, audio: { ...store.saveMedia(bytes, ext, `audio/${ext}`), duration: Math.max(1, Math.round(Number(duration) || 1)) } };
}

function enrichAuthor(userId) {
  if (!userId) return { id: '', name: 'عضو' };
  const u = store.members().find((x) => x && x.id === userId);
  return { id: userId, name: u ? u.name : 'عضو سابق' };
}

const enrichPost = (p) => ({
  id: p.id || '',
  text: p.text || '',
  photo: p.photo?.url || null,
  likes: Array.isArray(p.likes) ? p.likes : [],
  comments: Array.isArray(p.comments) ? p.comments.map((c) => ({ ...c, author: enrichAuthor(c?.userId) })) : [],
  createdAt: p.createdAt || Date.now(),
  author: enrichAuthor(p.userId),
});

const enrichMessage = (m) => ({
  id: m.id || '',
  text: m.text || '',
  photo: m.photo?.url || null,
  audio: m.audio ? { url: m.audio.url, duration: m.audio.duration || 1 } : null,
  replyTo: m.replyTo || null,
  reactions: (typeof m.reactions === 'object' && m.reactions !== null) ? m.reactions : {},
  createdAt: m.createdAt || Date.now(),
  author: enrichAuthor(m.userId),
  readBy: Array.isArray(m.readBy) ? m.readBy : [m.userId],
});

const enrichStatus = (s) => ({
  id: s.id || '',
  text: s.text || '',
  photo: s.photo?.url || null,
  bgColor: s.bgColor || '#008069',
  viewers: Array.isArray(s.viewers) ? s.viewers : [],
  createdAt: s.createdAt || Date.now(),
  author: enrichAuthor(s.userId),
});

/* ------------------------ معلومات الدائرة (عام) ---------------------- */

api.get('/circle', (_req, res) => {
  res.json({
    ok: true,
    name: config.appName,
    members: store.members().length,
    total: config.maxMembers,
    joinCodeRequired: !!config.joinCode,
  });
});

/* ---------------------------- تسجيل الدخول --------------------------- */

api.post('/auth/request', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip, 'auth_request', 60)) return fail(res, 429, 'rate_limit', 'طلبات كثيرة جداً — انتظر قليلاً');
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return fail(res, 400, 'bad_phone', 'أدخل رقم هاتف صحيحاً مع رمز الدولة');

  const isMember = !!store.userByPhone(phone);
  if (!isMember && store.seatsLeft() <= 0) {
    return fail(res, 403, 'circle_full', `الدائرة مكتملة (${config.maxMembers}/${config.maxMembers}) — لا مزيد من الأعضاء`);
  }

  const prev = store.codeFor(phone);
  if (prev && Date.now() - prev.lastSent < config.codeResendMs) {
    return res.json({
      ok: true,
      phone,
      isMember,
      seatsLeft: store.seatsLeft(),
      code: prev.code,
    });
  }

  const entry = store.setCode(phone);
  res.json({
    ok: true,
    phone,
    isMember,
    seatsLeft: store.seatsLeft(),
    // وضع الدائرة الخاصة: لا مزوّد SMS — الكود يظهر داخل التطبيق.
    code: entry.code,
  });
});

api.post('/auth/verify', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip, 'auth_verify', 25)) return fail(res, 429, 'rate_limit', 'طلبات كثيرة جداً — انتظر قليلاً');
  const phone = normalizePhone(req.body?.phone);
  const code = toAsciiDigits(req.body?.code).replace(/[^0-9]/g, '').slice(0, 10);
  if (!phone) return fail(res, 400, 'bad_phone', 'رقم الهاتف غير صحيح');

  const entry = store.codeFor(phone);
  if (!entry) {
    return fail(res, 400, 'bad_code', 'لم يتم العثور على كود — اضغط على زر طلب كود جديد');
  }
  entry.tries = (entry.tries || 0) + 1;
  if (entry.tries > config.codeMaxTries) {
    store.clearCode(phone);
    return fail(res, 429, 'too_many', 'محاولات كثيرة خاطئة — اطلب كوداً جديداً');
  }
  if (code !== entry.code) return fail(res, 400, 'bad_code', 'الكود غير صحيح');

  let user = store.userByPhone(phone);
  let created = false;
  let token;

  if (!user) {
    if (store.seatsLeft() <= 0) {
      return fail(res, 403, 'circle_full', 'الدائرة مكتملة — لا مزيد من الأعضاء');
    }
    if (config.joinCode && cleanText(req.body?.joinCode, 40) !== config.joinCode) {
      return fail(res, 403, 'bad_join_code', 'رمز الانضمام غير صحيح');
    }
    const name = cleanText(req.body?.name, 30);
    if (!name || name.length < 2) return fail(res, 400, 'bad_name', 'اكتب اسمك (حرفان على الأقل)');
    ({ user, token } = store.addUser({ phone, name }));
    created = true;
  } else {
    // دخول من جديد → جلسة جديدة (تُبطل الجلسة القديمة على نفس الحساب)
    ({ token } = store.issueToken(user));
  }

  store.clearCode(phone); // مسح الكود فقط بعد نجاح الدخول أو التسجيل
  store.touchUser(user);
  broadcast({ type: 'members' });

  res.json({ ok: true, created, token, user: store.publicUser(user) });
});

/* ------------------------- حماية المسارات --------------------------- */

api.use((req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = store.userByToken(token);
  if (!user) return fail(res, 401, 'unauthorized', 'انتهت الجلسة — سجّل الدخول مرة أخرى');
  req.user = user;
  next();
});

/* ----------------------------- الحالة العامة -------------------------- */

api.get('/state', (req, res) => {
  res.json({
    ok: true,
    me: store.publicUser(req.user),
    members: store.members().map(store.publicUser),
    online: onlineIds(),
    posts: store.posts().map(enrichPost),
    messages: store.messages().map(enrichMessage),
    statuses: store.statuses().map(enrichStatus),
    circle: { name: config.appName, total: config.maxMembers },
  });
});

api.put('/me', (req, res) => {
  const name = cleanText(req.body?.name, 30);
  if (!name || name.length < 2) return fail(res, 400, 'bad_name', 'الاسم قصير جداً');
  store.renameUser(req.user, name);
  broadcast({ type: 'members' });
  res.json({ ok: true, me: store.publicUser(req.user) });
});

api.put('/chat-background', (req, res) => {
  const photo = req.body?.photo;
  if (!photo) {
    // إزالة الخلفية
    store.setChatBackground(req.user, null);
    broadcast({ type: 'members' });
    return res.json({ ok: true, me: store.publicUser(req.user) });
  }
  const r = parsePhoto(photo);
  if (!r.ok) return fail(res, r.status, r.code, r.message);
  store.setChatBackground(req.user, r.photo);
  broadcast({ type: 'members' });
  res.json({ ok: true, me: store.publicUser(req.user) });
});

/* ------------------------------ المنشورات ---------------------------- */

api.post('/posts', (req, res) => {
  const text = cleanText(req.body?.text, 2000);
  const r = parsePhoto(req.body?.photo);
  if (!r.ok) return fail(res, r.status, r.code, r.message);
  if (!text && !r.photo) return fail(res, 400, 'empty_post', 'اكتب شيئاً أو أرفق صورة');
  const post = store.addPost(req.user, { text, photo: r.photo });
  broadcast({ type: 'post', post: enrichPost(post) });
  res.json({ ok: true, post: enrichPost(post) });
});

api.post('/posts/:id/like', (req, res) => {
  const post = store.postById(req.params.id);
  if (!post) return fail(res, 404, 'not_found', 'المنشور غير موجود');
  const likes = store.toggleLike(post, req.user.id);
  broadcast({ type: 'like', id: post.id, likes });
  res.json({ ok: true, likes });
});

api.post('/posts/:id/comments', (req, res) => {
  const post = store.postById(req.params.id);
  if (!post) return fail(res, 404, 'not_found', 'المنشور غير موجود');
  const text = cleanText(req.body?.text, 500);
  if (!text) return fail(res, 400, 'empty_comment', 'اكتب تعليقاً');
  const comment = store.addComment(post, req.user, text);
  const out = { ...comment, author: enrichAuthor(comment.userId) };
  broadcast({ type: 'comment', postId: post.id, comment: out });
  res.json({ ok: true, comment: out });
});

api.delete('/posts/:id', (req, res) => {
  const post = store.postById(req.params.id);
  if (!post) return fail(res, 404, 'not_found', 'المنشور غير موجود');
  if (post.userId !== req.user.id) return fail(res, 403, 'forbidden', 'يمكنك حذف منشوراتك فقط');
  store.removePost(post);
  broadcast({ type: 'post_deleted', id: post.id });
  res.json({ ok: true });
});

/* ------------------------------- الدردشة ----------------------------- */

api.post('/messages', (req, res) => {
  const text = cleanText(req.body?.text, 1000);
  const rPhoto = parsePhoto(req.body?.photo);
  if (!rPhoto.ok) return fail(res, rPhoto.status, rPhoto.code, rPhoto.message);
  const rAudio = parseAudio(req.body?.audio, req.body?.duration);
  if (!rAudio.ok) return fail(res, rAudio.status, rAudio.code, rAudio.message);

  if (!text && !rPhoto.photo && !rAudio.audio) return fail(res, 400, 'empty_message', 'اكتب رسالة أو أرفق وسائط');

  let replyTo = null;
  if (req.body?.replyTo && typeof req.body.replyTo === 'object') {
    replyTo = {
      id: String(req.body.replyTo.id || ''),
      authorName: cleanText(req.body.replyTo.authorName, 40),
      text: cleanText(req.body.replyTo.text, 100),
    };
  }

  const msg = store.addMessage(req.user, { text, photo: rPhoto.photo, audio: rAudio.audio, replyTo });
  broadcast({ type: 'message', message: enrichMessage(msg) });
  res.json({ ok: true, message: enrichMessage(msg) });
});

api.post('/messages/:id/react', (req, res) => {
  const msg = store.messageById(req.params.id);
  if (!msg) return fail(res, 404, 'not_found', 'الرسالة غير موجودة');
  const emoji = cleanText(req.body?.emoji, 10);
  if (!emoji) return fail(res, 400, 'bad_emoji', 'حدد إيموجي للتفاعل');
  const reactions = store.toggleMessageReaction(msg, req.user.id, emoji);
  broadcast({ type: 'message_reaction', id: msg.id, reactions });
  res.json({ ok: true, reactions });
});

api.delete('/messages/:id', (req, res) => {
  const msg = store.messageById(req.params.id);
  if (!msg) return fail(res, 404, 'not_found', 'الرسالة غير موجودة');
  if (msg.userId !== req.user.id) return fail(res, 403, 'forbidden', 'يمكنك حذف رسائلك فقط');
  store.removeMessage(msg);
  broadcast({ type: 'message_deleted', id: msg.id });
  res.json({ ok: true });
});

api.post('/messages/:id/read', (req, res) => {
  const msg = store.messageById(req.params.id);
  if (!msg) return fail(res, 404, 'not_found', 'الرسالة غير موجودة');
  const readBy = store.markRead(msg, req.user.id);
  broadcast({ type: 'read', id: msg.id, readBy });
  res.json({ ok: true, readBy });
});

/* ----------------------- الحالات والمستجدات (Status) ------------------- */

api.get('/statuses', (_req, res) => {
  res.json({ ok: true, statuses: store.statuses().map(enrichStatus) });
});

api.post('/statuses', (req, res) => {
  const text = cleanText(req.body?.text, 500);
  const rPhoto = parsePhoto(req.body?.photo);
  if (!rPhoto.ok) return fail(res, rPhoto.status, rPhoto.code, rPhoto.message);
  const bgColor = cleanText(req.body?.bgColor, 20) || '#008069';

  if (!text && !rPhoto.photo) return fail(res, 400, 'empty_status', 'اكتب حالة أو أرفق صورة');

  const status = store.addStatus(req.user, { text, photo: rPhoto.photo, bgColor });
  broadcast({ type: 'status', status: enrichStatus(status) });
  res.json({ ok: true, status: enrichStatus(status) });
});

api.post('/statuses/:id/view', (req, res) => {
  const status = store.statusById(req.params.id);
  if (!status) return fail(res, 404, 'not_found', 'الحالة غير موجودة');
  const viewers = store.viewStatus(status, req.user.id);
  broadcast({ type: 'status_view', id: status.id, viewers });
  res.json({ ok: true, viewers });
});

api.delete('/statuses/:id', (req, res) => {
  const status = store.statusById(req.params.id);
  if (!status) return fail(res, 404, 'not_found', 'الحالة غير موجودة');
  if (status.userId !== req.user.id) return fail(res, 403, 'forbidden', 'يمكنك حذف حالتك فقط');
  store.removeStatus(status);
  broadcast({ type: 'status_deleted', id: status.id });
  res.json({ ok: true });
});

/* ----------------------------- البحث ------------------------------ */

api.get('/search', (req, res) => {
  const q = cleanText(req.query.q, 200);
  if (!q || q.length < 2) return fail(res, 400, 'bad_query', 'اكتب حرفين على الأقل للبحث');

  const posts = store.searchPosts(q).map(enrichPost);
  const messages = store.searchMessages(q).map(enrichMessage);

  // ترتيب حسب الأحدث أولاً
  posts.sort((a, b) => b.createdAt - a.createdAt);
  messages.sort((a, b) => b.createdAt - a.createdAt);

  res.json({ ok: true, posts, messages, total: posts.length + messages.length });
});

/* ------------------------ مغادرة الدائرة ---------------------------- */

api.delete('/me', (req, res) => {
  const userId = req.user.id;
  store.removeUser(req.user);
  broadcast({ type: 'members' });
  // توجيه العميل لإعادة تحميل شاشة الدخول
  res.json({ ok: true, message: 'تم مغادرة الدائرة' });
});

api.post('/typing', (req, res) => {
  broadcast({ type: 'typing', id: req.user.id, name: req.user.name });
  res.json({ ok: true });
});
