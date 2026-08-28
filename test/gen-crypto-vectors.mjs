/**
 * Generates reference vectors for the Kotlin (Android) crypto code with Node's
 * OpenSSL-backed implementation, then test/verify-crypto.py replays the very
 * same operations and compares byte for byte.
 *
 *   node test/gen-crypto-vectors.mjs > test/crypto-vectors.json
 */
import { webcrypto as crypto } from 'node:crypto';

const subtle = crypto.subtle;
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

function clamp(k) {
  const out = Uint8Array.from(k);
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

/** Raw 32 byte X25519 privates are accepted through PKCS#8 (last 32 bytes). */
async function importPrivate(raw) {
  const pkcs8 = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e,
    0x04, 0x22, 0x04, 0x20, ...raw,
  ]);
  return subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
}
async function importPublic(raw) {
  return subtle.importKey('raw', raw, { name: 'X25519' }, true, []);
}

const vectors = { x25519: [], hkdf: [], aead: [] };

/* ---------------- X25519: keypairs and every pair's shared secret ---------- */
const privates = [];
const publics = [];
for (let i = 0; i < 6; i += 1) {
  const k = clamp(crypto.getRandomValues(new Uint8Array(32)));
  const priv = await importPrivate(k);
  // derive against the base point 9 to obtain the matching public key
  const basePub = await importPublic(Uint8Array.from([9, ...new Array(31).fill(0)]));
  const sharedWithBase = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: basePub }, priv, 256));
  privates.push(k);
  publics.push(sharedWithBase);
}
for (let i = 0; i < privates.length; i += 1) {
  vectors.x25519.push({ private: b64(privates[i]), public: b64(publics[i]) });
}
for (let i = 0; i < privates.length; i += 1) {
  for (let j = i; j < publics.length; j += 1) {
    const priv = await importPrivate(privates[i]);
    const pub = await importPublic(publics[j]);
    const bits = await subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256);
    vectors.x25519.push({
      a: b64(privates[i]),
      b: b64(publics[j]),
      shared: b64(new Uint8Array(bits)),
    });
  }
}

/* ------------------------------- HKDF-SHA-256 ------------------------------ */
for (let i = 0; i < 8; i += 1) {
  const ikm = crypto.getRandomValues(new Uint8Array(32));
  const salt = i === 0 ? new Uint8Array(0) : crypto.getRandomValues(new Uint8Array(32));
  const info = new TextEncoder().encode(`masingar|v1|c_${i}|u_a|u_b`);
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const okm = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, 44 * 8);
  vectors.hkdf.push({ ikm: b64(ikm), salt: b64(salt), info: b64(info), okm: b64(new Uint8Array(okm)) });
}

/* -------------------------------- AES-256-GCM ------------------------------ */
for (let i = 0; i < 8; i += 1) {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`masingar|v1|c_${i}|u_a|u_b`);
  const plain = crypto.getRandomValues(new Uint8Array(1 + i * 37));
  const aes = await subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, aes, plain);
  vectors.aead.push({
    key: b64(key),
    nonce: b64(nonce),
    aad: b64(aad),
    plain: b64(plain),
    ct: b64(new Uint8Array(ct)),
  });
}

process.stdout.write(`${JSON.stringify(vectors, null, 2)}\n`);
