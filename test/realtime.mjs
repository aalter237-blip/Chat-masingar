/**
 * فحص واختبار اتصال الويب سوكيت اللحظي (WebSocket Realtime)
 */
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const BASE = process.env.TEST_URL || 'http://localhost:3000';
const WS_URL = BASE.replace(/^http/, 'ws');

async function runRealtimeTest() {
  console.log('⚡ بدء فحص اتصال الويب سوكيت اللحظي على:', WS_URL);

  // 1. تسجيل مستخدم للحصول على التوكن
  const phone = '+966500000002';
  const reqRes = await fetch(`${BASE}/api/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  }).then((r) => r.json());

  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: reqRes.code, name: 'مختبر اللحظي' }),
  }).then((r) => r.json());

  const token = verifyRes.token;
  assert.ok(token, 'Token required for websocket');

  // 2. فتح اتصال WebSocket
  const ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}`);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timed out'));
    }, 5000);

    ws.on('open', () => {
      console.log('  ✓ تم فتح اتصال الويب سوكيت بنجاح');
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'hello') {
          console.log('  ✓ تم استلام رسالة الترحيب hello من الخادم بنجاح');
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  console.log('🎉 اكتمل فحص اتصال الويب سوكيت اللحظي بنجاح تام!');
}

runRealtimeTest().catch((err) => {
  console.error('❌ فشل فحص الويب سوكيت:', err);
  process.exit(1);
});
