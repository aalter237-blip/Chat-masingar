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
