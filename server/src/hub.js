/** In-memory realtime hub: keeps the websocket sessions of every online user. */
import { log, now } from './util.js';
import * as store from './store.js';

/** @type {Map<string, Set<any>>} userId -> sockets */
const sockets = new Map();

export function addSocket(userId, ws) {
  let set = sockets.get(userId);
  if (!set) sockets.set(userId, (set = new Set()));
  set.add(ws);
  const first = set.size === 1;
  if (first) {
    store.setOnline(userId, true);
    broadcastPresence(userId, true);
  }
  return first;
}

export function removeSocket(userId, ws) {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(ws);
  if (set.size === 0) {
    sockets.delete(userId);
    store.setOnline(userId, false);
    broadcastPresence(userId, false);
    return true;
  }
  return false;
}

export function isOnline(userId) {
  const set = sockets.get(userId);
  return Boolean(set && set.size > 0);
}

export function onlineUsers() {
  return [...sockets.keys()];
}

export function sendToUser(userId, payload, except) {
  const set = sockets.get(userId);
  if (!set) return 0;
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const ws of set) {
    if (ws === except) continue;
    if (ws.readyState !== 1) continue;
    try {
      ws.send(data);
      sent++;
    } catch (err) {
      log('hub: send failed', err.message);
    }
  }
  return sent;
}

export function sendToConversation(convId, payload, exceptUserId) {
  const members = store.listMembers(convId);
  for (const m of members) {
    if (m.id === exceptUserId) continue;
    sendToUser(m.id, payload);
  }
}

/** Tell every contact / chat partner that a user came online or went offline. */
export function broadcastPresence(userId, online) {
  const user = store.getUserById(userId);
  if (!user) return;
  const state = { userId, online, lastSeen: now() };
  const seen = new Set();
  const rows = store.all(
    `SELECT DISTINCT c.id FROM conversations c
     JOIN participants p ON p.conversation_id = c.id
     WHERE p.user_id = ?`,
    userId
  );
  for (const row of rows) {
    for (const m of store.listMembers(row.id)) {
      if (m.id === userId || seen.has(m.id)) continue;
      seen.add(m.id);
      sendToUser(m.id, { t: 'presence', ...state });
    }
  }
  // also users who have this number in their address book
  for (const row of store.all('SELECT user_id FROM contacts WHERE phone_hash = ?', user.phone_hash)) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    sendToUser(row.user_id, { t: 'presence', ...state });
  }
}
