/**
 * ماسنجر لايت — واجهة REST مختصرة.
 *
 * المصادقة: رقم هاتف + كود تحقق. في وضع الدائرة الخاصة (بدون مزوّد SMS)
 * يظهر الكود مباشرة داخل التطبيق — لا رسائل ولا تكاليف. ويمكن حماية
 * التسجيل برمز انضمام (JOIN_CODE) حتى لا يدخل الغرباء.
 */
import express from 'express';
import { config, normalizePhone } from './config.js';
import * as store from './store.js';
import { broadcast, onlineIds } from './realtime.js';

export const api = express.Router();

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
  return { ok: true, photo: store.saveMedia(bytes) };
}

function enrichAuthor(userId) {
  const u = store.members().find((x) => x.id === userId);
  return { id: userId, name: u ? u.name : 'عضو سابق' };
}

const enrichPost = (p) => ({
  id: p.id,
  text: p.text,
  photo: p.photo?.url || null,
  likes: p.likes,
  comments: p.comments.map((c) => ({ ...c, author: enrichAuthor(c.userId) })),
  createdAt: p.createdAt,
  author: enrichAuthor(p.userId),
});

const enrichMessage = (m) => ({
  id: m.id, text: m.text, photo: m.photo?.url || null, createdAt: m.createdAt, author: enrichAuthor(m.userId),
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
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return fail(res, 400, 'bad_phone', 'أدخل رقم هاتف صحيحاً مع رمز الدولة');

  const isMember = !!store.userByPhone(phone);
  if (!isMember && store.seatsLeft() <= 0) {
    return fail(res, 403, 'circle_full', `الدائرة مكتملة (${config.maxMembers}/${config.maxMembers}) — لا مزيد من الأعضاء`);
  }

  const prev = store.codeFor(phone);
  if (prev && Date.now() - prev.lastSent < config.codeResendMs) {
    const wait = Math.ceil((config.codeResendMs - (Date.now() - prev.lastSent)) / 1000);
    return fail(res, 429, 'too_soon', `انتظر ${wait} ثانية قبل طلب كود جديد`);
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
  const phone = normalizePhone(req.body?.phone);
  const code = cleanText(req.body?.code, 10);
  if (!phone) return fail(res, 400, 'bad_phone', 'رقم الهاتف غير صحيح');

  const entry = store.codeFor(phone);
  if (!entry || Date.now() > entry.expires) {
    store.clearCode(phone);
    return fail(res, 400, 'code_expired', 'انتهت صلاحية الكود — اطلب كوداً جديداً');
  }
  entry.tries += 1;
  if (entry.tries > config.codeMaxTries) {
    store.clearCode(phone);
    return fail(res, 429, 'too_many', 'محاولات كثيرة خاطئة — اطلب كوداً جديداً');
  }
  if (code !== entry.code) return fail(res, 400, 'bad_code', 'الكود غير صحيح');
  store.clearCode(phone); // الكود للاستخدام مرة واحدة

  let user = store.userByPhone(phone);
  let created = false;
  let token;

  if (!user) {
    if (store.seatsLeft() <= 0) {
      store.clearCode(phone);
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
  const r = parsePhoto(req.body?.photo);
  if (!r.ok) return fail(res, r.status, r.code, r.message);
  if (!text && !r.photo) return fail(res, 400, 'empty_message', 'اكتب رسالة أو أرفق صورة');
  const msg = store.addMessage(req.user, { text, photo: r.photo });
  broadcast({ type: 'message', message: enrichMessage(msg) });
  res.json({ ok: true, message: enrichMessage(msg) });
});

api.delete('/messages/:id', (req, res) => {
  const msg = store.messageById(req.params.id);
  if (!msg) return fail(res, 404, 'not_found', 'الرسالة غير موجودة');
  if (msg.userId !== req.user.id) return fail(res, 403, 'forbidden', 'يمكنك حذف رسائلك فقط');
  store.removeMessage(msg);
  broadcast({ type: 'message_deleted', id: msg.id });
  res.json({ ok: true });
});

api.post('/typing', (req, res) => {
  broadcast({ type: 'typing', id: req.user.id, name: req.user.name });
  res.json({ ok: true });
});
