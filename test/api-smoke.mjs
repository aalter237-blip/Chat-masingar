/**
 * ماسنجر لايت — اختبار سريع لواجهة الـ API كاملة.
 * يشغّل سيرفر اختباري على مجلد بيانات مؤقت ثم يفحص:
 * الدخول بالهاتف، حد الأعضاء (٥)، المنشورات، الإعجابات، التعليقات، الدردشة.
 *
 * التشغيل:  npm test
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 3891;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'masingar-lite-'));

const server = spawn(process.execPath, ['server/src/index.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JOIN_CODE: '', CODE_RESEND_MS: '400' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  assert.equal(req.status, 200, `request code for ${phone}`);
  const ver = await call('/api/auth/verify', {
    method: 'POST',
    body: { phone, code: req.data.code, name },
  });
  assert.equal(ver.status, 200, `verify ${phone}`);
  return ver.data.token;
}

let passed = 0;
const test = (name, fn) => fn().then(() => { passed += 1; console.log('  ✓', name); }).catch((err) => {
  console.error('  ✗', name, '\n   ', err.message);
  cleanup(1);
});

function cleanup(code) {
  server.kill();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* مشغول */ }
  process.exit(code);
}

/* انتظار إقلاع السيرفر */
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { up = (await fetch(BASE + '/api/circle')).ok; } catch { await sleep(250); }
}
if (!up) { console.error('السيرفر لم يقلع'); cleanup(1); }

console.log('ماسنجر لايت — اختبار الـ API\n');

await test('معلومات الدائرة عامة', async () => {
  const r = await call('/api/circle');
  assert.equal(r.data.total, 5);
  assert.equal(r.data.members, 0);
  assert.equal(r.data.joinCodeRequired, false);
});

let ahmed;
await test('تسجيل أول عضو برقم الهاتف', async () => {
  ahmed = await joinAs('967771000001', 'أحمد');
  const st = await call('/api/state', { token: ahmed });
  assert.equal(st.status, 200);
  assert.equal(st.data.me.phone, '967771000001');
  assert.equal(st.data.members.length, 1);
});

await test('رقم غير صحيح يُرفض', async () => {
  const r = await call('/api/auth/request', { method: 'POST', body: { phone: '123' } });
  assert.equal(r.status, 400);
});

await test('كود خاطئ يُرفض', async () => {
  const req = await call('/api/auth/request', { method: 'POST', body: { phone: '967771000001' } });
  const r = await call('/api/auth/verify', { method: 'POST', body: { phone: '967771000001', code: '000000' } });
  assert.equal(r.status, 400);
});

await test('منشور + إعجاب + تعليق', async () => {
  const p = await call('/api/posts', { method: 'POST', token: ahmed, body: { text: 'أول منشور في الدائرة' } });
  assert.equal(p.status, 200);
  const id = p.data.post.id;

  const lk = await call(`/api/posts/${id}/like`, { method: 'POST', token: ahmed });
  assert.deepEqual(lk.data.likes, [p.data.post.author.id]);

  const c = await call(`/api/posts/${id}/comments`, { method: 'POST', token: ahmed, body: { text: 'تعليق أول' } });
  assert.equal(c.status, 200);

  const empty = await call('/api/posts', { method: 'POST', token: ahmed, body: {} });
  assert.equal(empty.status, 400);
});

await test('دردشة الدائرة', async () => {
  const m = await call('/api/messages', { method: 'POST', token: ahmed, body: { text: 'مرحبا بالجميع' } });
  assert.equal(m.status, 200);
  const st = await call('/api/state', { token: ahmed });
  assert.ok(st.data.messages.some((x) => x.text === 'مرحبا بالجميع'));

  const d = await call(`/api/messages/${m.data.message.id}`, { method: 'DELETE', token: ahmed });
  assert.equal(d.status, 200);
});

await test('املاء الدائرة حتى ٥ أعضاء', async () => {
  await joinAs('967771000002', 'سارة');
  await joinAs('967771000003', 'محمد');
  await joinAs('967771000004', 'فاطمة');
  await joinAs('967771000005', 'سالم');
  const st = await call('/api/state', { token: ahmed });
  assert.equal(st.data.members.length, 5);
});

await test('العضو السادس مرفوض — الدائرة مكتملة', async () => {
  const r = await call('/api/auth/request', { method: 'POST', body: { phone: '967771000006' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'circle_full');
});

await test('الأعضاء الحاليون يدخلون دائماً (تسجيل دخول مجدد)', async () => {
  await sleep(500); // احترم فترة إعادة إرسال الكود
  const req = await call('/api/auth/request', { method: 'POST', body: { phone: '967771000002' } });
  assert.equal(req.status, 200);
  const ver = await call('/api/auth/verify', { method: 'POST', body: { phone: '967771000002', code: req.data.code } });
  assert.equal(ver.status, 200);
  assert.equal(ver.data.created, false);
});

await test('بدون توكن لا وصول', async () => {
  const r = await call('/api/state');
  assert.equal(r.status, 401);
});

await test('تعديل الاسم', async () => {
  const r = await call('/api/me', { method: 'PUT', token: ahmed, body: { name: 'أحمد الجديد' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.me.name, 'أحمد الجديد');
});

console.log(`\nتم: ${passed} اختبارات ناجحة ✓`);
cleanup(0);
