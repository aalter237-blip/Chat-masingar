/**
 * End-to-end test against a live server:
 *
 *   web client (web/js/crypto.js, WebCrypto)      ->  REST API  ->  Android
 *   engine (test/android-engine.mjs, port of the Kotlin) and back.
 *
 * It also pushes a wallpaper and a screenshot notice through the real
 * websocket, so all three new features are exercised together.
 *
 * Start the server first (cd server && PORT=3000 SMS_PROVIDER=none node src/index.js)
 * then:  node test/e2ee-live.mjs
 */
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { AndroidEngine } from './android-engine.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
/** The demo database is persistent, so every run needs fresh client ids. */
const RUN = Date.now().toString(36);
const WS = BASE.replace(/^http/, 'ws') + '/ws';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${error?.message || error}`);
  }
}

/* ------------------------- browser shims for crypto.js ---------------------- */
const stores = new Map();
globalThis.localStorage = {
  getItem: (k) => (stores.has(k) ? stores.get(k) : null),
  setItem: (k, v) => stores.set(k, String(v)),
  removeItem: (k) => stores.delete(k),
};
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
const { E2EE } = await import('../web/js/crypto.js');

/* ------------------------------- tiny client -------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The demo numbers are rate limited like real ones, so back off and retry. */
async function api(path, { method = 'GET', token, body, retries = 4 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  if (res.status === 429 && retries > 0) {
    await sleep(12000);
    return api(path, { method, token, body, retries: retries - 1 });
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.message || ''}`);
  return json;
}

/** Minimal websocket client: enough for events and live frames. */
function socket(token) {
  const ws = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (event) => {
    let frame;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      return;
    }
    inbox.push(frame);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(frame)) {
        waiters[i].resolve(frame);
        waiters.splice(i, 1);
      }
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'hello', device: 'test' }));
    });
    ws.addEventListener('error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 8000);
    const check = setInterval(() => {
      if (inbox.some((f) => f.t === 'ready')) {
        clearInterval(check);
        resolve(true);
      }
    }, 30);
  });
  return {
    ws,
    ready,
    send: (obj) => ws.send(JSON.stringify(obj)),
    waitFor: (match, timeout = 6000) =>
      new Promise((resolve, reject) => {
        const found = inbox.find(match);
        if (found) return resolve(found);
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => reject(new Error('timeout waiting for frame')), timeout);
      }),
    close: () =>
      new Promise((resolve) => {
        if (ws.readyState === 3) return resolve(true);
        ws.addEventListener('close', () => resolve(true));
        ws.close();
        setTimeout(resolve, 2000);
      }),
  };
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
/** The server keeps one notice per (user, chat, kind) every 4 seconds. */
const waitOutThrottle = () => settle(4600);

async function login(phone) {
  const otp = await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const verified = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { phone, code: otp.devCode, name: phone.slice(-3) },
  });
  return verified;
}

/* ==================================  TESTS  ================================= */
console.log('live end-to-end: encryption, wallpaper and notices');

const alice = await login('967771000001');
const bob = await login('967771000002');
const A = alice.accessToken;
const B = bob.accessToken;
const aliceId = alice.user.id;
const bobId = bob.user.id;

assert.equal(await E2EE.init(), true, 'web engine must start');
const android = new AndroidEngine(bobId);

await test('both devices publish their public key', async () => {
  const aPub = await E2EE.publicKeyB64();
  const bPub = android.publicKeyB64();
  const resA = await api('/api/me', { method: 'PATCH', token: A, body: { public_key: aPub } });
  const resB = await api('/api/me', { method: 'PATCH', token: B, body: { public_key: bPub } });
  assert.equal(resA.user.publicKey, aPub);
  assert.equal(resB.user.publicKey, bPub);
});

await test('the server hands out the public keys with the conversation', async () => {
  const conv = await api('/api/conversations', {
    method: 'POST',
    token: A,
    body: { userId: bobId },
  });
  global.convId = conv.conversation.id;
  const list = await api('/api/conversations', { token: A });
  const found = list.conversations.find((c) => c.id === global.convId);
  const peer = found.members.find((m) => m.id === bobId);
  assert.ok(peer.publicKey, 'peer public key is served');
  await E2EE.rememberPeer(bobId, peer.publicKey);
  android.rememberPeer(aliceId, await E2EE.publicKeyB64());
});

await test('an encrypted message travels through the server and opens on android', async () => {
  const payload = { t: 'text', x: 'رسالة سرية جداً 🔐 42' };
  const body = await E2EE.encryptDirect({
    conversationId: global.convId,
    peerId: bobId,
    myId: aliceId,
    payload,
  });
  const res = await api(`/api/conversations/${global.convId}/messages`, {
    method: 'POST',
    token: A,
    body: { type: 'text', body, encrypted: true, clientId: `live1-${RUN}` },
  });
  assert.equal(res.message.encrypted, true);
  const stored = await api(`/api/conversations/${global.convId}/messages`, { token: B });
  const mine = stored.messages.find((m) => m.id === res.message.id)
    || stored.messages.find((m) => m.clientId === `live1-${RUN}`);
  assert.ok(mine, 'message is delivered');
  assert.ok(!mine.body.includes('سرية'), 'the server does not see the text');
  const opened = android.decryptDirect(global.convId, aliceId, mine.body);
  assert.equal(opened, JSON.stringify(payload));
});

await test('android answers and the web client reads it', async () => {
  const payload = JSON.stringify({ t: 'text', x: 'رد مشفّر من الأندرويد ✅' });
  const body = android.encryptDirect(global.convId, aliceId, payload);
  const res = await api(`/api/conversations/${global.convId}/messages`, {
    method: 'POST',
    token: B,
    body: { type: 'text', body, encrypted: true, clientId: `live2-${RUN}` },
  });
  const opened = await E2EE.decryptDirect({
    conversationId: global.convId,
    peerId: bobId,
    myId: aliceId,
    body: res.message.body,
  });
  assert.equal(JSON.stringify(opened), payload);
});

await test('the sender can read their own encrypted history again', async () => {
  const payload = { t: 'text', x: 'رسالة أرسلتها أنا ✍️' };
  const body = await E2EE.encryptDirect({
    conversationId: global.convId,
    peerId: bobId,
    myId: aliceId,
    payload,
  });
  const res = await api(`/api/conversations/${global.convId}/messages`, {
    method: 'POST',
    token: A,
    body: { type: 'text', body, encrypted: true, clientId: `self-${RUN}` },
  });
  // "reload": open it again as the author from the server copy
  const opened = await E2EE.decryptDirect({
    conversationId: global.convId,
    peerId: aliceId,
    myId: aliceId,
    body: res.message.body,
  });
  assert.equal(JSON.stringify(opened), JSON.stringify(payload));
});

await test('an encrypted attachment survives the upload unchanged', async () => {
  const bytes = webcrypto.getRandomValues(new Uint8Array(8192));
  const sealed = await E2EE.encryptFile({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    name: 'photo.jpg',
    size: bytes.length,
    type: 'image/jpeg',
  });
  const blob = Buffer.from(await sealed.blob.arrayBuffer());
  const form = new FormData();
  form.append('file', new Blob([blob], { type: 'application/octet-stream' }), 'photo.jpg.enc');
  const up = await fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${A}` },
    body: form,
  }).then((r) => r.json());
  assert.ok(up.url, 'upload returned a url');
  const downloaded = Buffer.from(await fetch(BASE + up.url).then((r) => r.arrayBuffer()));
  assert.equal(downloaded.toString('base64'), blob.toString('base64'), 'server stores the ciphertext as is');
  const plain = android.decryptFile(downloaded, sealed.key, sealed.nonce);
  assert.equal(Buffer.from(plain).toString('base64'), Buffer.from(bytes).toString('base64'));
  global.uploadUrl = up.url;
  global.uploadMeta = { k: sealed.key, n: sealed.nonce };
});

await test('the media message carries only the key, never the file', async () => {
  const payload = {
    t: 'media',
    m: {
      url: global.uploadUrl,
      k: global.uploadMeta.k,
      n: global.uploadMeta.n,
      mime: 'image/jpeg',
      name: 'photo.jpg',
      size: 8192,
      kind: 'image',
    },
  };
  const body = await E2EE.encryptDirect({
    conversationId: global.convId,
    peerId: bobId,
    myId: aliceId,
    payload,
  });
  const res = await api(`/api/conversations/${global.convId}/messages`, {
    method: 'POST',
    token: A,
    body: {
      type: 'image',
      body,
      encrypted: true,
      mediaUrl: global.uploadUrl,
      mediaMeta: global.uploadMeta,
      clientId: `live3-${RUN}`,
    },
  });
  assert.equal(res.message.encrypted, true);
  const opened = JSON.parse(android.decryptDirect(global.convId, aliceId, res.message.body));
  assert.equal(opened.m.name, 'photo.jpg');
  assert.equal(opened.m.k, global.uploadMeta.k);
});

await test('a group chat works end to end', async () => {
  const carol = await login('967771000003');
  global.carol = carol;
  // Carol is a third device (also running the Android engine)
  const carolEngine = new AndroidEngine(carol.user.id);
  await api('/api/me', {
    method: 'PATCH',
    token: carol.accessToken,
    body: { public_key: carolEngine.publicKeyB64() },
  });
  const conv = await api('/api/conversations', {
    method: 'POST',
    token: A,
    body: { type: 'group', title: 'عائلة', memberIds: [bobId, carol.user.id] },
  });
  global.groupId = conv.conversation.id;
  const list = await api('/api/conversations', { token: A });
  const group = list.conversations.find((c) => c.id === global.groupId);
  await E2EE.rememberPeer(carol.user.id, carolEngine.publicKeyB64());
  const key = await E2EE.createGroupKey(global.groupId);
  const forBob = await E2EE.wrapGroupKey(global.groupId, key, bobId, aliceId);
  const forCarol = await E2EE.wrapGroupKey(global.groupId, key, carol.user.id, aliceId);
  const res = await api(`/api/conversations/${global.groupId}/keys`, {
    method: 'POST',
    token: A,
    body: {
      keys: [
        { userId: bobId, enc: JSON.stringify(forBob), nonce: forBob.nonce },
        { userId: carol.user.id, enc: JSON.stringify(forCarol), nonce: forCarol.nonce },
      ],
    },
  });
  assert.equal(res.keys.length, 2);
  const mine = (await api(`/api/conversations/${global.groupId}/keys`, { token: B })).keys
    .find((k) => k.userId === bobId);
  assert.equal(android.unwrapGroupKey(global.groupId, JSON.parse(mine.enc), aliceId), true);

  const payload = { t: 'text', x: 'اجتماع العائلة غداً 🏠' };
  const body = await E2EE.encryptGroup({
    conversationId: global.groupId,
    senderId: aliceId,
    payload,
  });
  const sent = await api(`/api/conversations/${global.groupId}/messages`, {
    method: 'POST',
    token: A,
    body: { type: 'text', body, encrypted: true, clientId: `live4-${RUN}` },
  });
  assert.equal(sent.message.encrypted, true);
  assert.equal(android.decryptGroup(global.groupId, aliceId, sent.message.body), JSON.stringify(payload));

  // Carol received the same key and can read it too
  const carolKeys = await api(`/api/conversations/${global.groupId}/keys`, { token: carol.accessToken });
  const carolRow = carolKeys.keys.find((k) => k.userId === carol.user.id);
  carolEngine.rememberPeer(aliceId, await E2EE.publicKeyB64());
  assert.equal(carolEngine.unwrapGroupKey(global.groupId, JSON.parse(carolRow.enc), aliceId), true);
  assert.equal(
    carolEngine.decryptGroup(global.groupId, aliceId, sent.message.body),
    JSON.stringify(payload),
  );
});

await test('the wallpaper set by one side is served to the other', async () => {
  const wallpaper = { id: 'teal', css: 'linear-gradient(160deg,#005c4b,#0b141a)' };
  const res = await api(`/api/conversations/${global.convId}/settings`, {
    method: 'POST',
    token: A,
    body: { settings: { wallpaper } },
  });
  assert.equal(res.settings.wallpaper.id, 'teal');
  const list = await api('/api/conversations', { token: B });
  const conv = list.conversations.find((c) => c.id === global.convId);
  assert.equal(conv.settings.wallpaper.id, 'teal');
  assert.equal(conv.settings.wallpaper.css, wallpaper.css);
});

await test('the wallpaper arrives live over the websocket', async () => {
  const bobSocket = socket(B);
  await bobSocket.ready;
  const wallpaper = { id: 'sunset', css: 'linear-gradient(160deg,#7b2d5e,#f9a825)' };
  await api(`/api/conversations/${global.convId}/settings`, {
    method: 'POST',
    token: A,
    body: { settings: { wallpaper } },
  });
  const frame = await bobSocket.waitFor((f) => f.t === 'conversation:settings');
  assert.equal(frame.settings.wallpaper.id, 'sunset');
  await bobSocket.close();
  await settle();
});

await test('a screenshot is announced to the other side', async () => {
  const bobSocket = socket(B);
  await bobSocket.ready;
  const aliceSocket = socket(A);
  await aliceSocket.ready;
  await settle();
  await waitOutThrottle();
  aliceSocket.send({ t: 'event', type: 'screenshot', conversationId: global.convId, meta: { source: 'test' } });
  const event = await bobSocket.waitFor((f) => f.t === 'event' && f.type === 'screenshot', 15000);
  assert.equal(event.userId, aliceId);
  const message = await bobSocket.waitFor((f) => f.t === 'message' && f.message?.type === 'system');
  assert.ok(message.message.body.includes('لقطة'), message.message.body);
  const list = await api(`/api/conversations/${global.convId}/messages`, { token: B });
  assert.ok(
    list.messages.some((m) => m.type === 'system' && m.body.includes('لقطة')),
    'the notice stays in the chat history',
  );
  await aliceSocket.close();
  await bobSocket.close();
  await settle();
});

await test('screen recording start and stop are announced', async () => {
  const bobSocket = socket(B);
  await bobSocket.ready;
  const aliceSocket = socket(A);
  await aliceSocket.ready;
  await settle();
  aliceSocket.send({ t: 'event', type: 'recording', conversationId: global.convId });
  const started = await bobSocket.waitFor((f) => f.t === 'event' && f.type === 'recording', 15000);
  assert.ok(started.message.body.includes('تسجيل'));
  aliceSocket.send({ t: 'event', type: 'recording_stop', conversationId: global.convId });
  const stopped = await bobSocket.waitFor((f) => f.t === 'event' && f.type === 'recording_stop', 15000);
  assert.ok(stopped.message.body.includes('أوقف'));
  await aliceSocket.close();
  await bobSocket.close();
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
