/** Data access helpers (SQLite). All functions are synchronous. */
import { db, run, get, all, tx } from './db.js';
import { id, now, phoneHash, sanitizeText, uuid } from './util.js';

/* ------------------------------ users ------------------------------ */

export const publicUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    phone: u.phone,
    avatar: u.avatar,
    about: u.about,
    locale: u.locale,
    publicKey: u.public_key,
    online: !!u.online,
    lastSeen: u.last_seen,
  };

export function getUserById(userId) {
  return get('SELECT * FROM users WHERE id = ?', userId);
}

export function getUserByPhone(phone) {
  return get('SELECT * FROM users WHERE phone = ?', phone);
}

export function getUserByHash(hash) {
  return get('SELECT * FROM users WHERE phone_hash = ?', hash);
}

export function createUser({ phone, name = '', avatar = '', about = '', locale = 'ar' }) {
  const user = {
    id: id('u'),
    phone,
    phone_hash: phoneHash(phone),
    name: name || '',
    avatar: avatar || '',
    about: about || '',
    locale,
    created_at: now(),
    last_seen: now(),
    online: 0,
  };
  run(
    `INSERT INTO users (id, phone, phone_hash, name, avatar, about, locale, created_at, last_seen, online)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    user.id,
    user.phone,
    user.phone_hash,
    user.name,
    user.avatar,
    user.about,
    user.locale,
    user.created_at,
    user.last_seen
  );
  return getUserById(user.id);
}

export function updateUser(userId, patch = {}) {
  const allowed = ['name', 'avatar', 'about', 'locale', 'public_key', 'push_token', 'push_platform'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    sets.push(`${key} = ?`);
    vals.push(key === 'name' || key === 'about' ? sanitizeText(String(patch[key]), 200) : String(patch[key]));
  }
  if (!sets.length) return getUserById(userId);
  vals.push(userId);
  run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  return getUserById(userId);
}

export function setOnline(userId, online) {
  run('UPDATE users SET online = ?, last_seen = ? WHERE id = ?', online ? 1 : 0, now(), userId);
}

export function touchUser(userId) {
  run('UPDATE users SET last_seen = ? WHERE id = ?', now(), userId);
}

export function setPushToken(userId, token, platform = 'android') {
  run('UPDATE users SET push_token = ?, push_platform = ? WHERE id = ?', String(token || ''), platform, userId);
}

export function findUsersByHashes(hashes = []) {
  if (!hashes.length) return [];
  const chunkSize = 400;
  const out = [];
  for (let i = 0; i < hashes.length; i += chunkSize) {
    const chunk = hashes.slice(i, i + chunkSize);
    const marks = chunk.map(() => '?').join(',');
    out.push(...all(`SELECT * FROM users WHERE phone_hash IN (${marks})`, ...chunk));
  }
  return out;
}

/* ----------------------------- contacts ----------------------------- */

/** Store the (hashed) address book of a user and return which of them use the app. */
export function syncContacts(userId, contacts = []) {
  const t = now();
  const hashes = [];
  tx(() => {
    for (const c of contacts) {
      const hash = String(c.hash || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      const name = sanitizeText(String(c.name || ''), 120);
      hashes.push(hash);
      run(
        `INSERT INTO contacts (user_id, phone_hash, name, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, phone_hash) DO UPDATE SET name = excluded.name`,
        userId,
        hash,
        name,
        t
      );
    }
  });
  const users = findUsersByHashes(hashes)
    .filter((u) => u.id !== userId)
    .map((u) => publicUser(u));
  return { contacts: hashes.length, users };
}

export function listContacts(userId) {
  const hashes = all('SELECT phone_hash, name FROM contacts WHERE user_id = ?', userId);
  if (!hashes.length) return [];
  const marks = hashes.map(() => '?').join(',');
  const users = all(
    `SELECT * FROM users WHERE phone_hash IN (${marks})`,
    ...hashes.map((h) => h.phone_hash)
  );
  const byHash = new Map(users.map((u) => [u.phone_hash, u]));
  return hashes.map((h) => ({
    name: h.name,
    phoneHash: h.phone_hash,
    user: byHash.has(h.phone_hash) ? publicUser(byHash.get(h.phone_hash)) : null,
  }));
}

/* --------------------------- conversations --------------------------- */

export function getConversation(convId) {
  return get('SELECT * FROM conversations WHERE id = ?', convId);
}

export function isMember(convId, userId) {
  return !!get('SELECT 1 FROM participants WHERE conversation_id = ? AND user_id = ?', convId, userId);
}

export function listMembers(convId) {
  return all(
    `SELECT u.* FROM participants p JOIN users u ON u.id = p.user_id WHERE p.conversation_id = ?`,
    convId
  );
}

export function getDirectBetween(aId, bId) {
  return get(
    `SELECT c.* FROM conversations c
     JOIN participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
     JOIN participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
     WHERE c.type = 'direct'`,
    aId,
    bId
  );
}

export function createConversation({ type = 'direct', title = '', avatar = '', createdBy, memberIds = [] }) {
  const convId = id('c');
  const t = now();
  tx(() => {
    run(
      `INSERT INTO conversations (id, type, title, avatar, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      convId,
      type,
      title,
      avatar,
      createdBy || null,
      t,
      t
    );
    const ids = new Set(memberIds);
    if (createdBy) ids.add(createdBy);
    for (const uid of ids) {
      run(
        `INSERT OR IGNORE INTO participants (conversation_id, user_id, role, joined_at, muted)
         VALUES (?, ?, 'member', ?, 0)`,
        convId,
        uid,
        t
      );
    }
  });
  return getConversation(convId);
}

export function getOrCreateDirect(aId, bId) {
  const existing = getDirectBetween(aId, bId);
  if (existing) return { conversation: existing, created: false };
  const conversation = createConversation({ type: 'direct', createdBy: aId, memberIds: [aId, bId] });
  return { conversation, created: true };
}

export function touchConversation(convId, messageId, at = now()) {
  run(
    'UPDATE conversations SET updated_at = ?, last_message_id = COALESCE(?, last_message_id) WHERE id = ?',
    at,
    messageId || null,
    convId
  );
}

export function markRead(convId, userId, upTo = now()) {
  run(
    `UPDATE message_receipts SET read_at = ?
     WHERE read_at IS NULL AND user_id = ?
       AND message_id IN (SELECT id FROM messages WHERE conversation_id = ? AND sender_id <> ? AND created_at <= ?)`,
    now(),
    userId,
    convId,
    userId,
    upTo
  );
  return unreadCount(convId, userId);
}

export function unreadCount(convId, userId) {
  const row = get(
    `SELECT COUNT(*) AS n FROM messages m
     LEFT JOIN message_receipts r ON r.message_id = m.id AND r.user_id = ?
     WHERE m.conversation_id = ? AND m.sender_id <> ? AND m.deleted = 0 AND r.read_at IS NULL`,
    userId,
    convId,
    userId
  );
  return Number(row?.n || 0);
}

export function listConversations(userId) {
  const rows = all(
    `SELECT c.* FROM conversations c
     JOIN participants p ON p.conversation_id = c.id
     WHERE p.user_id = ?
     ORDER BY c.updated_at DESC`,
    userId
  );
  return rows.map((c) => conversationView(c.id, userId));
}

/* --------------------------- group key wrapping ---------------------------- */
/* The group key is generated by the creator and stored once per member,      */
/* encrypted for that member with their public key. The server only keeps     */
/* ciphertext it can never read.                                              */

export function setGroupKeys(convId, entries, updatedBy) {
  const t = now();
  tx(() => {
    for (const e of entries) {
      run(
        `INSERT INTO conversation_keys (conversation_id, user_id, enc_key, nonce, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, user_id) DO UPDATE SET
           enc_key = excluded.enc_key, nonce = excluded.nonce,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        convId,
        String(e.userId),
        String(e.enc),
        String(e.nonce),
        updatedBy || null,
        t
      );
    }
  });
  return getGroupKeys(convId);
}

export function getGroupKeys(convId, userId) {
  const rows = userId
    ? all('SELECT * FROM conversation_keys WHERE conversation_id = ? AND user_id = ?', convId, userId)
    : all('SELECT * FROM conversation_keys WHERE conversation_id = ?', convId);
  return rows.map((r) => ({ userId: r.user_id, enc: r.enc_key, nonce: r.nonce, by: r.updated_by || null }));
}

export function getConversationSettings(convId) {
  const out = {};
  for (const row of all('SELECT key, value, updated_by, updated_at FROM conversation_settings WHERE conversation_id = ?', convId)) {
    let parsed = row.value;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      /* keep as string */
    }
    out[row.key] = parsed;
  }
  return out;
}

export function setConversationSetting(convId, key, value, updatedBy) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  run(
    `INSERT INTO conversation_settings (conversation_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    convId,
    key,
    raw,
    updatedBy || null,
    now()
  );
  return getConversationSettings(convId);
}

export function deleteConversationSetting(convId, key) {
  run('DELETE FROM conversation_settings WHERE conversation_id = ? AND key = ?', convId, key);
  return getConversationSettings(convId);
}

export function conversationView(convId, userId) {
  const conv = getConversation(convId);
  if (!conv) return null;
  const members = listMembers(convId).map(publicUser);
  const last = get(
    'SELECT * FROM messages WHERE conversation_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 1',
    convId
  );
  let title = conv.title;
  let avatar = conv.avatar;
  let peer = null;
  if (conv.type === 'direct') {
    peer = members.find((m) => m.id !== userId) || null;
    if (peer) {
      title = peer.name || peer.phone;
      avatar = peer.avatar;
    }
  }
  return {
    id: conv.id,
    type: conv.type,
    title: title || (conv.type === 'group' ? 'مجموعة' : 'محادثة'),
    avatar,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    members,
    peer,
    unread: unreadCount(convId, userId),
    muted: Number(get('SELECT muted FROM participants WHERE conversation_id = ? AND user_id = ?', convId, userId)?.muted || 0),
    settings: getConversationSettings(convId),
    lastMessage: last ? messageView(last) : null,
  };
}

/* ------------------------------ messages ---------------------------- */

export function messageView(m) {
  if (!m) return null;
  let media = null;
  if (m.media_meta) {
    try {
      media = JSON.parse(m.media_meta);
    } catch {
      media = null;
    }
  }
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    type: m.type,
    body: m.deleted ? '' : m.body,
    mediaUrl: m.media_url || '',
    media,
    replyTo: m.reply_to || null,
    clientId: m.client_id || '',
    encrypted: !!m.encrypted,
    status: m.status,
    createdAt: m.created_at,
    editedAt: m.edited_at || null,
    deleted: !!m.deleted,
  };
}

export function createMessage({
  conversationId,
  senderId,
  type = 'text',
  body = '',
  mediaUrl = '',
  mediaMeta = null,
  replyTo = null,
  clientId = '',
  encrypted = false,
  status = 'sent',
  createdAt = now(),
}) {
  const messageId = id('m');
  tx(() => {
    run(
      `INSERT INTO messages (id, conversation_id, sender_id, type, body, media_url, media_meta, reply_to, client_id, encrypted, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      messageId,
      conversationId,
      senderId,
      type,
      sanitizeText(String(body), 8000),
      String(mediaUrl || ''),
      mediaMeta ? JSON.stringify(mediaMeta) : '',
      replyTo || null,
      String(clientId || ''),
      encrypted ? 1 : 0,
      status,
      createdAt
    );
    for (const m of listMembers(conversationId)) {
      if (m.id === senderId) continue;
      run(
        'INSERT OR IGNORE INTO message_receipts (message_id, user_id, delivered_at, read_at) VALUES (?, ?, NULL, NULL)',
        messageId,
        m.id
      );
    }
    touchConversation(conversationId, messageId, createdAt);
  });
  return getMessage(messageId);
}

export function getMessage(messageId) {
  return messageView(get('SELECT * FROM messages WHERE id = ?', messageId));
}

export function listMessages(convId, { limit = 50, before, after } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let sql = 'SELECT * FROM messages WHERE conversation_id = ?';
  const args = [convId];
  if (before) {
    sql += ' AND created_at < ?';
    args.push(Number(before));
  }
  if (after) {
    sql += ' AND created_at > ?';
    args.push(Number(after));
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  args.push(lim);
  const rows = all(sql, ...args);
  return rows.map(messageView).reverse();
}

export function markDelivered(convId, userId) {
  const rows = all(
    `SELECT m.id FROM messages m
     JOIN message_receipts r ON r.message_id = m.id AND r.user_id = ?
     WHERE m.conversation_id = ? AND m.sender_id <> ? AND r.delivered_at IS NULL`,
    userId,
    convId,
    userId
  );
  const t = now();
  for (const r of rows) {
    run('UPDATE message_receipts SET delivered_at = ? WHERE message_id = ? AND user_id = ?', t, r.id, userId);
    const remaining = get(
      'SELECT COUNT(*) AS n FROM message_receipts WHERE message_id = ? AND delivered_at IS NULL',
      r.id
    );
    if (!Number(remaining?.n || 0)) run("UPDATE messages SET status = 'delivered' WHERE id = ?", r.id);
  }
  return rows.map((r) => r.id);
}

export function hasReadAll(convId, senderId) {
  const row = get(
    `SELECT COUNT(*) AS n FROM messages m
     JOIN message_receipts r ON r.message_id = m.id
     WHERE m.conversation_id = ? AND m.sender_id = ? AND r.read_at IS NULL`,
    convId,
    senderId
  );
  return !Number(row?.n || 0);
}

export function updateMessageStatus(messageId, status) {
  run('UPDATE messages SET status = ? WHERE id = ?', status, messageId);
}

export function editMessage(messageId, body) {
  run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', sanitizeText(body, 8000), now(), messageId);
}

export function deleteMessage(messageId) {
  run('UPDATE messages SET deleted = 1, body = \'\', media_url = \'\' WHERE id = ?', messageId);
}

/* -------------------------------- calls ------------------------------ */

export function createCall({ conversationId, callerId, calleeId, type = 'audio' }) {
  const callId = id('call');
  run(
    `INSERT INTO calls (id, conversation_id, caller_id, callee_id, type, state, started_at)
     VALUES (?, ?, ?, ?, ?, 'ringing', ?)`,
    callId,
    conversationId || null,
    callerId,
    calleeId,
    type === 'video' ? 'video' : 'audio',
    now()
  );
  return getCall(callId);
}

export function getCall(callId) {
  const c = get('SELECT * FROM calls WHERE id = ?', callId);
  if (!c) return null;
  return {
    id: c.id,
    conversationId: c.conversation_id,
    callerId: c.caller_id,
    calleeId: c.callee_id,
    type: c.type,
    state: c.state,
    startedAt: c.started_at,
    endedAt: c.ended_at,
    durationMs: c.duration_ms,
    endReason: c.end_reason,
    quality: c.quality,
  };
}

export function updateCall(callId, patch = {}) {
  const sets = [];
  const vals = [];
  const map = { state: 'state', endedAt: 'ended_at', durationMs: 'duration_ms', endReason: 'end_reason', quality: 'quality' };
  for (const [key, col] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(patch[key]);
  }
  if (!sets.length) return getCall(callId);
  vals.push(callId);
  run(`UPDATE calls SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  return getCall(callId);
}

export function listCalls(userId, limit = 50) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return all(
    `SELECT * FROM calls WHERE caller_id = ? OR callee_id = ? ORDER BY started_at DESC LIMIT ?`,
    userId,
    userId,
    lim
  ).map((c) => getCall(c.id));
}

/* ------------------------------- otp -------------------------------- */

export function saveOtp(phone, code, expires) {
  run(
    `INSERT INTO otps (phone, code, expires, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires = excluded.expires, attempts = 0, sent_at = excluded.sent_at`,
    phone,
    code,
    expires,
    now()
  );
}

export function readOtp(phone) {
  return get('SELECT * FROM otps WHERE phone = ?', phone);
}

export function bumpOtpAttempts(phone) {
  run('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?', phone);
}

export function clearOtp(phone) {
  run('DELETE FROM otps WHERE phone = ?', phone);
}

/* -------------------------- telegram links -------------------------- */

/**
 * Link a phone number to a Telegram chat. A user who sends his phone number
 * to the OTP bot gets every future verification code in that chat.
 * Re-linking a phone replaces the previous chat (last one wins).
 */
export function saveTelegramLink(phone, chatId, username = '') {
  run(
    `INSERT INTO telegram_links (phone, chat_id, username, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       chat_id = excluded.chat_id,
       username = excluded.username,
       created_at = excluded.created_at`,
    phone,
    chatId,
    username,
    now()
  );
}

export function getTelegramLink(phone) {
  return get('SELECT * FROM telegram_links WHERE phone = ?', phone);
}

export function findTelegramLinkByChat(chatId) {
  return get('SELECT * FROM telegram_links WHERE chat_id = ?', chatId);
}

export function listTelegramLinks() {
  return all('SELECT * FROM telegram_links ORDER BY created_at');
}

export function countTelegramLinks() {
  const r = get('SELECT COUNT(*) AS n FROM telegram_links');
  return r ? Number(r.n) : 0;
}

export function deleteTelegramLink(phone) {
  run('DELETE FROM telegram_links WHERE phone = ?', phone);
}

/* ----------------------------- sessions ------------------------------ */

export function createSession(userId, refreshToken, expires, device = '') {
  const sessionId = uuid();
  run(
    'INSERT INTO sessions (id, user_id, refresh_token, device, created_at, expires) VALUES (?, ?, ?, ?, ?, ?)',
    sessionId,
    userId,
    refreshToken,
    device,
    now(),
    expires
  );
  return sessionId;
}

export function sessionByRefresh(refreshToken) {
  return get('SELECT * FROM sessions WHERE refresh_token = ?', refreshToken);
}

export function deleteSession(refreshToken) {
  run('DELETE FROM sessions WHERE refresh_token = ?', refreshToken);
}

export function deleteUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

/* ------------------------------- misc -------------------------------- */

export function userCount() {
  return Number(get('SELECT COUNT(*) AS n FROM users')?.n || 0);
}

export function queuePush(userId, payload) {
  run('INSERT INTO push_queue (id, user_id, payload, created_at) VALUES (?, ?, ?, ?)', id('p'), userId, JSON.stringify(payload), now());
}

export { db };

/* re-export the low level helpers so callers only import `store` */
export { run, get, all, exec, tx } from './db.js';
