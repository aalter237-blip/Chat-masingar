/**
 * Unit test for the browser E2EE module (web/js/crypto.js).
 * Runs under Node.js >= 20 (WebCrypto X25519 + AES-GCM + HKDF).
 *
 *   node test/e2ee-web.mjs
 */
import { webcrypto } from 'node:crypto';

// minimal browser shims the module expects
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const { E2EE, CryptoEngine, isSupported, toB64 } = await import('../web/js/crypto.js');

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

const supported = await isSupported();
console.log(`\nMasingar E2EE test (X25519 supported: ${supported})\n`);

if (!supported) {
  console.log('  ! this Node build lacks X25519 - skipping');
  process.exit(0);
}

/* two devices */
// each device keeps its own identity storage
const alice = new CryptoEngine();
await alice.init();
store.clear();
const bob = new CryptoEngine();
await bob.init();
store.clear();
const eve = new CryptoEngine();
await eve.init();

const alicePub = await alice.publicKeyB64();
const bobPub = await bob.publicKeyB64();

check('identity keys generated', alicePub.length > 40 && bobPub.length > 40);
check('identities differ', alicePub !== bobPub);

await alice.rememberPeer('bob', bobPub);
await bob.rememberPeer('alice', alicePub);
check('peers registered', alice.hasPeer('bob') && bob.hasPeer('alice'));

/* 1:1 round trip */
const payload = { t: 'text', x: 'مرحبا 👋 سرّي جداً' };
const body = await alice.encryptDirect({
  conversationId: 'c1',
  peerId: 'bob',
  myId: 'alice',
  payload,
});
check('envelope produced', !!body && body.length > 40);
check('ciphertext hides the plaintext', !body.includes('مرحبا'));

const opened = await bob.decryptDirect({ conversationId: 'c1', peerId: 'alice', myId: 'bob', body });
check('recipient decrypts', opened && opened.x === payload.x, JSON.stringify(opened));

/* wrong recipient cannot open it */
const eveOpened = await eve
  .decryptDirect({ conversationId: 'c1', peerId: 'alice', myId: 'eve', body })
  .catch(() => null);
check('third party cannot decrypt', !eveOpened || eveOpened.x !== payload.x);

/* tampering is detected */
const raw = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
const tampered = { ...raw, ct: toB64(new Uint8Array(Buffer.from(raw.ct, 'base64')).map((b, i) => (i === 0 ? b ^ 1 : b))) };
const tamperedBody = Buffer.from(JSON.stringify(tampered)).toString('base64');
const tamperedOpened = await bob
  .decryptDirect({ conversationId: 'c1', peerId: 'alice', myId: 'bob', body: tamperedBody })
  .catch(() => null);
check('tampering rejected (GCM auth)', !tamperedOpened);

/* group keys */
const groupKey = await alice.createGroupKey('g1');
const wrappedForBob = await alice.wrapGroupKey('g1', groupKey, 'bob', 'alice');
check('group key wrapped for member', !!wrappedForBob?.enc);
const unwrapped = await bob.unwrapGroupKey('g1', wrappedForBob, 'bob', 'alice');
check('member unwraps the group key', !!unwrapped && Buffer.compare(Buffer.from(unwrapped), Buffer.from(groupKey)) === 0);

const groupBody = await alice.encryptGroup({ conversationId: 'g1', senderId: 'alice', payload: { t: 'text', x: 'سر المجموعة' } });
const groupOpened = await bob.decryptGroup({ conversationId: 'g1', senderId: 'alice', envelope: JSON.parse(Buffer.from(groupBody, 'base64').toString('utf8')) });
check('group message round trip', groupOpened?.x === 'سر المجموعة');

/* media */
const file = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'text/plain' });
file.arrayBuffer = async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
const enc = await alice.encryptFile(file);
check('file encrypted', !!enc.blob && Buffer.compare(Buffer.from(enc.key, 'base64'), Buffer.alloc(32)) !== 0);
const dec = await bob.decryptMedia(await enc.blob.arrayBuffer(), enc.key, enc.nonce);
check('file decrypts to the original bytes', Buffer.compare(Buffer.from(dec), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])) === 0);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
