package io.masingar.chat.crypto

import java.io.ByteArrayOutputStream
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HKDF (RFC 5869) with SHA-256 - the same construction WebCrypto exposes as
 * { name: "HKDF", hash: "SHA-256" }, so both clients derive identical keys.
 */
object Hkdf {

    private const val HASH_LEN = 32

    fun derive(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        require(length > 0 && length <= 255 * HASH_LEN) { "bad HKDF output length" }
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = extract.doFinal(ikm)

        val out = ByteArrayOutputStream()
        var block = ByteArray(0)
        var counter = 1
        while (out.size() < length) {
            val expand = Mac.getInstance("HmacSHA256")
            expand.init(SecretKeySpec(prk, "HmacSHA256"))
            expand.update(block)
            expand.update(info)
            expand.update(byteArrayOf(counter.toByte()))
            block = expand.doFinal()
            out.write(block)
            counter++
        }
        return out.toByteArray().copyOf(length)
    }

    /** 32 byte AES key + 12 byte GCM nonce, derived in one pass. */
    fun keyAndNonce(ikm: ByteArray, salt: ByteArray, info: ByteArray): Pair<ByteArray, ByteArray> {
        val okm = derive(ikm, salt, info, 44)
        return okm.copyOfRange(0, 32) to okm.copyOfRange(32, 44)
    }
}
