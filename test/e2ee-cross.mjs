/**
 * Cross implementation test for the end-to-end encryption:
 *
 *   • the WEB engine is the real file   web/js/crypto.js        (WebCrypto)
 *   • the ANDROID engine is test/android-engine.mjs, a 1:1 port of the Kotlin
 *     in android/app/src/main/java/io/masingar/chat/crypto/
 *     (X25519.kt + Hkdf.kt + Aead.kt + E2eeEngine.kt)
 *
 * Both engines must open each other's messages, groups and files. Run with:
 *   node test/e2ee-cross.mjs
 */
import { webcrypto } from 'node:crypto';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { AndroidEngine } from './android-engine.mjs';

/* ------------------------------- tiny harness ------------------------------- */
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

/* ==================================  TESTS  ================================= */
console.log('web <-> android end-to-end encryption');

const WEB = 'u_web';
const AND = 'u_and';

assert.equal(await E2EE.init(), true, 'web engine must start (secure context)');
const android = new AndroidEngine(AND);
const webPub = await E2EE.publicKeyB64();
android.rememberPeer(WEB, webPub);
await E2EE.rememberPeer(AND, android.publicKeyB64());

// the web engine takes the payload object, the Kotlin engine a JSON string
const payloadObj = { t: 'text', x: 'مرحبا من مصر واليمن 🌍 123' };
const payload = JSON.stringify(payloadObj);

await test('web -> android opens on android', async () => {
  const body = await E2EE.encryptDirect({ conversationId: 'c1', peerId: AND, myId: WEB, payload: payloadObj });
  assert.ok(body && typeof body === 'string');
  assert.equal(android.decryptDirect('c1', WEB, body), payload);
});

await test('android -> web opens on web', async () => {
  const other = payload.replace('مصر', 'الأردن');
  const body = android.encryptDirect('c1', WEB, other);
  const opened = await E2EE.decryptDirect({ conversationId: 'c1', peerId: AND, myId: WEB, body });
  assert.equal(JSON.stringify(opened), other);
});

await test('the web client re-opens its own sent message', async () => {
  const body = await E2EE.encryptDirect({ conversationId: 'c1', peerId: AND, myId: WEB, payload: payloadObj });
  const opened = await E2EE.decryptDirect({ conversationId: 'c1', peerId: WEB, myId: WEB, body });
  assert.equal(JSON.stringify(opened), payload);
});

await test('android re-opens its own sent message', async () => {
  const body = android.encryptDirect('c1', WEB, payload);
  assert.equal(android.decryptDirect('c1', AND, body), payload);
});

await test('a third device cannot read it', async () => {
  const eve = new AndroidEngine('u_eve');
  eve.rememberPeer(WEB, webPub);
  const body = await E2EE.encryptDirect({ conversationId: 'c1', peerId: AND, myId: WEB, payload: payloadObj });
  assert.equal(eve.decryptDirect('c1', WEB, body), null);
});

await test('envelope reveals nothing but metadata', async () => {
  const body = await E2EE.encryptDirect({ conversationId: 'c1', peerId: AND, myId: WEB, payload: payloadObj });
  const text = Buffer.from(body, 'base64').toString('utf8');
  assert.ok(!text.includes('مرحبا'));
  assert.ok(!text.includes('مصر'));
  assert.ok(text.startsWith('{"v":1'), text.slice(0, 20));
});

await test('tampering with the ciphertext is rejected', async () => {
  const body = await E2EE.encryptDirect({ conversationId: 'c1', peerId: AND, myId: WEB, payload: payloadObj });
  const env = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  const ct = Buffer.from(env.ct, 'base64');
  ct[0] ^= 0x01;
  env.ct = ct.toString('base64');
  const bad = Buffer.from(JSON.stringify(env)).toString('base64');
  assert.equal(android.decryptDirect('c1', WEB, bad), null);
});

await test('the conversation id is bound to the ciphertext', async () => {
  const body = await E2EE.encryptDirect({ conversationId: 'c1', peerId: AND, myId: WEB, payload: payloadObj });
  assert.equal(android.decryptDirect('c2', WEB, body), null);
});

await test('group key: web distributes, android opens it', async () => {
  const key = await E2EE.createGroupKey('g1');
  const wrapped = await E2EE.wrapGroupKey('g1', key, AND, WEB);
  assert.ok(wrapped);
  assert.equal(android.unwrapGroupKey('g1', wrapped, WEB), true);
  assert.equal(android.groupKeys.get('g1').toString('base64'), Buffer.from(key).toString('base64'));
});

await test('group message: web -> android', async () => {
  const body = await E2EE.encryptGroup({ conversationId: 'g1', senderId: WEB, payload: payloadObj });
  assert.equal(android.decryptGroup('g1', WEB, body), payload);
});

await test('group message: android -> web', async () => {
  const body = android.encryptGroup('g1', AND, payload);
  const opened = await E2EE.decryptGroup({ conversationId: 'g1', senderId: AND, envelope: JSON.parse(Buffer.from(body, 'base64').toString('utf8')) });
  assert.equal(JSON.stringify(opened), payload);
});

await test('a non member cannot open a group message', async () => {
  const eve = new AndroidEngine('u_eve');
  const body = await E2EE.encryptGroup({ conversationId: 'g1', senderId: WEB, payload: payloadObj });
  assert.equal(eve.decryptGroup('g1', WEB, body), null);
});

await test('media: encrypted on the web, opened on android', async () => {
  const bytes = crypto.randomBytes(4096);
  const sealed = await E2EE.encryptFile({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), name: 'clip.mp4', size: bytes.length, type: 'video/mp4' });
  const plain = android.decryptFile(Buffer.from(await sealed.blob.arrayBuffer()), sealed.key, sealed.nonce);
  assert.ok(plain && plain.equals(bytes));
  assert.ok(!Buffer.from(await sealed.blob.arrayBuffer()).includes(bytes.subarray(0, 32)));
});

await test('media: encrypted on android, opened on the web', async () => {
  const bytes = crypto.randomBytes(1500);
  const sealed = android.encryptFile(bytes);
  const plain = await E2EE.decryptMedia(sealed.bytes, sealed.key, sealed.nonce);
  assert.equal(Buffer.from(plain).toString('base64'), bytes.toString('base64'));
});

await test('media: wrong key is rejected', async () => {
  const bytes = crypto.randomBytes(256);
  const sealed = android.encryptFile(bytes);
  assert.equal(android.decryptFile(sealed.bytes, android.random(32).toString('base64'), sealed.nonce), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
