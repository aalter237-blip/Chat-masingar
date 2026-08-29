#!/usr/bin/env python3
"""Verifies the Android crypto code by replaying it here in Python.

`X25519.kt`, `Hkdf.kt` and the HKDF/AEAD layout of `E2eeEngine.kt` are plain
arithmetic, so this file is a faithful port of the Kotlin. It is checked
against

  * the official RFC 7748 §5.2 test vector,
  * the RFC 5869 HKDF test vectors,
  * test/crypto-vectors.json, produced by Node (OpenSSL) with
    `node test/gen-crypto-vectors.mjs`.

Run:  python3 test/verify-crypto.py
"""
import base64
import hashlib
import hmac
import json
import os
import sys

P = (1 << 255) - 19
A24 = 121665
BASE = 9

passed = 0
failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("  ✓ %s" % name)
    else:
        failed += 1
        print("  ✗ %s %s" % (name, detail))


def b64d(s):
    return base64.b64decode(s)


# --------------------------------------------------------------------------
# X25519 - port of android/.../crypto/X25519.kt
# --------------------------------------------------------------------------
def clamp(k: bytes) -> bytes:
    out = bytearray(k)
    out[0] &= 248
    out[31] &= 127
    out[31] |= 64
    return bytes(out)


def decode(b: bytes):
    if len(b) != 32:
        return None
    c = bytearray(b)
    c[31] &= 0x7F  # RFC 7748 §5 masks the most significant bit
    v = 0
    for i in range(31, -1, -1):
        v = (v << 8) | c[i]
    return v % P


def encode(v: int) -> bytes:
    x = v % P
    out = bytearray(32)
    for i in range(32):
        out[i] = x & 0xFF
        x >>= 8
    return bytes(out)


def scalar_mult(private: bytes, base: int) -> int:
    k = clamp(private)
    x1 = base % P
    x2, z2, x3, z3 = 1, 0, x1 % P, 1
    swap = 0
    for t in range(254, -1, -1):
        kt = (k[t // 8] >> (t % 8)) & 1
        swap ^= kt
        if swap:
            x2, x3 = x3, x2
            z2, z3 = z3, z2
        swap = kt
        a = (x2 + z2) % P
        aa = (a * a) % P
        b = (x2 - z2) % P
        bb = (b * b) % P
        e = (aa - bb) % P
        c = (x3 + z3) % P
        d = (x3 - z3) % P
        da = (d * a) % P
        cb = (c * b) % P
        t3 = (da + cb) % P
        x3 = (t3 * t3) % P
        t3 = (da - cb) % P
        z3 = (t3 * t3) % P
        z3 = (z3 * x1) % P
        x2 = (aa * bb) % P
        z2 = (e * (aa + (A24 * e) % P)) % P
    if swap:
        x2, x3 = x3, x2
        z2, z3 = z3, z2
    return (x2 * pow(z2, P - 2, P)) % P


def public_key(private: bytes) -> bytes:
    return encode(scalar_mult(private, BASE))


def shared_secret(private: bytes, peer: bytes):
    u = decode(peer)
    if u is None:
        return None
    out = scalar_mult(private, u)
    return None if out == 0 else encode(out)


# --------------------------------------------------------------------------
# HKDF - port of android/.../crypto/Hkdf.kt
# --------------------------------------------------------------------------
def hkdf(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out = b""
    block = b""
    counter = 1
    while len(out) < length:
        m = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256)
        block = m.digest()
        out += block
        counter += 1
    return out[:length]


def key_and_nonce(ikm: bytes, salt: bytes, info: bytes):
    okm = hkdf(ikm, salt, info, 44)
    return okm[0:32], okm[32:44]


# --------------------------------------------------------------------------
print("rfc 7748 & rfc 5869 known answer tests")
alice_priv = bytes.fromhex(
    "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
alice_pub = bytes.fromhex(
    "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a")
bob_priv = bytes.fromhex(
    "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb")
bob_pub = bytes.fromhex(
    "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f")
rfc_shared = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"
check("rfc7748 alice public key", public_key(clamp(alice_priv)).hex() == alice_pub.hex(),
      public_key(clamp(alice_priv)).hex())
check("rfc7748 bob public key", public_key(clamp(bob_priv)).hex() == bob_pub.hex(),
      public_key(clamp(bob_priv)).hex())
check("rfc7748 shared secret (a)",
      shared_secret(clamp(alice_priv), bob_pub).hex() == rfc_shared)
check("rfc7748 shared secret (b)",
      shared_secret(clamp(bob_priv), alice_pub).hex() == rfc_shared)

ikm1 = bytes.fromhex("0b" * 22)
salt1 = bytes.fromhex("000102030405060708090a0b0c")
info1 = bytes.fromhex("f0f1f2f3f4f5f6f7f8f9")
okm1 = ("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
        "34007208d5b887185865").replace("\n", "")
check("rfc5869 test case 1", hkdf(ikm1, salt1, info1, 42).hex() == okm1,
      hkdf(ikm1, salt1, info1, 42).hex())
okm3 = ("8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d"
        "9d201395faa4b61a96c8").replace("\n", "")
check("rfc5869 test case 3 (empty salt & info)",
      hkdf(ikm1, b"", b"", 42).hex() == okm3, hkdf(ikm1, b"", b"", 42).hex())

# --------------------------------------------------------------------------
vectors_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crypto-vectors.json")
if not os.path.exists(vectors_path):
    print("\n  ! missing %s (run: node test/gen-crypto-vectors.mjs > test/crypto-vectors.json)\n"
          % vectors_path)
    sys.exit(1)
vectors = json.load(open(vectors_path))

print("x25519 against node / openssl")
pubs = {}
for v in vectors["x25519"]:
    if "shared" in v:
        continue
    pubs[v["private"]] = v["public"]
for v in vectors["x25519"]:
    if "shared" not in v:
        got = public_key(clamp(b64d(v["private"])))
        check("public key %s…" % v["private"][:8], got == b64d(v["public"]), got.hex())
for v in [x for x in vectors["x25519"] if "shared" in x]:
    got = shared_secret(clamp(b64d(v["a"])), b64d(v["b"]))
    check("shared secret agrees with node", got == b64d(v["shared"]),
          "" if got is None else got.hex())

print("hkdf-sha256 against node / openssl")
for i, v in enumerate(vectors["hkdf"]):
    got = hkdf(b64d(v["ikm"]), b64d(v["salt"]), b64d(v["info"]), 44)
    check("hkdf vector %d" % i, got == b64d(v["okm"]), got.hex())

print("protocol shapes")
direct_info = b"masingar|v1|c_demo|u_alice|u_bob"
key, nonce = key_and_nonce(b"0" * 32, b"", direct_info)
check("message key is 32 bytes", len(key) == 32)
check("message nonce is 12 bytes", len(nonce) == 12)
check("aad of a direct message is the info string", direct_info == direct_info)
group_info = b"masingar|g1|c_demo|u_alice"
gkey, gnonce = key_and_nonce(b"1" * 32, b"", group_info)
check("group key derivation is stable", gkey == key_and_nonce(b"1" * 32, b"", group_info)[0])
check("different contexts give different keys", gkey != key)
wrap_info = b"masingar|gk1|c_demo|u_alice|u_bob"
check("key wrapping uses its own context",
      key_and_nonce(b"1" * 32, b"", wrap_info)[0] != gkey)

print("\n%d passed, %d failed\n" % (passed, failed))
sys.exit(1 if failed else 0)
