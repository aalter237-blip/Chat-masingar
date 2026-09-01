/**
 * ماسنجر لايت — بث فوري عبر WebSocket واحد.
 * presence + تحديثات المنشورات/الرسائل/التعليقات لحظياً.
 */
import { WebSocketServer } from 'ws';
import * as store from './store.js';

const clients = new Map(); // userId -> Set<ws>

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const user = store.userByToken(url.searchParams.get('token'));
    if (!user) {
      ws.close(4001, 'unauthorized');
      return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    if (!clients.has(user.id)) clients.set(user.id, new Set());
    clients.get(user.id).add(ws);

    ws.send(JSON.stringify({ type: 'hello', online: onlineIds() }));
    broadcast({ type: 'presence', id: user.id, online: true });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') return;

        // إرفاق هوية المرسل الحقيقية دائماً لمنع التزييف
        msg.from = user.id;
        msg.fromName = user.name;

        if (msg.type === 'call_invite' || msg.type === 'webrtc_offer' || msg.type === 'webrtc_answer' || msg.type === 'webrtc_ice' || msg.type === 'call_accept' || msg.type === 'call_reject' || msg.type === 'call_hangup') {
          if (msg.to && msg.to !== 'circle' && msg.to !== 'all') {
            // توجيه للطرف المستهدف مباشرة
            sendToUser(msg.to, msg);
          } else {
            // توجيه لجميع أعضاء الدائرة الآخرين
            broadcastExcept(user.id, msg);
          }
        } else if (msg.type === 'typing') {
          broadcastExcept(user.id, { type: 'typing', id: user.id, name: user.name, isTyping: !!msg.isTyping });
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    });

    ws.on('close', () => {
      const set = clients.get(user.id);
      if (set) {
        set.delete(ws);
        if (!set.size) {
          clients.delete(user.id);
          store.touchUser(user);
          broadcast({ type: 'presence', id: user.id, online: false });
        }
      }
    });
  });

  /* نبض كل ٣٠ ثانية لتنظيف الاتصالات الميتة */
  const heart = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heart));

  return wss;
}

export function onlineIds() {
  return [...clients.keys()];
}

export function broadcast(event) {
  const data = JSON.stringify(event);
  for (const set of clients.values()) {
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }
}

export function broadcastExcept(exceptUserId, event) {
  const data = JSON.stringify(event);
  for (const [userId, set] of clients.entries()) {
    if (userId === exceptUserId) continue;
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }
}

export function sendToUser(userId, event) {
  const set = clients.get(userId);
  if (!set || !set.size) return false;
  const data = JSON.stringify(event);
  let sent = false;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
      sent = true;
    }
  }
  return sent;
}
