/**
 * Faithful JavaScript port of the Kotlin crypto used by the Android app
 * (android/app/src/main/java/io/masingar/chat/crypto/{X25519,Hkdf,Aead,E2eeEngine}.kt).
 *
 * It exists so the tests can prove that the Android implementation speaks the
 * exact same protocol as the web client, without needing an emulator.
 * Keep this file in sync with the Kotlin sources.
 */
import crypto from 'node:crypto';

const P = (1n << 255n) - 19n;
const A24 = 121665n;

function clamp(k) {
  const out = Buffer.from(k);
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}
function decode(b) {
  if (b.length !== 32) return null;
  const c = Buffer.from(b);
  c[31] &= 0x7f;
  let v = 0n;
  for (let i = 31; i >= 0; i -= 1) v = (v << 8n) | BigInt(c[i]);
  return v % P;
}
function encode(v) {
  let x = v % P;
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
function mod(v) {
  const r = v % P;
  return r >= 0n ? r : r + P;
}
function scalarMult(privateKey, basePoint) {
  const k = clamp(privateKey);
  const x1 = mod(basePoint);
  let x2 = 1n;
  let z2 = 0n;
  let x3 = mod(basePoint);
  let z3 = 1n;
  let swap = 0;
  for (let t = 254; t >= 0; t -= 1) {
    const kt = (k[t >> 3] >> (t % 8)) & 1;
    swap ^= kt;
    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = kt;
    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    let t3 = mod(da + cb);
    x3 = mod(t3 * t3);
    t3 = mod(da - cb);
    z3 = mod(mod(t3 * t3) * x1);
    x2 = mod(aa * bb);
    z2 = mod(e * (aa + mod(A24 * e)));
  }
  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }
  let inv = 1n;
  let exp = P - 2n;
  let base = mod(z2);
  while (exp > 0n) {
    if (exp & 1n) inv = mod(inv * base);
    base = mod(base * base);
    exp >>= 1n;
  }
  return mod(x2 * inv);
}
const X25519 = {
  generatePrivateKey: () => clamp(crypto.randomBytes(32)),
  publicKey: (priv) => encode(scalarMult(priv, 9n)),
  sharedSecret: (priv, peer) => {
    const u = decode(peer);
    if (u === null) return null;
    const out = scalarMult(priv, u);
    return out === 0n ? null : encode(out);
  },
};

function hkdf(ikm, salt, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const out = [];
  let block = Buffer.alloc(0);
  let counter = 1;
  let total = 0;
  while (total < length) {
    block = crypto.createHmac('sha256', prk)
      .update(block).update(info).update(Buffer.from([counter])).digest();
    out.push(block);
    total += block.length;
    counter += 1;
  }
  return Buffer.concat(out).subarray(0, length);
}
const Aead = {
  seal(key, plain, aad, nonce) {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  },
  open(key, nonce, ct, aad) {
    const body = ct.subarray(0, ct.length - 16);
    const tag = ct.subarray(ct.length - 16);
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(body), cipher.final()]);
  },
};

/** Port of io.masingar.chat.crypto.E2eeEngine (object -> class). */
class AndroidEngine {
  constructor(myId) {
    this.myId = myId;
    this.priv = X25519.generatePrivateKey();
    this.pub = X25519.publicKey(this.priv);
    this.peers = new Map();
    this.groupKeys = new Map();
    this.random = (n) => crypto.randomBytes(n);
  }

  publicKeyB64() {
    return this.pub.toString('base64');
  }

  rememberPeer(userId, b64) {
    this.peers.set(userId, Buffer.from(b64, 'base64'));
  }

  encryptDirect(conversationId, peerId, payload) {
    const peerKey = this.peers.get(peerId);
    if (!peerKey) return null;
    const bytes = Buffer.from(payload);
    const ephPriv = X25519.generatePrivateKey();
    const ephPub = X25519.publicKey(ephPriv);
    const shared = X25519.sharedSecret(ephPriv, peerKey);
    const info = Buffer.from(`masingar|v1|${conversationId}|${this.myId}|${peerId}`);
    const key = hkdf(shared, ephPub, info, 32);
    const nonce = this.random(12);
    const ct = Aead.seal(key, bytes, info, nonce);

    // copy sealed for ourselves so our own history stays readable
    const selfShared = X25519.sharedSecret(ephPriv, this.pub);
    const selfInfo = Buffer.from(`masingar|v1|${conversationId}|${this.myId}|${this.myId}`);
    const selfKey = hkdf(selfShared, ephPub, selfInfo, 32);
    const selfNonce = this.random(12);
    const selfCt = Aead.seal(selfKey, bytes, selfInfo, selfNonce);

    return Buffer.from(JSON.stringify({
      v: 1,
      epk: ephPub.toString('base64'),
      n: nonce.toString('base64'),
      ct: ct.toString('base64'),
      sn: selfNonce.toString('base64'),
      sct: selfCt.toString('base64'),
    })).toString('base64');
  }

  decryptDirect(conversationId, peerId, body) {
    let env;
    try {
      env = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    } catch {
      return null;
    }
    if (env.v !== 1) return null;
    if (env.g === 1) return this.decryptGroup(conversationId, peerId, body);
    const mine = peerId === this.myId;
    const epk = Buffer.from(env.epk, 'base64');
    const nonce = Buffer.from(mine ? env.sn : env.n, 'base64');
    const ct = Buffer.from(mine ? env.sct : env.ct, 'base64');
    const shared = X25519.sharedSecret(this.priv, epk);
    if (!shared) return null;
    const info = Buffer.from(`masingar|v1|${conversationId}|${peerId}|${this.myId}`);
    const key = hkdf(shared, epk, info, 32);
    try {
      return Aead.open(key, nonce, ct, info).toString('utf8');
    } catch {
      return null;
    }
  }

  createGroupKey(conversationId) {
    const key = this.random(32);
    this.groupKeys.set(conversationId, key);
    return key;
  }

  wrapGroupKey(conversationId, key, memberId, authorId) {
    const peerKey = this.peers.get(memberId);
    if (!peerKey) return null;
    const ephPriv = X25519.generatePrivateKey();
    const ephPub = X25519.publicKey(ephPriv);
    const shared = X25519.sharedSecret(ephPriv, peerKey);
    const info = Buffer.from(`masingar|gk1|${conversationId}|${authorId}|${memberId}`);
    const wrapKey = hkdf(shared, ephPub, info, 32);
    const nonce = this.random(12);
    const ct = Aead.seal(wrapKey, key, info, nonce);
    return { enc: ct.toString('base64'), nonce: nonce.toString('base64'), epk: ephPub.toString('base64') };
  }

  unwrapGroupKey(conversationId, record, authorId) {
    if (!record || authorId === this.myId) return false;
    const epk = Buffer.from(record.epk, 'base64');
    const nonce = Buffer.from(record.nonce, 'base64');
    const ct = Buffer.from(record.enc, 'base64');
    const shared = X25519.sharedSecret(this.priv, epk);
    if (!shared) return false;
    const info = Buffer.from(`masingar|gk1|${conversationId}|${authorId}|${this.myId}`);
    const wrapKey = hkdf(shared, epk, info, 32);
    try {
      const key = Aead.open(wrapKey, nonce, ct, info);
      if (key.length !== 32) return false;
      this.groupKeys.set(conversationId, key);
      return true;
    } catch {
      return false;
    }
  }

  encryptGroup(conversationId, senderId, payload) {
    const key = this.groupKeys.get(conversationId);
    if (!key) return null;
    const nonce = this.random(12);
    const info = Buffer.from(`masingar|g1|${conversationId}|${senderId}`);
    const ct = Aead.seal(key, Buffer.from(payload), info, nonce);
    return Buffer.from(JSON.stringify({ v: 1, g: 1, n: nonce.toString('base64'), ct: ct.toString('base64') })).toString('base64');
  }

  decryptGroup(conversationId, senderId, body) {
    const key = this.groupKeys.get(conversationId);
    if (!key) return null;
    const env = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    const nonce = Buffer.from(env.n, 'base64');
    const ct = Buffer.from(env.ct, 'base64');
    const info = Buffer.from(`masingar|g1|${conversationId}|${senderId}`);
    try {
      return Aead.open(key, nonce, ct, info).toString('utf8');
    } catch {
      return null;
    }
  }

  encryptFile(bytes) {
    const key = this.random(32);
    const nonce = this.random(12);
    const ct = Aead.seal(key, bytes, Buffer.from('masingar|media|v1'), nonce);
    return { bytes: ct, key: key.toString('base64'), nonce: nonce.toString('base64') };
  }

  decryptFile(bytes, keyB64, nonceB64) {
    try {
      return Aead.open(Buffer.from(keyB64, 'base64'), Buffer.from(nonceB64, 'base64'), bytes, Buffer.from('masingar|media|v1'));
    } catch {
      return null;
    }
  }
}

export { X25519, hkdf, Aead, AndroidEngine };
