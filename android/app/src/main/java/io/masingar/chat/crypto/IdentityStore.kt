package io.masingar.chat.crypto

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.IvParameterSpec

/**
 * Long term X25519 identity of this account/device.
 *
 * The private key never leaves the process in clear text on disk: it is
 * wrapped with an AES key that lives in the Android keystore (hardware backed
 * whenever the device has one). Only the public key is published to the
 * server, which stores it as an opaque string.
 */
class IdentityStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("masingar.e2ee", Context.MODE_PRIVATE)

    @Volatile
    private var privateKeyBytes: ByteArray? = null

    /** Cleared when the account is logged out: a new account = new identity. */
    fun privateKey(): ByteArray? {
        privateKeyBytes?.let { return it }
        val stored = prefs.getString("private", null) ?: return generate()
        val plain = runCatching { unwrap(Base64.decode(stored, Base64.DEFAULT)) }.getOrNull()
        if (plain != null && plain.size == 32) {
            privateKeyBytes = plain
            return plain
        }
        return generate()
    }

    fun publicKey(): ByteArray? {
        val priv = privateKey() ?: return null
        return runCatching { X25519.publicKey(priv) }.getOrNull()
    }

    fun publicKeyB64(): String? = publicKey()?.let { Base64.encodeToString(it, Base64.NO_WRAP) }

    fun ready(): Boolean = privateKey() != null && publicKey() != null

    fun clear() {
        privateKeyBytes = null
        prefs.edit().clear().apply()
        runCatching {
            KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }.deleteEntry(ALIAS)
        }
    }

    private fun generate(): ByteArray? {
        val key = X25519.generatePrivateKey()
        val wrapped = runCatching { wrap(key) }.getOrNull() ?: return null
        prefs.edit().putString("private", Base64.encodeToString(wrapped, Base64.DEFAULT)).apply()
        privateKeyBytes = key
        return key
    }

    /* --------------------------- keystore wrapping -------------------------- */

    private fun masterKey(): SecretKey {
        fun open(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        if (open().getEntry(ALIAS, null) is KeyStore.SecretKeyEntry) {
            return (open().getEntry(ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
        }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_CBC)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_PKCS7)
                .setKeySize(256)
                .build(),
        )
        gen.generateKey()
        return (open().getEntry(ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
    }

    private fun wrap(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/CBC/PKCS7Padding")
        cipher.init(Cipher.ENCRYPT_MODE, masterKey())
        return cipher.iv + cipher.doFinal(plain)
    }

    private fun unwrap(blob: ByteArray): ByteArray {
        if (blob.size <= 16) throw IllegalArgumentException("bad blob")
        val cipher = Cipher.getInstance("AES/CBC/PKCS7Padding")
        cipher.init(Cipher.DECRYPT_MODE, masterKey(), IvParameterSpec(blob.copyOfRange(0, 16)))
        return cipher.doFinal(blob.copyOfRange(16, blob.size))
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "masingar_identity_master"

        /** Keystore backed AES is available from Marshmallow onwards. */
        val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
    }
}
