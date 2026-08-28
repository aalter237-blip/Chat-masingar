package io.masingar.chat.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM with the additional authenticated data (AAD) our protocol
 * binds every ciphertext to: conversation id + sender + receiver.
 * Layout: nonce (12) || ciphertext || tag (16).
 */
object Aead {

    private const val NONCE_LEN = 12
    private const val TAG_BITS = 128

    fun seal(key: ByteArray, plaintext: ByteArray, aad: ByteArray, nonce: ByteArray? = null): Pair<ByteArray, ByteArray> {
        val iv = nonce ?: ByteArray(NONCE_LEN).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(plaintext) to iv
    }

    fun open(key: ByteArray, nonce: ByteArray, ciphertext: ByteArray, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(aad)
        return cipher.doFinal(ciphertext)
    }
}
