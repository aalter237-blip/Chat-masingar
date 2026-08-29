package io.masingar.chat.crypto

import java.math.BigInteger
import java.security.SecureRandom

/**
 * X25519 (RFC 7748) key agreement.
 *
 * Implemented with BigInteger arithmetic instead of hand tuned field code:
 * a shared secret costs a couple of milliseconds on a phone, which is
 * invisible next to the network, and the code stays obviously correct and
 * constant across Android versions (no 32/64 bit limb tricks to get wrong).
 *
 * Wire format: raw 32 byte little endian u-coordinates, exactly like
 * WebCrypto's "raw" X25519 keys, so the web client and Android agree.
 */
object X25519 {

    private val P: BigInteger = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19))
    private val A24: BigInteger = BigInteger.valueOf(121665)
    private val BASE: BigInteger = BigInteger.valueOf(9)
    private val TWO: BigInteger = BigInteger.valueOf(2)

    /** 32 random bytes with the RFC 7748 clamping applied. */
    fun generatePrivateKey(random: SecureRandom = SecureRandom()): ByteArray {
        val k = ByteArray(32)
        random.nextBytes(k)
        return clamp(k)
    }

    fun clamp(k: ByteArray): ByteArray {
        if (k.size != 32) throw IllegalArgumentException("X25519 keys are 32 bytes")
        val out = k.copyOf()
        out[0] = (out[0].toInt() and 248).toByte()
        out[31] = (out[31].toInt() and 127).toByte()
        out[31] = (out[31].toInt() or 64).toByte()
        return out
    }

    /** public = X25519(private, 9) */
    fun publicKey(privateKey: ByteArray): ByteArray = encode(scalarMult(privateKey, BASE))

    /** X25519(private, peerPublic) - null when the peer key is invalid/zero. */
    fun sharedSecret(privateKey: ByteArray, peerPublic: ByteArray): ByteArray? {
        val u = decode(peerPublic) ?: return null
        val out = scalarMult(privateKey, u)
        if (out == BigInteger.ZERO) return null
        return encode(out)
    }

    private fun decode(bytes: ByteArray): BigInteger? {
        if (bytes.size != 32) return null
        val copy = bytes.copyOf()
        // RFC 7748 §5: X25519 masks the most significant bit on reception
        copy[31] = (copy[31].toInt() and 0x7F).toByte()
        var value = BigInteger.ZERO
        for (i in 31 downTo 0) {
            value = value.shiftLeft(8).or(BigInteger.valueOf((copy[i].toInt() and 0xFF).toLong()))
        }
        return value.mod(P)
    }

    private fun encode(value: BigInteger): ByteArray {
        var x = value.mod(P)
        val out = ByteArray(32)
        for (i in 0 until 32) {
            out[i] = (x.and(BigInteger.valueOf(255))).toByte()
            x = x.shiftRight(8)
        }
        return out
    }

    /** Montgomery ladder straight from RFC 7748 §5. */
    private fun scalarMult(privateKey: ByteArray, basePoint: BigInteger): BigInteger {
        val k = clamp(privateKey)
        val x1 = basePoint.mod(P)
        var x2 = BigInteger.ONE
        var z2 = BigInteger.ZERO
        var x3 = x1
        var z3 = BigInteger.ONE
        var swap = 0

        for (t in 254 downTo 0) {
            val kt = (k[t / 8].toInt() shr (t % 8)) and 1
            swap = swap xor kt
            if (swap == 1) {
                val tmpX = x2
                x2 = x3
                x3 = tmpX
                val tmpZ = z2
                z2 = z3
                z3 = tmpZ
            }
            swap = kt

            val a = x2.add(z2).mod(P)
            val aa = a.multiply(a).mod(P)
            val b = x2.subtract(z2).mod(P)
            val bb = b.multiply(b).mod(P)
            val e = aa.subtract(bb).mod(P)
            val c = x3.add(z3).mod(P)
            val d = x3.subtract(z3).mod(P)
            val da = d.multiply(a).mod(P)
            val cb = c.multiply(b).mod(P)

            var t3 = da.add(cb).mod(P)
            x3 = t3.multiply(t3).mod(P)
            t3 = da.subtract(cb).mod(P)
            z3 = t3.multiply(t3).mod(P).multiply(x1).mod(P)

            x2 = aa.multiply(bb).mod(P)
            z2 = e.multiply(aa.add(A24.multiply(e).mod(P))).mod(P)
        }

        if (swap == 1) {
            val tmpX = x2
            x2 = x3
            x3 = tmpX
            val tmpZ = z2
            z2 = z3
            z3 = tmpZ
        }

        val inverse = z2.modPow(P.subtract(TWO), P)
        return x2.multiply(inverse).mod(P)
    }
}
