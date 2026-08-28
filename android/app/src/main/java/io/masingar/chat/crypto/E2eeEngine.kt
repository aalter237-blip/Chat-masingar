package io.masingar.chat.crypto

import android.content.Context
import android.util.Base64
import androidx.annotation.WorkerThread
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * The Masingar end-to-end encryption protocol (version 1).
 *
 * It is byte for byte compatible with web/js/crypto.js, so a message written
 * on the web client opens on Android and the other way round. The server only
 * ever sees the base64 envelope below plus the encrypted attachment.
 *
 *   identity   X25519 key pair per account, wrapped by the Android keystore.
 *   1:1        X25519(ephemeral, peer identity) -> HKDF-SHA-256 -> AES-256-GCM
 *              AAD/context: "masingar|v1|<conversation>|<from>|<to>"
 *   groups     random 32 byte group key -> AES-256-GCM
 *              AAD/context: "masingar|g1|<conversation>|<sender>"
 *              the key itself is wrapped per member with
 *              "masingar|gk1|<conversation>|<author>|<member>"
 *   files      AES-256-GCM, AAD "masingar|media|v1"
 *
 * Envelopes (base64 of the JSON) carry {v, epk, n, ct} for 1:1 and
 * {v, g, n, ct} for groups.
 */
object E2eeEngine {

    private const val DIRECT = "masingar|v1"
    private const val GROUP = "masingar|g1"
    private const val GROUP_KEY = "masingar|gk1"
    private const val MEDIA = "masingar|media|v1"
    private const val STORAGE_SALT = "masingar|storage|v1"
    private const val FILE_NAME = "e2ee-groups.json"

    private val random = SecureRandom()
    private val peers = HashMap<String, ByteArray>()
    private val groupKeys = HashMap<String, ByteArray>()

    private var store: IdentityStore? = null
    private var storageKey: ByteArray? = null

    @Volatile
    var myId: String = ""
        private set

    @Volatile
    var supported: Boolean = false
        private set

    /**
     * Loads (or creates) the identity and the cached group keys.
     * Must be called from a background thread after logging in.
     */
    @WorkerThread
    fun init(context: Context, myId: String) {
        this.myId = myId
        if (!IdentityStore.supported) {
            supported = false
            return
        }
        val s = runCatching { IdentityStore(context) }.getOrNull() ?: run {
            supported = false
            return
        }
        store = s
        supported = s.ready()
        if (supported) {
            storageKey = runCatching {
                Hkdf.derive(s.privateKey()!!, STORAGE_SALT.toByteArray(), STORAGE_SALT.toByteArray(), 32)
            }.getOrNull()
            loadGroupKeys(context)
        }
    }

    fun logout(context: Context) {
        peers.clear()
        groupKeys.clear()
        store?.clear()
        store = null
        storageKey = null
        supported = false
        myId = ""
        runCatching { File(context.filesDir, FILE_NAME).delete() }
    }

    fun publicKeyB64(): String? = store?.publicKeyB64()

    fun rememberPeer(userId: String, publicKeyB64: String?) {
        if (publicKeyB64.isNullOrBlank() || userId.isBlank()) return
        val raw = runCatching { Base64.decode(publicKeyB64, Base64.DEFAULT) }.getOrNull() ?: return
        if (raw.size != 32) return
        peers[userId] = raw
    }

    fun hasPeer(userId: String): Boolean = peers.containsKey(userId)

    fun forgetPeer(userId: String) = peers.remove(userId)

    /* --------------------------------- 1:1 ---------------------------------- */

    /**
     * Encrypts a JSON payload for one recipient.
     * @return the envelope (base64) or null when encryption is impossible.
     */
    /**
     * Encrypts a JSON payload for one recipient.
     * The envelope also carries a copy sealed for ourselves (sn/sct): the
     * ephemeral key is reused against our own identity key, so our sent
     * messages stay readable after a restart.
     */
    fun encryptDirect(conversationId: String, peerId: String, payload: String): String? {
        val priv = store?.privateKey() ?: return null
        val myPub = store?.publicKey() ?: return null
        val peerKey = peers[peerId] ?: return null
        val bytes = payload.toByteArray()
        val ephPriv = X25519.generatePrivateKey(random)
        val ephPub = runCatching { X25519.publicKey(ephPriv) }.getOrNull() ?: return null
        val shared = runCatching { X25519.sharedSecret(ephPriv, peerKey) }.getOrNull() ?: return null
        val info = "$DIRECT|$conversationId|$myId|$peerId".toByteArray()
        val key = Hkdf.derive(shared, ephPub, info, 32)
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val ct = runCatching { Aead.seal(key, bytes, info, nonce).first }.getOrNull() ?: return null

        val selfShared = runCatching { X25519.sharedSecret(ephPriv, myPub) }.getOrNull() ?: return null
        val selfInfo = "$DIRECT|$conversationId|$myId|$myId".toByteArray()
        val selfKey = Hkdf.derive(selfShared, ephPub, selfInfo, 32)
        val selfNonce = ByteArray(12).also { random.nextBytes(it) }
        val selfCt = runCatching { Aead.seal(selfKey, bytes, selfInfo, selfNonce).first }.getOrNull()
            ?: return null

        return envelope(ephPub, nonce, ct, selfNonce, selfCt)
    }

    /** @return the decrypted JSON payload, or null. */
    fun decryptDirect(conversationId: String, peerId: String, body: String): String? {
        val priv = store?.privateKey() ?: return null
        val env = runCatching { JSONObject(String(fromB64(body))) }.getOrNull() ?: return null
        if (env.optInt("v", 0) != 1) return null
        if (env.optInt("g", 0) == 1) return decryptGroup(conversationId, peerId, body)
        // our own messages are opened with the self copy (sn/sct)
        val mine = peerId == myId
        val nonceKey = if (mine) "sn" else "n"
        val ctKey = if (mine) "sct" else "ct"
        val epk = runCatching { fromB64(env.optString("epk")) }.getOrNull() ?: return null
        val n = runCatching { fromB64(env.optString(nonceKey)) }.getOrNull() ?: return null
        val ct = runCatching { fromB64(env.optString(ctKey)) }.getOrNull() ?: return null
        val shared = runCatching { X25519.sharedSecret(priv, epk) }.getOrNull() ?: return null
        val info = "$DIRECT|$conversationId|$peerId|$myId".toByteArray()
        val key = Hkdf.derive(shared, epk, info, 32)
        val plain = runCatching { Aead.open(key, n, ct, info) }.getOrNull() ?: return null
        return String(plain)
    }

    /* -------------------------------- groups -------------------------------- */

    fun groupKey(conversationId: String): ByteArray? = groupKeys[conversationId]

    fun createGroupKey(conversationId: String): ByteArray {
        val key = ByteArray(32).also { random.nextBytes(it) }
        groupKeys[conversationId] = key
        return key
    }

    /** Wraps the group key for one member: {enc, nonce, epk}. */
    fun wrapGroupKey(conversationId: String, key: ByteArray, memberId: String, authorId: String): JSONObject? {
        if (memberId == myId) return null
        val peerKey = peers[memberId] ?: return null
        val ephPriv = X25519.generatePrivateKey(random)
        val ephPub = runCatching { X25519.publicKey(ephPriv) }.getOrNull() ?: return null
        val shared = runCatching { X25519.sharedSecret(ephPriv, peerKey) }.getOrNull() ?: return null
        val info = "$GROUP_KEY|$conversationId|$authorId|$memberId".toByteArray()
        val wrapKey = Hkdf.derive(shared, ephPub, info, 32)
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val ct = runCatching { Aead.seal(wrapKey, key, info, nonce).first }.getOrNull() ?: return null
        return JSONObject().apply {
            put("enc", toB64(ct))
            put("nonce", toB64(nonce))
            put("epk", toB64(ephPub))
        }
    }

    /** Opens and caches the group key the creator wrapped for us. */
    fun unwrapGroupKey(conversationId: String, record: JSONObject?, authorId: String): Boolean {
        val priv = store?.privateKey() ?: return false
        if (authorId.isBlank() || authorId == myId) return false
        val epk = runCatching { fromB64(record?.optString("epk") ?: "") }.getOrNull() ?: return false
        val nonce = runCatching { fromB64(record?.optString("nonce") ?: "") }.getOrNull() ?: return false
        val ct = runCatching { fromB64(record?.optString("enc") ?: "") }.getOrNull() ?: return false
        val shared = runCatching { X25519.sharedSecret(priv, epk) }.getOrNull() ?: return false
        val info = "$GROUP_KEY|$conversationId|$authorId|$myId".toByteArray()
        val wrapKey = Hkdf.derive(shared, epk, info, 32)
        val key = runCatching { Aead.open(wrapKey, nonce, ct, info) }.getOrNull() ?: return false
        if (key.size != 32) return false
        groupKeys[conversationId] = key
        return true
    }

    fun encryptGroup(conversationId: String, senderId: String, payload: String): String? {
        val key = groupKeys[conversationId] ?: return null
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val info = "$GROUP|$conversationId|$senderId".toByteArray()
        val ct = runCatching { Aead.seal(key, payload.toByteArray(), info, nonce).first }.getOrNull() ?: return null
        return envelope(g = true, null, nonce, ct)
    }

    fun decryptGroup(conversationId: String, senderId: String, body: String): String? {
        val key = groupKeys[conversationId] ?: return null
        val env = runCatching { JSONObject(String(fromB64(body))) }.getOrNull() ?: return null
        val n = runCatching { fromB64(env.optString("n")) }.getOrNull() ?: return null
        val ct = runCatching { fromB64(env.optString("ct")) }.getOrNull() ?: return null
        val info = "$GROUP|$conversationId|$senderId".toByteArray()
        val plain = runCatching { Aead.open(key, n, ct, info) }.getOrNull() ?: return null
        return String(plain)
    }

    /* --------------------------------- files -------------------------------- */

    data class SealedFile(val bytes: ByteArray, val key: String, val nonce: String)

    /** Encrypts an attachment before it is uploaded. */
    fun encryptFile(bytes: ByteArray): SealedFile {
        val key = ByteArray(32).also { random.nextBytes(it) }
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val aad = MEDIA.toByteArray()
        val ct = Aead.seal(key, bytes, aad, nonce).first
        return SealedFile(ct, toB64(key), toB64(nonce))
    }

    /** Decrypts a downloaded attachment. */
    fun decryptFile(bytes: ByteArray, keyB64: String, nonceB64: String): ByteArray? {
        val key = runCatching { fromB64(keyB64) }.getOrNull() ?: return null
        val nonce = runCatching { fromB64(nonceB64) }.getOrNull() ?: return null
        return runCatching { Aead.open(key, nonce, bytes, MEDIA.toByteArray()) }.getOrNull()
    }

    fun isMediaEncrypted(meta: JSONObject?): Boolean =
        !meta?.optString("k").isNullOrBlank() && !meta?.optString("n").isNullOrBlank()

    /* ------------------------------ persistence ------------------------------ */

    private fun loadGroupKeys(context: Context) {
        val key = storageKey ?: return
        val file = File(context.filesDir, FILE_NAME)
        if (!file.exists()) return
        runCatching {
            val json = JSONObject(file.readText())
            val keys = json.keys()
            while (keys.hasNext()) {
                val convId = keys.next()
                val obj = json.optJSONObject(convId) ?: continue
                val ct = fromB64(obj.optString("k"))
                val nonce = fromB64(obj.optString("n"))
                val plain = Aead.open(key, nonce, ct, STORAGE_SALT.toByteArray())
                if (plain.size == 32) groupKeys[convId] = plain
            }
        }
    }

    /** Persist the group keys (encrypted with a key derived from the identity). */
    fun saveGroupKeys(context: Context) {
        val key = storageKey ?: return
        if (groupKeys.isEmpty()) return
        runCatching {
            val json = JSONObject()
            for ((convId, gk) in groupKeys) {
                val nonce = ByteArray(12).also { random.nextBytes(it) }
                val ct = Aead.seal(key, gk, STORAGE_SALT.toByteArray(), nonce).first
                json.put(convId, JSONObject().apply {
                    put("k", toB64(ct))
                    put("n", toB64(nonce))
                })
            }
            File(context.filesDir, FILE_NAME).writeText(json.toString())
        }
    }

    fun dropGroupKey(conversationId: String) {
        groupKeys.remove(conversationId)
    }

    /* --------------------------------- utils --------------------------------- */

    private fun envelope(g: Boolean, epk: ByteArray?, nonce: ByteArray, ct: ByteArray): String {
        val json = JSONObject().apply {
            put("v", 1)
            if (g) put("g", 1)
            if (epk != null) put("epk", toB64(epk))
            put("n", toB64(nonce))
            put("ct", toB64(ct))
        }
        return toB64(json.toString().toByteArray())
    }

    private fun envelope(
        epk: ByteArray,
        nonce: ByteArray,
        ct: ByteArray,
        selfNonce: ByteArray,
        selfCt: ByteArray,
    ): String {
        val json = JSONObject().apply {
            put("v", 1)
            put("epk", toB64(epk))
            put("n", toB64(nonce))
            put("ct", toB64(ct))
            put("sn", toB64(selfNonce))
            put("sct", toB64(selfCt))
        }
        return toB64(json.toString().toByteArray())
    }

    fun toB64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    fun fromB64(value: String): ByteArray = Base64.decode(value, Base64.DEFAULT)
}
