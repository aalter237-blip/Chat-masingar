/**
 * WebSocket gateway.
 *
 * One socket per device. The client authenticates with its JWT either through
 * `?token=` or with the first `{t:'hello', token}` frame.
 *
 * Every frame is JSON: { t: <type>, ...payload }
 */
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { log, now, sanitizeText, RateLimiter } from './util.js';
import { verifyToken } from './auth.js';
import * as store from './store.js';
import * as hub from './hub.js';
import { pushIncomingCall, pushMessage } from './push.js';

/** callId -> {callerId, calleeId, type, conversationId, state, startedAt, timer} */
const activeCalls = new Map();
const ringTimeoutMs = 45_000;

const limiter = new RateLimiter(1000, 30); // 30 frames / second / socket
/** privacy event throttling: userId:conversationId:kind -> timestamp */
const eventThrottle = new Map();

function send(ws, obj) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (err) {
    log('ws: send error', err.message);
  }
}

function heartbeat(ws) {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
}

function endCall(callId, reason = 'ended', endedBy = null, durationMs = 0) {
  const entry = activeCalls.get(callId);
  if (!entry) return;
  clearTimeout(entry.timer);
  activeCalls.delete(callId);
  store.updateCall(callId, {
    state: reason === 'missed' ? 'missed' : reason === 'declined' ? 'declined' : reason === 'busy' ? 'busy' : 'ended',
    endedAt: now(),
    durationMs:
      durationMs > 0 ? durationMs : entry.startedAt && reason === 'ended' ? now() - entry.startedAt : 0,
    endReason: reason,
  });
  const call = store.getCall(callId);
  for (const uid of [entry.callerId, entry.calleeId]) {
    if (uid === endedBy) continue;
    hub.sendToUser(uid, { t: 'call.end', callId, reason, call });
  }
}

function missCall(callId) {
  const entry = activeCalls.get(callId);
  if (!entry) return;
  endCall(callId, 'missed');
  try {
    if (entry.conversationId) {
      const msg = store.createMessage({
        conversationId: entry.conversationId,
        senderId: entry.callerId,
        type: 'call',
        body: entry.type === 'video' ? 'مكالمة فيديو فائتة' : 'مكالمة صوتية فائتة',
        mediaMeta: { callId, state: 'missed', type: entry.type },
      });
      const message = store.getMessage(msg.id);
      for (const uid of [entry.callerId, entry.calleeId]) {
        hub.sendToUser(uid, { t: 'message', message });
      }
    }
  } catch (err) {
    log('ws: missed-call message failed', err.message);
  }
}

function handle(ws, ctx, frame) {
  const { userId } = ctx;
  const type = frame?.t;
  if (!type) return;

  switch (type) {
    case 'ping':
      return send(ws, { t: 'pong', ts: now(), serverTime: now() });

    case 'presence:query': {
      const ids = Array.isArray(frame.ids) ? frame.ids.slice(0, 500) : [];
      return send(ws, {
        t: 'presence:state',
        states: ids.map((uid) => {
          const u = store.getUserById(uid);
          return { userId: uid, online: hub.isOnline(uid), lastSeen: u?.last_seen || 0 };
        }),
      });
    }

    case 'typing': {
      const convId = String(frame.conversationId || '');
      if (!convId || !store.isMember(convId, userId)) return;
      const on = !!frame.on;
      const u = store.getUserById(userId);
      for (const m of store.listMembers(convId)) {
        if (m.id === userId) continue;
        hub.sendToUser(m.id, { t: 'typing', conversationId: convId, userId, name: u?.name || '', on });
      }
      return;
    }

    case 'read': {
      const convId = String(frame.conversationId || '');
      if (!convId || !store.isMember(convId, userId)) return;
      store.markRead(convId, userId);
      const delivered = store.markDelivered(convId, userId);
      if (delivered.length) {
        for (const m of store.listMembers(convId)) {
          if (m.id === userId) continue;
          hub.sendToUser(m.id, { t: 'receipt', conversationId: convId, messageIds: delivered, type: 'delivered' });
        }
      }
      for (const m of store.listMembers(convId)) {
        if (m.id === userId) continue;
        hub.sendToUser(m.id, { t: 'receipt', conversationId: convId, messageIds: [], type: 'read', userId });
      }
      return;
    }

    /* ------------------------------- calls ------------------------------ */
    case 'call.invite': {
      const to = String(frame.to || '');
      const type = frame.type === 'video' ? 'video' : 'audio';
      const conversationId = frame.conversationId ? String(frame.conversationId) : null;
      const peer = store.getUserById(to);
      if (!peer) return send(ws, { t: 'error', message: 'user_not_found' });

      let convId = conversationId;
      if (!convId) {
        const { conversation } = store.getOrCreateDirect(userId, to);
        convId = conversation.id;
      } else if (!store.isMember(convId, userId) || !store.isMember(convId, to)) {
        return send(ws, { t: 'error', message: 'not_a_member' });
      }

      // busy?
      for (const [cid, c] of activeCalls) {
        if ((c.callerId === to || c.calleeId === to) && c.state === 'ringing') {
          return send(ws, { t: 'call.busy', callId: cid, to });
        }
      }

      const call = store.createCall({ conversationId: convId, callerId: userId, calleeId: to, type });
      const caller = store.getUserById(userId);
      const entry = {
        callId: call.id,
        callerId: userId,
        calleeId: to,
        type,
        conversationId: convId,
        state: 'ringing',
        startedAt: 0,
        timer: setTimeout(() => missCall(call.id), ringTimeoutMs),
      };
      activeCalls.set(call.id, entry);

      const invite = {
        t: 'call.incoming',
        callId: call.id,
        conversationId: convId,
        type,
        sdp: frame.sdp || null,
        offer: frame.offer || null,
        from: store.publicUser(caller),
        createdAt: now(),
      };
      const deliveredToSocket = hub.sendToUser(to, invite) > 0;

      if (!deliveredToSocket) {
        // offline (or backgrounded): keep ringing for a while and wake the device
        pushIncomingCall(caller, peer, call).catch(() => {});
        send(ws, { t: 'call.ringing', callId: call.id, to, offline: true });
      } else {
        send(ws, { t: 'call.ringing', callId: call.id, to, offline: false });
      }
      return;
    }

    case 'call.answer': {
      const callId = String(frame.callId || '');
      const entry = activeCalls.get(callId);
      if (!entry || entry.calleeId !== userId) return send(ws, { t: 'error', message: 'unknown_call' });
      clearTimeout(entry.timer);
      entry.state = 'active';
      entry.startedAt = now();
      store.updateCall(callId, { state: 'active' });
      hub.sendToUser(entry.callerId, {
        t: 'call.answer',
        callId,
        from: userId,
        sdp: frame.sdp || null,
        answer: frame.answer || null,
      });
      return;
    }

    case 'call.ice': {
      const callId = String(frame.callId || '');
      let entry = activeCalls.get(callId);
      if (!entry) {
        // The caller starts gathering candidates before the server assigned an
        // id, so fall back to "the ringing call between these two users".
        const peerId = String(frame.to || '');
        for (const c of activeCalls.values()) {
          if (
            (c.callerId === userId && c.calleeId === peerId) ||
            (c.calleeId === userId && c.callerId === peerId)
          ) {
            entry = c;
            break;
          }
        }
      }
      if (!entry) return;
      // an ICE restart carries a fresh offer: deliver it as a re-invite
      if (frame.restart && frame.sdp) {
        const other0 = entry.callerId === userId ? entry.calleeId : entry.callerId;
        hub.sendToUser(other0, { t: 'call.restart', callId: entry.callId, from: userId, sdp: frame.sdp });
        return;
      }
      const other = entry.callerId === userId ? entry.calleeId : entry.calleeId === userId ? entry.callerId : null;
      if (!other) return;
      hub.sendToUser(other, { t: 'call.ice', callId, from: userId, candidate: frame.candidate ?? null, candidates: frame.candidates ?? null });
      return;
    }

    case 'call.decline': {
      const callId = String(frame.callId || '');
      const entry = activeCalls.get(callId);
      if (!entry) return;
      if (entry.calleeId === userId) {
        store.updateCall(callId, { state: 'declined', endReason: 'declined', endedAt: now() });
        clearTimeout(entry.timer);
        activeCalls.delete(callId);
        hub.sendToUser(entry.callerId, { t: 'call.decline', callId, to: userId });
        addCallMessage(entry, 'declined');
      } else if (entry.callerId === userId) {
        endCall(callId, 'cancelled', userId);
        addCallMessage(entry, 'cancelled');
      }
      return;
    }

    case 'call.busy': {
      const callId = String(frame.callId || '');
      const entry = activeCalls.get(callId);
      if (!entry || entry.calleeId !== userId) return;
      clearTimeout(entry.timer);
      activeCalls.delete(callId);
      store.updateCall(callId, { state: 'busy', endReason: 'busy', endedAt: now() });
      hub.sendToUser(entry.callerId, { t: 'call.busy', callId, to: userId });
      return;
    }

    case 'call.end': {
      const callId = String(frame.callId || '');
      const entry = activeCalls.get(callId);
      if (!entry) return;
      const durationMs = Number(frame.durationMs || (entry.startedAt ? now() - entry.startedAt : 0));
      store.updateCall(callId, {
        state: 'ended',
        endedAt: now(),
        durationMs,
        endReason: String(frame.reason || 'ended'),
        quality: typeof frame.quality === 'string' ? frame.quality.slice(0, 2000) : '',
      });
      endCall(callId, 'ended', userId, durationMs);
      addCallMessage(entry, 'ended', durationMs);
      return;
    }

    case 'call.media': {
      // switch between audio-only and video during a call (weak network fallback)
      const callId = String(frame.callId || '');
      const entry = activeCalls.get(callId);
      if (!entry) return;
      const other = entry.callerId === userId ? entry.calleeId : entry.calleeId === userId ? entry.callerId : null;
      if (!other) return;
      hub.sendToUser(other, { t: 'call.media', callId, from: userId, video: !!frame.video, reason: String(frame.reason || '') });
      return;
    }

    case 'call.quality': {
      const callId = String(frame.callId || '');
      const entry = activeCalls.get(callId);
      if (!entry) return;
      entry.quality = frame.stats || null;
      return;
    }

    case 'event': {
      // privacy events: screenshot / screen recording, shown live to the peer
      const convId = String(frame.conversationId || '');
      if (!convId || !store.isMember(convId, userId)) return;
      const kind = String(frame.type || '');
      const sender = store.getUserById(userId);
      const who = sender?.name?.trim() || 'الطرف الآخر';
      const labels = {
        screenshot: `📸 ${who} التقط لقطة للشاشة`,
        recording: `⏺️ ${who} بدأ تسجيل الشاشة`,
        recording_stop: `⏹️ ${who} أوقف تسجيل الشاشة`,
      };
      if (!labels[kind]) return;

      // simple throttle: one notice of the same kind every 4 seconds
      const key = `${userId}:${convId}:${kind}`;
      const last = eventThrottle.get(key) || 0;
      if (now() - last < 4000) return;
      eventThrottle.set(key, now());

      const message = store.createMessage({
        conversationId: convId,
        senderId: userId,
        type: 'system',
        body: labels[kind],
        mediaMeta: { event: kind, meta: frame.meta || null },
      });
      const view = store.getMessage(message.id);
      for (const m of store.listMembers(convId)) {
        if (m.id === userId) continue;
        const delivered = hub.sendToUser(m.id, {
          t: 'event',
          type: kind,
          conversationId: convId,
          userId,
          name: sender?.name || '',
          message: view,
        });
        hub.sendToUser(m.id, { t: 'message', message: view });
        if (!delivered) {
          pushMessage(sender, m, store.getConversation(convId), labels[kind]).catch(() => {});
        }
      }
      return;
    }

    case 'chat': {
      // lightweight alternative to the REST endpoint (used by the web client)
      const convId = String(frame.conversationId || '');
      if (!convId || !store.isMember(convId, userId)) return send(ws, { t: 'error', message: 'not_a_member' });
      const message = store.createMessage({
        conversationId: convId,
        senderId: userId,
        type: frame.type || 'text',
        body: sanitizeText(String(frame.body || '')),
        mediaUrl: String(frame.mediaUrl || ''),
        mediaMeta: frame.mediaMeta || null,
        replyTo: frame.replyTo || null,
        clientId: String(frame.clientId || ''),
      });
      const view = store.getMessage(message.id);
      send(ws, { t: 'ack', clientId: view.clientId, message: view });
      for (const m of store.listMembers(convId)) {
        if (m.id === userId) continue;
        hub.sendToUser(m.id, { t: 'message', message: view });
      }
      return;
    }

    default:
      return send(ws, { t: 'error', message: 'unknown_type', type });
  }
}

function addCallMessage(entry, state, durationMs = 0) {
  try {
    if (!entry.conversationId) return;
    const labels = {
      missed: { audio: 'مكالمة صوتية فائتة', video: 'مكالمة فيديو فائتة' },
      declined: { audio: 'مكالمة صوتية مرفوضة', video: 'مكالمة فيديو مرفوضة' },
      cancelled: { audio: 'مكالمة صوتية ملغاة', video: 'مكالمة فيديو ملغاة' },
      ended: { audio: 'مكالمة صوتية', video: 'مكالمة فيديو' },
    };
    const created = store.createMessage({
      conversationId: entry.conversationId,
      senderId: entry.callerId,
      type: 'call',
      body: labels[state]?.[entry.type] || 'مكالمة',
      mediaMeta: { callId: entry.callId, state, type: entry.type, durationMs, direction: 'out' },
    });
    const view = store.getMessage(created.id);
    for (const uid of [entry.callerId, entry.calleeId]) {
      hub.sendToUser(uid, { t: 'message', message: view });
    }
  } catch (err) {
    log('ws: call message failed', err.message);
  }
}

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    heartbeat(ws);
    const ctx = { userId: null, authed: false };
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    const authed = (user) => {
      ctx.userId = user.id;
      ctx.authed = true;
      ws.userId = user.id;
      hub.addSocket(user.id, ws);
      send(ws, {
        t: 'ready',
        user: store.publicUser(user),
        serverTime: now(),
        unread: totalUnread(user.id),
      });
    };

    if (token) {
      const payload = verifyToken(token);
      if (payload?.sub) {
        const user = store.getUserById(payload.sub);
        if (user) authed(user);
      }
    }

    const authTimeout = setTimeout(() => {
      if (!ctx.authed) {
        send(ws, { t: 'error', message: 'auth_timeout' });
        ws.close(4001, 'auth_timeout');
      }
    }, 15_000);

    ws.on('message', (raw) => {
      if (!ws._rlKey) ws._rlKey = `${Date.now()}-${Math.random().toString(36).slice(2)}-${ws.userId || 'anon'}`;
      if (!limiter.check(ws._rlKey).ok) return;
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return send(ws, { t: 'error', message: 'bad_json' });
      }

      if (!ctx.authed) {
        if (frame.t === 'hello' && frame.token) {
          const payload = verifyToken(String(frame.token));
          const user = payload?.sub ? store.getUserById(payload.sub) : null;
          if (!user) {
            send(ws, { t: 'error', message: 'unauthorized' });
            return ws.close(4003, 'unauthorized');
          }
          clearTimeout(authTimeout);
          authed(user);
          return;
        }
        return send(ws, { t: 'error', message: 'unauthorized' });
      }

      try {
        handle(ws, ctx, frame);
      } catch (err) {
        log('ws: handler error', err.message);
        send(ws, { t: 'error', message: 'internal_error' });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (ctx.authed && ctx.userId) {
        hub.removeSocket(ctx.userId, ws);
        // any ringing/active call of this user must be closed
        for (const [callId, entry] of [...activeCalls]) {
          if (entry.callerId === ctx.userId || entry.calleeId === ctx.userId) {
            if (entry.state === 'active') endCall(callId, 'ended', ctx.userId, entry.startedAt ? now() - entry.startedAt : 0);
            else {
              clearTimeout(entry.timer);
              activeCalls.delete(callId);
              store.updateCall(callId, { state: 'failed', endReason: 'disconnected', endedAt: now() });
              const other = entry.callerId === ctx.userId ? entry.calleeId : entry.callerId;
              hub.sendToUser(other, { t: 'call.end', callId, reason: 'disconnected' });
            }
          }
        }
      }
    });

    ws.on('error', () => {
      /* noop */
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* noop */
      }
    }
  }, 30_000);
  interval.unref?.();
  wss.on('close', () => clearInterval(interval));

  log(`ws: gateway ready on /ws (heartbeat ${config.socketTimeout}s)`);
  return wss;
}

function totalUnread(userId) {
  const rows = store.all(
    `SELECT c.id FROM conversations c JOIN participants p ON p.conversation_id = c.id WHERE p.user_id = ?`,
    userId
  );
  return rows.reduce((sum, r) => sum + store.unreadCount(r.id, userId), 0);
}
