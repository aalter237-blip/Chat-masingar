/**
 * ماسنجر لايت — اختبار الجاهزية للتشغيل المتواصل:
 * 1) محادثة فعلية بين طرفين عبر WebSocket (استلام لحظي متبادل)
 * 2) إعادة تشغيل السيرفر (SIGTERM) والتحقق من:
 *    - بقاء الأعضاء والرسائل والمنشورات (ملف JSON)
 *    - بقاء الجلسات صالحة بعد إعادة التشغيل
 * 3) توكن مُلغى يُرفض على WebSocket بالكود 4001
 *
 * التشغيل:  npm test   (يشغّل هذا بعد اختبار الـ API)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const PORT = 3893;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'masingar-live-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
function startServer() {
  return spawn(process.execPath, ['server/src/index.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, CODE_RESEND_MS: '50' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/api/circle');
      if (r.ok) return true;
    } catch { /* لم يقلع بعد */ }
    await sleep(300);
  }
  return false;
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server || server.exitCode !== null) return resolve();
    server.on('exit', resolve);
    server.kill('SIGTERM');
    setTimeout(() => { try { server.kill('SIGKILL'); } catch { /* سبق */ } resolve(); }, 4000);
  });
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* فارغ */ }
  return { status: res.status, data };
}

async function joinAs(phone, name) {
  const req = await call('/api/auth/request', { method: 'POST', body: { phone } });
  const ver = await call('/api/auth/verify', { method: 'POST', body: { phone, code: req.data.code, name } });
  assert.equal(ver.status, 200, `verify ${phone}`);
  return ver.data.token;
}

/** يفتح WebSocket ويعيد كائن الاستماع للأحداث. */
function listen(token) {
  const events = [];
  const done = new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
    ws.on('message', (raw) => {
      const ev = JSON.parse(raw);
      events.push(ev);
    });
    ws.on('close', (code) => resolve(code));
    listen.sockets.push(ws);
  });
  return { events, done };
}
listen.sockets = [];

const waitFor = async (fn, desc, timeout = 6000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(120);
  }
  throw new Error('انتهت المهلة: ' + desc);
};

let passed = 0;
const test = (name, fn) => fn().then(() => { passed += 1; console.log('  ✓', name); }).catch((err) => {
  console.error('  ✗', name, '\n   ', err.message);
  cleanup(1);
});

function cleanup(code) {
  for (const ws of listen.sockets) try { ws.close(); } catch { /* سبق */ }
  try { server && server.kill('SIGKILL'); } catch { /* سبق */ }
  setTimeout(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* مشغول */ }
    process.exit(code);
  }, 300);
}

console.log('ماسنجر لايت — اختبار محادثة حقيقية + إعادة تشغيل\n');

server = startServer();
if (!(await waitUp())) { console.error('السيرفر لم يقلع'); cleanup(1); }

let t1, t2;
await test('تسجيل عضوين', async () => {
  t1 = await joinAs('967771000011', 'خالد');
  t2 = await joinAs('967771000012', 'هدى');
  const st = await call('/api/state', { token: t1 });
  assert.equal(st.data.members.length, 2);
});

let khaled, huda;
await test('طرفان متصلان يستلمان الأحداث لحظياً', async () => {
  khaled = listen(t1);
  huda = listen(t2);
  await waitFor(() => khaled.events.some((e) => e.type === 'hello'), 'hello لخالد');
  await waitFor(() => huda.events.some((e) => e.type === 'hello'), 'hello لهدى');
});

await test('رسالة من خالد تصل هدى لحظياً (والعكس)', async () => {
  const r = await call('/api/messages', { method: 'POST', token: t1, body: { text: 'مرحبا هدى، كيف حالك؟' } });
  assert.equal(r.status, 200);
  await waitFor(() => huda.events.some((e) => e.type === 'message' && e.message.text.includes('هدى')), 'وصول الرسالة لهدى');

  const r2 = await call('/api/messages', { method: 'POST', token: t2, body: { text: 'بخير يا خالد!' } });
  assert.equal(r2.status, 200);
  await waitFor(() => khaled.events.some((e) => e.type === 'message' && e.message.text.includes('بخير')), 'وصول الرد لخالد');
});

await test('مؤشر «يكتب الآن» يصل للطرف الآخر', async () => {
  const r = await call('/api/typing', { method: 'POST', token: t2 });
  assert.equal(r.status, 200);
  await waitFor(() => khaled.events.some((e) => e.type === 'typing'), 'إشعار الكتابة');
});

await test('منشور وإعجاب وتعليق تصل لحظياً', async () => {
  const p = await call('/api/posts', { method: 'POST', token: t1, body: { text: 'منشوى المساء' } });
  assert.equal(p.status, 200);
  await waitFor(() => huda.events.some((e) => e.type === 'post'), 'وصول المنشور');

  const lk = await call(`/api/posts/${p.data.post.id}/like`, { method: 'POST', token: t2 });
  assert.equal(lk.status, 200);
  await waitFor(() => khaled.events.some((e) => e.type === 'like'), 'وصول الإعجاب');

  const cm = await call(`/api/posts/${p.data.post.id}/comments`, { method: 'POST', token: t2, body: { text: 'سعيد بذلك!' } });
  assert.equal(cm.status, 200);
  await waitFor(() => khaled.events.some((e) => e.type === 'comment'), 'وصول التعليق');
});

await test('حذف رسالة يُبثّ للطرف الآخر', async () => {
  const m = await call('/api/messages', { method: 'POST', token: t1, body: { text: 'رسالة ستُحذف' } });
  await waitFor(() => huda.events.some((e) => e.type === 'message'), 'وصولها أولاً');
  const d = await call(`/api/messages/${m.data.message.id}`, { method: 'DELETE', token: t1 });
  assert.equal(d.status, 200);
  await waitFor(() => huda.events.some((e) => e.type === 'message_deleted'), 'بث الحذف');
});

await test('إعادة تشغيل السيرفر — البيانات تبقى والجلسات تبقى', async () => {
  // أغغلق الاتصالات أولاً
  for (const ws of listen.sockets) try { ws.close(); } catch { /* سبق */ }
  listen.sockets = [];

  await stopServer();
  server = startServer();
  assert.ok(await waitUp(), 'السيرفر أقلع بعد إعادة التشغيل');

  // الجلسة القديمة نفسها ما زالت صالحة (التوكن محفوظ في ملف البيانات)
  const st = await call('/api/state', { token: t2 });
  assert.equal(st.status, 200, 'الجلسة صالحة بعد إعادة التشغيل');
  assert.equal(st.data.members.length, 2, 'العضوان باقيان');
  assert.ok(st.data.messages.some((m) => m.text === 'بخير يا خالد!'), 'الرسائل باقية');
  assert.ok(st.data.posts.some((p) => p.text === 'منشوى المساء'), 'المنشورات باقية');

  // والاتصال اللحظي يعمل بنفس الجلسة بعد إعادة التشغيل
  const again = listen(t2);
  await waitFor(() => again.events.some((e) => e.type === 'hello'), 'hello بعد إعادة التشغيل');
});

await test('توكن مزيّف يُرفض على WebSocket بالكود 4001', async () => {
  const bad = listen('this-is-not-a-real-token');
  const code = await bad.done;
  assert.equal(code, 4001);
});

await test('ضغط رسائل متتالية سريعة (تسلسل وسلامة)', async () => {
  const results = [];
  for (let i = 1; i <= 15; i++) {
    results.push(call('/api/messages', { method: 'POST', token: t1, body: { text: `رسالة متتالية رقم ${i}` } }));
  }
  const all = await Promise.all(results);
  assert.ok(all.every((r) => r.status === 200));
  const st = await call('/api/state', { token: t1 });
  const texts = st.data.messages.map((m) => m.text);
  for (let i = 1; i <= 15; i++) assert.ok(texts.includes(`رسالة متتالية رقم ${i}`), `الرسالة ${i} موجودة`);
});

console.log(`\nتم: ${passed} اختبارات ناجحة ✓ (محادثة حقيقية + إعادة تشغيل)`);
cleanup(0);
