/** REST API (mounted at /api). */
import express from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import { config } from './config.js';
import { log, now, normalizePhone, phoneHash, sanitizeText, clampInt, RateLimiter } from './util.js';
import * as store from './store.js';
import * as hub from './hub.js';
import { checkOtp, issueSession, sendOtp, verifyToken } from './auth.js';
import { iceServers } from './ice.js';
import { pushMessage } from './push.js';

const router = express.Router();
const otpLimiter = new RateLimiter(60_000, 5);
const writeLimiter = new RateLimiter(1000, 10);

/* ----------------------------- helpers ------------------------------ */

const ok = (res, data = {}) => res.json({ ok: true, ...data });
const fail = (res, status, code, message) => res.status(status).json({ ok: false, code, message });

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const payload = token ? verifyToken(String(token)) : null;
  const user = payload?.sub ? store.getUserById(payload.sub) : null;
  if (!user) return fail(res, 401, 'unauthorized', 'Session expired, please log in again.');
  req.user = user;
  next();
}

const publicUrl = (req, path) => {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

function requireMember(convId, userId) {
  return store.isMember(convId, userId);
}

/* ------------------------------ health ------------------------------- */

router.get('/health', (_req, res) =>
  ok(res, {
    status: 'ok',
    time: now(),
    users: store.userCount(),
    online: hub.onlineUsers().length,
    /** how verification codes leave the box: none | console | textbee | twilio | http | whatsapp */
    sms: config.smsProvider,
    /**
     * For SMS_PROVIDER=whatsapp this tells the caller whether the Meta Cloud API
     * credentials are actually set, and whether a template + language is named.
     * Kept out of the provider name so the OTP provisioning can explain itself.
     */
    whatsappConfigured:
      config.smsProvider !== 'whatsapp' ||
      Boolean(config.whatsappPhoneNumberId && config.whatsappAccessToken && config.whatsappTemplateName),
    /**
     * `true` only on a throwaway box (no SMS gateway): the server then hands
     * the code back with the API. Clients show the demo shortcuts for this.
     */
    demo: config.demoMode,
  })
);

/* ------------------------------- auth -------------------------------- */

router.get('/auth/whatsapp/status', (_req, res) => {
  const configured =
    config.smsProvider === 'whatsapp' &&
    Boolean(config.whatsappPhoneNumberId && config.whatsappAccessToken);
  const sameTemplate = Boolean(config.whatsappTemplateName);
  return ok(res, {
    provider: config.smsProvider,
    configured,
    phoneNumberIdSet: Boolean(config.whatsappPhoneNumberId),
    accessTokenSet: Boolean(config.whatsappAccessToken),
    templateSet: sameTemplate,
    language: config.whatsappTemplateLanguage,
  });
});

router.post('/auth/otp/request', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (phone.length < 8 || phone.length > 15) return fail(res, 400, 'bad_phone', 'رقم الهاتف غير صالح');
  const limit = otpLimiter.check(phone);
  if (!limit.ok) return fail(res, 429, 'rate_limited', `حاول بعد ${limit.retryAfter} ثانية`);

  if (
    config.smsProvider === 'whatsapp' &&
    (!config.whatsappPhoneNumberId || !config.whatsappAccessToken)
  ) {
    return fail(res, 503, 'provider_not_configured',
      'إرسال واتساب غير مُفعّل: اضبط WHATSAPP_PHONE_NUMBER_ID و WHATSAPP_ACCESS_TOKEN');
  }

  const { code, expires, delivered, provider } = await sendOtp(phone);
  const isNew = !store.getUserByPhone(phone);
  return ok(res, {
    phone,
    expiresIn: Math.floor((expires - now()) / 1000),
    isNew,
    delivered,
    provider,
    // development / demo convenience: the code is returned when no SMS gateway is configured
    devCode: config.smsProvider === 'none' ? code : undefined,
  });
});

router.post('/auth/otp/verify', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '');
  if (!phone) return fail(res, 400, 'bad_phone', 'رقم الهاتف غير صالح');
  const check = checkOtp(phone, code);
  if (!check.ok) return fail(res, 400, check.reason, 'كود التحقق غير صحيح أو منتهي الصلاحية');

  let user = store.getUserByPhone(phone);
  let isNew = false;
  if (!user) {
    user = store.createUser({
      phone,
      name: sanitizeText(String(req.body?.name || ''), 60),
      locale: String(req.body?.locale || 'ar'),
    });
    isNew = true;
  }
  const tokens = issueSession(user, String(req.body?.device || ''));
  return ok(res, {
    user: store.publicUser(user),
    isNew,
    ...tokens,
  });
});

router.post('/auth/refresh', (req, res) => {
  const token = String(req.body?.refreshToken || '');
  const payload = verifyToken(token, 'refresh');
  if (!payload) return fail(res, 401, 'unauthorized', 'انتهت الجلسة');
  const session = store.sessionByRefresh(token);
  if (!session || session.expires < now()) return fail(res, 401, 'unauthorized', 'انتهت الجلسة');
  const user = store.getUserById(session.user_id);
  if (!user) return fail(res, 401, 'unauthorized', 'المستخدم غير موجود');
  store.deleteSession(token);
  const tokens = issueSession(user, session.device);
  return ok(res, { user: store.publicUser(user), ...tokens });
});

router.post('/auth/logout', (req, res) => {
  const token = String(req.body?.refreshToken || '');
  const session = store.sessionByRefresh(token);
  if (session) store.deleteSession(token);
  return ok(res, {});
});

/* -------------------------------- me --------------------------------- */

router.get('/me', auth, (req, res) => ok(res, { user: store.publicUser(req.user) }));

router.patch('/me', auth, (req, res) => {
  const before = store.getUserById(req.user.id);
  const user = store.updateUser(req.user.id, req.body || {});
  const key = store.publicUser(user)?.publicKey || '';
  // a new identity key must reach the other devices, otherwise they would keep
  // sealing messages for a key this account does not hold any more
  if (key && key !== (before?.public_key || '')) {
    for (const conv of store.listConversations(req.user.id)) {
      for (const member of store.listMembers(conv.id)) {
        if (member.id === req.user.id) continue;
        hub.sendToUser(member.id, { t: 'user:key', userId: req.user.id, publicKey: key });
      }
    }
  }
  return ok(res, { user: store.publicUser(user) });
});

router.post('/me/push-token', auth, (req, res) => {
  store.setPushToken(req.user.id, String(req.body?.token || ''), String(req.body?.platform || 'android'));
  return ok(res, {});
});

router.get('/ice', auth, (req, res) => ok(res, { iceServers: iceServers(req.user.id), ttl: config.turnCredentialTtl }));

/* ------------------------------ contacts ------------------------------ */

router.post('/contacts/sync', auth, async (req, res) => {
  const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, 20000) : [];
  const result = store.syncContacts(req.user.id, contacts);
  return ok(res, result);
});

router.get('/contacts', auth, (req, res) => ok(res, { contacts: store.listContacts(req.user.id) }));

/* --------------------------- conversations ---------------------------- */

router.get('/conversations', auth, (req, res) => {
  const list = store.listConversations(req.user.id);
  return ok(res, { conversations: list });
});

router.post('/conversations', auth, async (req, res) => {
  const body = req.body || {};
  if (body.type === 'group') {
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
    const conv = store.createConversation({
      type: 'group',
      title: sanitizeText(String(body.title || ''), 60) || 'مجموعة جديدة',
      avatar: String(body.avatar || ''),
      createdBy: req.user.id,
      memberIds: [req.user.id, ...memberIds],
    });
    for (const m of store.listMembers(conv.id)) {
      if (m.id === req.user.id) continue;
      hub.sendToUser(m.id, { t: 'conversation', conversation: store.conversationView(conv.id, m.id) });
    }
    return ok(res, { conversation: store.conversationView(conv.id, req.user.id) });
  }

  // direct
  let otherId = body.userId ? String(body.userId) : '';
  if (!otherId && body.phone) {
    const phone = normalizePhone(body.phone);
    const other = store.getUserByPhone(phone);
    if (!other) return fail(res, 404, 'not_found', 'هذا الرقم غير مسجل في التطبيق');
    otherId = other.id;
  }
  if (!otherId) return fail(res, 400, 'bad_request', 'userId or phone is required');
  if (otherId === req.user.id) return fail(res, 400, 'bad_request', 'لا يمكنك محادثة نفسك');
  const { conversation } = store.getOrCreateDirect(req.user.id, otherId);
  return ok(res, { conversation: store.conversationView(conversation.id, req.user.id) });
});

router.get('/conversations/:id', auth, (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  return ok(res, { conversation: store.conversationView(convId, req.user.id) });
});

router.get('/conversations/:id/messages', auth, (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  const limit = clampInt(req.query.limit, 50, 1, 200);
  const before = req.query.before ? Number(req.query.before) : undefined;
  const after = req.query.after ? Number(req.query.after) : undefined;
  const messages = store.listMessages(convId, { limit, before, after });
  store.markDelivered(convId, req.user.id);
  for (const m of store.listMembers(convId)) {
    if (m.id === req.user.id) continue;
    hub.sendToUser(m.id, { t: 'receipt', conversationId: convId, messageIds: messages.filter((x) => x.senderId === m.id).map((x) => x.id), type: 'delivered' });
  }
  return ok(res, { messages });
});

router.post('/conversations/:id/messages', auth, async (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  if (!writeLimiter.check(req.user.id).ok) return fail(res, 429, 'rate_limited', 'أرسلت رسائل كثيرة بسرعة');
  const body = req.body || {};
  const type = ['text', 'image', 'audio', 'video', 'file', 'location', 'contact'].includes(body.type) ? body.type : 'text';
  if (type === 'text' && !String(body.body || '').trim()) return fail(res, 400, 'empty', 'الرسالة فارغة');

  const message = store.createMessage({
    conversationId: convId,
    senderId: req.user.id,
    type,
    body: sanitizeText(String(body.body || '')),
    mediaUrl: String(body.mediaUrl || ''),
    mediaMeta: body.mediaMeta || null,
    replyTo: body.replyTo || null,
    clientId: String(body.clientId || ''),
    encrypted: !!body.encrypted,
  });
  const view = store.getMessage(message.id);

  for (const m of store.listMembers(convId)) {
    if (m.id === req.user.id) continue;
    const delivered = hub.sendToUser(m.id, { t: 'message', message: view });
    if (!delivered) {
      const member = store.getUserById(m.id);
      const conv = store.getConversation(convId);
      const preview =
        type === 'text' ? view.body : type === 'image' ? '📷 صورة' : type === 'audio' ? '🎤 رسالة صوتية' : type === 'video' ? '🎥 فيديو' : '📎 مرفق';
      pushMessage(store.getUserById(req.user.id), member, conv, preview).catch(() => {});
    }
  }
  return ok(res, { message: view });
});

router.post('/conversations/:id/read', auth, (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  const delivered = store.markDelivered(convId, req.user.id);
  store.markRead(convId, req.user.id);
  for (const m of store.listMembers(convId)) {
    if (m.id === req.user.id) continue;
    if (delivered.length) hub.sendToUser(m.id, { t: 'receipt', conversationId: convId, messageIds: delivered, type: 'delivered' });
    hub.sendToUser(m.id, { t: 'receipt', conversationId: convId, messageIds: [], type: 'read', userId: req.user.id });
  }
  return ok(res, { unread: 0 });
});

/* --------------------------- group keys (E2EE) ----------------------------- */

/** Creator uploads the group key encrypted for every member. */
router.post('/conversations/:id/keys', auth, async (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const members = store.listMembers(convId).map((m) => m.id);
  const clean = keys
    .filter((k) => members.includes(String(k.userId)))
    .map((k) => ({ userId: String(k.userId), enc: String(k.enc || ''), nonce: String(k.nonce || '') }));
  if (!clean.length) return fail(res, 400, 'bad_request', 'no keys');
  const keys2 = store.setGroupKeys(convId, clean, req.user.id);
  for (const m of store.listMembers(convId)) {
    if (m.id === req.user.id) continue;
    hub.sendToUser(m.id, { t: 'conversation:keys', conversationId: convId });
  }
  return ok(res, { keys: keys2 });
});

router.get('/conversations/:id/keys', auth, (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  return ok(res, { keys: store.getGroupKeys(convId) });
});

/** Shared per-conversation settings (chat wallpaper, theme, ...).
 *  Whatever one side sets is broadcast live to every member. */
router.get('/conversations/:id/settings', auth, (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  return ok(res, { settings: store.getConversationSettings(convId) });
});

router.post('/conversations/:id/settings', auth, async (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  const incoming = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
  const allowed = ['wallpaper', 'theme', 'bubbleColor', 'accentColor'];
  const changed = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!allowed.includes(key)) continue;
    if (value === null) {
      store.deleteConversationSetting(convId, key);
      changed[key] = null;
    } else {
      store.setConversationSetting(convId, key, value, req.user.id);
      changed[key] = value;
    }
  }
  const settings = store.getConversationSettings(convId);
  for (const m of store.listMembers(convId)) {
    if (m.id === req.user.id) continue;
    hub.sendToUser(m.id, {
      t: 'conversation:settings',
      conversationId: convId,
      settings,
      changed,
      by: req.user.id,
    });
  }
  return ok(res, { settings });
});

router.post('/conversations/:id/mute', auth, (req, res) => {
  const convId = String(req.params.id);
  if (!requireMember(convId, req.user.id)) return fail(res, 403, 'forbidden', 'غير مسموح');
  store.run('UPDATE participants SET muted = ? WHERE conversation_id = ? AND user_id = ?', req.body?.muted ? 1 : 0, convId, req.user.id);
  return ok(res, { muted: !!req.body?.muted });
});

/* ------------------------------ messages ------------------------------ */

router.put('/messages/:id', auth, (req, res) => {
  const message = store.get('SELECT * FROM messages WHERE id = ?', String(req.params.id));
  if (!message) return fail(res, 404, 'not_found', 'الرسالة غير موجودة');
  if (message.sender_id !== req.user.id) return fail(res, 403, 'forbidden', 'غير مسموح');
  store.editMessage(message.id, String(req.body?.body || ''));
  const view = store.getMessage(message.id);
  for (const m of store.listMembers(message.conversation_id)) {
    hub.sendToUser(m.id, { t: 'message:update', message: view });
  }
  return ok(res, { message: view });
});

router.delete('/messages/:id', auth, (req, res) => {
  const message = store.get('SELECT * FROM messages WHERE id = ?', String(req.params.id));
  if (!message) return fail(res, 404, 'not_found', 'الرسالة غير موجودة');
  if (message.sender_id !== req.user.id) return fail(res, 403, 'forbidden', 'غير مسموح');
  store.deleteMessage(message.id);
  const view = store.getMessage(message.id);
  for (const m of store.listMembers(message.conversation_id)) {
    hub.sendToUser(m.id, { t: 'message:update', message: view });
  }
  return ok(res, { message: view });
});

/* ------------------------------- uploads ------------------------------ */

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = (extname(file.originalname || '') || '.bin').toLowerCase().slice(0, 10);
    cb(null, `${Date.now().toString(36)}-${randomBytes(10).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, true),
});

router.post('/uploads', auth, upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, 400, 'no_file', 'لم يتم استلام أي ملف');
  const url = `/uploads/${req.file.filename}`;
  return ok(res, {
    url,
    fullUrl: publicUrl(req, url),
    meta: {
      name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      width: Number(req.body?.width) || 0,
      height: Number(req.body?.height) || 0,
      durationMs: Number(req.body?.durationMs) || 0,
    },
  });
});

/* -------------------------------- calls -------------------------------- */

router.get('/calls', auth, (req, res) => {
  const limit = clampInt(req.query.limit, 50, 1, 200);
  return ok(res, { calls: store.listCalls(req.user.id, limit) });
});

router.post('/calls', auth, async (req, res) => {
  // Used to pre-create a call (e.g. from a push notification flow)
  let calleeId = req.body?.calleeId ? String(req.body.calleeId) : '';
  if (!calleeId && req.body?.phone) {
    const other = store.getUserByPhone(normalizePhone(req.body.phone));
    if (!other) return fail(res, 404, 'not_found', 'المستخدم غير موجود');
    calleeId = other.id;
  }
  if (!calleeId) return fail(res, 400, 'bad_request', 'calleeId is required');
  const { conversation } = store.getOrCreateDirect(req.user.id, calleeId);
  const call = store.createCall({
    conversationId: conversation.id,
    callerId: req.user.id,
    calleeId,
    type: req.body?.type === 'video' ? 'video' : 'audio',
  });
  return ok(res, { call, conversationId: conversation.id, online: hub.isOnline(calleeId) });
});

/* -------------------------------- users -------------------------------- */

router.get('/users/:id', auth, (req, res) => {
  const user = store.getUserById(String(req.params.id));
  if (!user) return fail(res, 404, 'not_found', 'المستخدم غير موجود');
  return ok(res, { user: store.publicUser(user), online: hub.isOnline(user.id) });
});

router.get('/users/by-phone/:phone', auth, (req, res) => {
  const user = store.getUserByPhone(normalizePhone(req.params.phone));
  if (!user) return fail(res, 404, 'not_found', 'هذا الرقم غير مسجل');
  return ok(res, { user: store.publicUser(user), online: hub.isOnline(user.id) });
});

router.get('/search', auth, (req, res) => {
  const q = sanitizeText(String(req.query.q || ''), 60);
  if (!q) return ok(res, { users: [] });
  const like = `%${q}%`;
  const rows = store
    .all('SELECT * FROM users WHERE name LIKE ? OR phone LIKE ? LIMIT 30', like, like)
    .filter((u) => u.id !== req.user.id)
    .map((u) => ({ ...store.publicUser(u), online: hub.isOnline(u.id) }));
  return ok(res, { users: rows });
});

/* --------------------------------- sync -------------------------------- */

/** One shot sync used after the app was offline: everything newer than `since`. */
router.get('/sync', auth, (req, res) => {
  const since = Number(req.query.since || 0);
  const conversations = store.listConversations(req.user.id);
  const messages = [];
  for (const c of conversations) {
    messages.push(...store.listMessages(c.id, { limit: 200, after: since }));
  }
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return ok(res, {
    serverTime: now(),
    me: store.publicUser(req.user),
    conversations,
    messages,
    calls: store.listCalls(req.user.id, 50).filter((c) => (c.startedAt || 0) >= since),
    contacts: store.listContacts(req.user.id),
  });
});

/* ------------------------------- fallback ------------------------------ */

router.use((req, res) => fail(res, 404, 'not_found', `مسار غير موجود: ${req.method} ${req.path}`));

export { router, auth, ok, fail, publicUrl };
export default router;
