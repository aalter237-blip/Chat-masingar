package io.masingar.chat.data

import android.content.Context
import io.masingar.chat.crypto.E2eeEngine
import io.masingar.chat.net.Http
import io.masingar.chat.net.SocketClient
import io.masingar.chat.util.Notify
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Single source of truth for the UI.
 * Writes go: local DB -> network (with an outbox for offline sends).
 * Reads come: local DB (instant) + websocket push (live).
 */
object Repository {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    lateinit var db: LocalDb
        private set

    private lateinit var appContext: Context

    private val _me = MutableStateFlow<User?>(null)
    val me: StateFlow<User?> = _me.asStateFlow()

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations.asStateFlow()

    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages.asStateFlow()

    private val _contacts = MutableStateFlow<List<ContactItem>>(emptyList())
    val contacts: StateFlow<List<ContactItem>> = _contacts.asStateFlow()

    private val _calls = MutableStateFlow<List<CallItem>>(emptyList())
    val calls: StateFlow<List<CallItem>> = _calls.asStateFlow()

    private val _presence = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val presence: StateFlow<Map<String, Boolean>> = _presence.asStateFlow()

    private val _lastSeen = MutableStateFlow<Map<String, Long>>(emptyMap())
    val lastSeen: StateFlow<Map<String, Long>> = _lastSeen.asStateFlow()

    private val _typing = MutableStateFlow<Set<String>>(emptySet())
    val typing: StateFlow<Set<String>> = _typing.asStateFlow()

    private val _ice = MutableStateFlow<List<IceServer>>(emptyList())
    val ice: StateFlow<List<IceServer>> = _ice.asStateFlow()

    private val _syncing = MutableStateFlow(false)
    val syncing: StateFlow<Boolean> = _syncing.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** True once the device identity is loaded: messages are then sealed. */
    private val _e2ee = MutableStateFlow(false)
    val e2ee: StateFlow<Boolean> = _e2ee.asStateFlow()

    /** message id (or client id) -> decrypted JSON payload of that message. */
    private val _plain = MutableStateFlow<Map<String, String>>(emptyMap())
    val plain: StateFlow<Map<String, String>> = _plain.asStateFlow()

    /** One shot notice ("the other side took a screenshot", ...). */
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    var openConversationId: String? = null
    @Volatile var foreground: Boolean = false

    @Volatile private var initialized = false

    fun init(context: Context) {
        appContext = context.applicationContext
        db = LocalDb(context.applicationContext)
        if (initialized) return
        initialized = true
        loadLocal()
        scope.launch { startE2ee(context.applicationContext) }
        scope.launch {
            SocketClient.frames.collect { frame -> onFrame(context, frame) }
        }
        scope.launch {
            SocketClient.state.collect { conn ->
                if (conn == SocketClient.Conn.CONNECTED) runCatching { refreshAll() }
            }
        }
    }

    fun consumeError() {
        _error.value = null
    }

    private fun loadLocal() {
        _me.value = Prefs.me
        _conversations.value = db.conversations()
        _contacts.value = db.contacts()
        _calls.value = db.calls()
        openConversationId?.let { _messages.value = db.messages(it) }
    }

    /* --------------------------------- sync --------------------------------- */

    /** Typing indicator (throttled by the caller). */
    fun sendTyping(convId: String, on: Boolean) {
        if (convId.isBlank()) return
        SocketClient.send("typing", "conversationId" to convId, "on" to on)
    }

    fun saveContacts(list: List<ContactItem>) {
        db.saveContacts(list)
        _contacts.value = db.contacts()
    }

    suspend fun refreshAll() = withContext(Dispatchers.IO) {
        if (!Prefs.isLoggedIn) return@withContext
        _syncing.value = true
        try {
            val conv = Http.conversations()
            val list = mutableListOf<Conversation>()
            val arr = conv.optJSONArray("conversations") ?: org.json.JSONArray()
            for (i in 0 until arr.length()) parseConversation(arr.optJSONObject(i))?.let { list += it }
            if (list.isNotEmpty()) {
                db.saveConversations(list)
                _conversations.value = db.conversations()
            }
            registerPeers()

            val callsRes = Http.calls()
            val callsList = mutableListOf<CallItem>()
            val cArr = callsRes.optJSONArray("calls") ?: org.json.JSONArray()
            for (i in 0 until cArr.length()) parseCall(cArr.optJSONObject(i))?.let { callsList += it }
            if (callsList.isNotEmpty()) {
                db.saveCalls(callsList)
                _calls.value = db.calls()
            }

            val iceRes = Http.ice()
            val iceList = mutableListOf<IceServer>()
            val iArr = iceRes.optJSONArray("iceServers") ?: org.json.JSONArray()
            for (i in 0 until iArr.length()) parseIce(iArr.optJSONObject(i))?.let { iceList += it }
            if (iceList.isNotEmpty()) _ice.value = iceList

            openConversationId?.let { loadMessages(it) }
            Prefs.lastSync = System.currentTimeMillis()
            retryOutbox()
        } catch (t: Throwable) {
            _error.value = t.message
        } finally {
            _syncing.value = false
        }
    }

    suspend fun loadMessages(convId: String) = withContext(Dispatchers.IO) {
        try {
            val res = Http.messages(convId, 200)
            val list = mutableListOf<Message>()
            val arr = res.optJSONArray("messages") ?: org.json.JSONArray()
            for (i in 0 until arr.length()) parseMessage(arr.optJSONObject(i))?.let { list += it }
            if (list.isNotEmpty()) db.saveMessages(list)
        } catch (t: Throwable) {
            // offline: whatever is cached is fine
        }
        _messages.value = db.messages(convId)
        decryptInto(_messages.value)
        scope.launch { runCatching { E2eeEngine.saveGroupKeys(appContext) } }
    }

    fun openConversation(convId: String) {
        openConversationId = convId
        _messages.value = db.messages(convId)
        scope.launch { loadMessages(convId) }
        scope.launch { runCatching { Http.read(convId) } }
        db.markConversationRead(convId)
        _conversations.update { list -> list.map { if (it.id == convId) it.copy(unread = 0) else it } }
    }

    fun closeConversation() {
        openConversationId = null
        _messages.value = emptyList()
    }

    /* --------------------------- end to end encryption ---------------------- */

    /** Loads the device identity and publishes its public key once. */
    suspend fun startE2ee(context: Context) = withContext(Dispatchers.IO) {
        if (_e2ee.value && E2eeEngine.supported) return@withContext
        val me = _me.value ?: Prefs.me ?: return@withContext
        E2eeEngine.init(context, me.id)
        _e2ee.value = E2eeEngine.supported
        if (!E2eeEngine.supported) return@withContext
        registerPeers()
        val publicKey = E2eeEngine.publicKeyB64()
        if (!publicKey.isNullOrBlank() && me.publicKey != publicKey) {
            runCatching {
                val user = parseUser(Http.updateMe(publicKey = publicKey).optJSONObject("user"))
                if (user != null) {
                    Prefs.me = user
                    _me.value = user
                }
            }
        }
        for (conv in _conversations.value.filter { it.type == "group" }) {
            if (E2eeEngine.groupKey(conv.id) == null) ensureGroupKey(conv)
        }
    }

    /** Caches the public keys of everybody we can talk to. */
    fun registerPeers() {
        if (!E2eeEngine.supported) return
        for (conv in _conversations.value) {
            for (member in conv.members) E2eeEngine.rememberPeer(member.id, member.publicKey)
            conv.peer?.let { E2eeEngine.rememberPeer(it.id, it.publicKey) }
        }
        for (contact in _contacts.value) {
            contact.user?.let { E2eeEngine.rememberPeer(it.id, it.publicKey) }
        }
    }

    /**
     * Seals a payload for one conversation.
     * @return the body to store on the server plus whether it is encrypted.
     */
    private fun seal(convId: String, payload: JSONObject): Pair<String, Boolean> {
        if (!E2eeEngine.supported) return fallbackBody(payload) to false
        val conv = _conversations.value.firstOrNull { it.id == convId }
        val json = payload.toString()
        val sealed = if (conv?.type == "group") {
            E2eeEngine.encryptGroup(convId, _me.value?.id.orEmpty(), json)
        } else {
            val peerId = conv?.peer?.id ?: conv?.members?.firstOrNull { it.id != _me.value?.id }?.id
            if (peerId != null) E2eeEngine.encryptDirect(convId, peerId, json) else null
        }
        return sealed?.let { it to true } ?: (fallbackBody(payload) to false)
    }

    /** Plain text when there is no encryption partner: the app still works. */
    private fun fallbackBody(payload: JSONObject): String =
        if (payload.optString("t") == "text") payload.optString("x") else ""

    /** Decrypts everything we can, so the UI never shows a raw envelope. */
    private suspend fun decryptInto(messages: List<Message>) {
        if (!E2eeEngine.supported) return
        val myId = _me.value?.id.orEmpty()
        val cache = _plain.value.toMutableMap()
        var changed = false
        for (message in messages) {
            if (!message.encrypted || message.type == "system") continue
            if (cache.containsKey(message.id)) continue
            val conv = _conversations.value.firstOrNull { it.id == message.conversationId }
            val opened = if (conv?.type == "group") {
                if (E2eeEngine.groupKey(message.conversationId) == null) ensureGroupKey(conv)
                E2eeEngine.decryptGroup(message.conversationId, message.senderId, message.body)
            } else {
                E2eeEngine.decryptDirect(message.conversationId, message.senderId, message.body)
            }
            if (!opened.isNullOrBlank()) {
                cache[message.id] = opened
                changed = true
            }
        }
        if (changed) _plain.value = cache
    }

    /** Text (and media description) of a message, decrypted when possible. */
    fun payloadOf(message: Message): JSONObject? {
        if (!message.encrypted) return null
        val raw = _plain.value[message.id] ?: _plain.value[message.clientId] ?: return null
        return runCatching { JSONObject(raw) }.getOrNull()
    }

    /** Downloads and decrypts an attachment into a cache file. */
    suspend fun mediaFile(context: Context, message: Message): java.io.File? = withContext(Dispatchers.IO) {
        val url = message.mediaUrl
        if (url.isBlank()) return@withContext null
        val payload = payloadOf(message)?.optJSONObject("m")
        val meta = runCatching { JSONObject(message.mediaMeta) }.getOrNull() ?: JSONObject()
        val key = meta.optString("k").ifBlank { payload?.optString("k").orEmpty() }
        val nonce = meta.optString("n").ifBlank { payload?.optString("n").orEmpty() }
        val plainFile = java.io.File(context.cacheDir, "media_${message.id}")
        if (plainFile.exists() && plainFile.length() > 0) return@withContext plainFile
        return@withContext runCatching {
            val request = okhttp3.Request.Builder().url(Http.media(url)).get().build()
            Http.client.newCall(request).execute().use { res ->
                if (!res.isSuccessful) return@runCatching null
                val bytes = res.body?.bytes() ?: return@runCatching null
                val out = if (key.isNotBlank() && nonce.isNotBlank()) {
                    E2eeEngine.decryptFile(bytes, key, nonce)
                } else {
                    bytes
                } ?: return@runCatching null
                plainFile.writeBytes(out)
                plainFile
            }
        }.getOrNull()
    }

    /** Fetches the group key that a member wrapped for us. */
    private suspend fun ensureGroupKey(conv: Conversation): Boolean {
        if (!E2eeEngine.supported) return false
        val myId = _me.value?.id.orEmpty()
        return runCatching {
            val arr: JSONArray = Http.groupKeys(conv.id).optJSONArray("keys") ?: return@runCatching false
            for (i in 0 until arr.length()) {
                val row = arr.optJSONObject(i) ?: continue
                if (row.optString("userId") != myId) continue
                val raw = row.optString("enc")
                val record = if (raw.trimStart().startsWith("{")) JSONObject(raw) else row
                val author = row.optString("by").ifBlank {
                    conv.members.firstOrNull { it.id != myId }?.id.orEmpty()
                }
                if (E2eeEngine.unwrapGroupKey(conv.id, record, author)) return@runCatching true
            }
            false
        }.getOrDefault(false)
    }

    /** Creates a group key and hands a wrapped copy to every member. */
    private suspend fun distributeGroupKey(conv: Conversation): Boolean {
        if (!E2eeEngine.supported) return false
        val myId = _me.value?.id.orEmpty()
        val key = E2eeEngine.createGroupKey(conv.id)
        val entries = JSONArray()
        for (member in conv.members) {
            if (member.id == myId) continue
            E2eeEngine.rememberPeer(member.id, member.publicKey)
            val wrapped = E2eeEngine.wrapGroupKey(conv.id, key, member.id, myId) ?: continue
            entries.put(JSONObject().apply {
                put("userId", member.id)
                put("enc", wrapped.toString())
                put("nonce", wrapped.optString("nonce"))
            })
        }
        if (entries.length() == 0) return false
        return runCatching { Http.setGroupKeys(conv.id, entries); true }.getOrDefault(false)
    }

    /* ------------------------------ shared look ----------------------------- */

    /** Sets the wallpaper of a chat: the other members see it straight away. */
    suspend fun setWallpaper(convId: String, wallpaper: Wallpaper) = withContext(Dispatchers.IO) {
        runCatching {
            val res = Http.setWallpaper(convId, wallpaper.id, wallpaper.css)
            val settings = res.optJSONObject("settings")
            if (settings != null) {
                db.updateSettings(convId, settings.toString())
                _conversations.update { list ->
                    list.map {
                        if (it.id == convId) it.copy(
                            settings = settings.toString(),
                            wallpaper = if (wallpaper.id == "none") null else wallpaper,
                        ) else it
                    }
                }
            }
        }
    }

    /* --------------------------- privacy disclosure -------------------------- */

    /** Tells the chat that this device captured (or is capturing) the screen. */
    fun reportEvent(type: String, conversationId: String? = null) {
        val convId = conversationId ?: openConversationId ?: return
        when (type) {
            "screenshot", "recording", "recording_stop" ->
                SocketClient.send("event", "type" to type, "conversationId" to convId)
        }
    }

    fun consumeNotice() {
        _notice.value = null
    }

    /* ------------------------------- sending -------------------------------- */

    /**
     * Queues a message locally, then tries to deliver it. Works offline.
     * The body is sealed end-to-end first, so the server only keeps ciphertext.
     */
    fun send(convId: String, type: String, body: String, mediaUrl: String = "", mediaMeta: String = "") {
        scope.launch {
            val payload = JSONObject().apply {
                if (type == "text") {
                    put("t", "text")
                    put("x", body)
                } else {
                    put("t", "media")
                    put("m", JSONObject().apply {
                        put("url", mediaUrl)
                        put("kind", type)
                        runCatching { JSONObject(mediaMeta) }.getOrNull()?.let { meta ->
                            for (key in meta.keys()) put(key, meta.opt(key))
                        }
                    })
                }
            }
            val conv = _conversations.value.firstOrNull { it.id == convId }
            if (conv?.type == "group" && E2eeEngine.supported && E2eeEngine.groupKey(convId) == null) {
                if (!ensureGroupKey(conv)) distributeGroupKey(conv)
            }
            val (sealedBody, encrypted) = seal(convId, payload)
            enqueue(convId, type, sealedBody, mediaUrl, mediaMeta, encrypted, payload.toString())
        }
    }

    /** Puts the message in the local DB and in the outbox, then flushes. */
    private fun enqueue(
        convId: String,
        type: String,
        body: String,
        mediaUrl: String,
        mediaMeta: String,
        encrypted: Boolean,
        payloadJson: String = "",
    ) {
        val clientId = "a${System.currentTimeMillis()}${(0..9999).random()}"
        val pending = Message(
            id = "local:$clientId",
            conversationId = convId,
            senderId = _me.value?.id.orEmpty(),
            type = type,
            body = body,
            mediaUrl = mediaUrl,
            mediaMeta = mediaMeta,
            clientId = clientId,
            status = "sending",
            createdAt = System.currentTimeMillis(),
            encrypted = encrypted,
        )
        db.saveMessages(listOf(pending))
        db.enqueue(pending)
        if (payloadJson.isNotBlank()) {
            // our own messages cannot be re-opened (one time ephemeral key)
            _plain.update { it + (clientId to payloadJson) }
        }
        if (convId == openConversationId) _messages.value = db.messages(convId)
        _conversations.update { list ->
            list.map { if (it.id == convId) it.copy(lastMessage = pending, updatedAt = pending.createdAt) else it }
                .sortedByDescending { it.updatedAt }
        }
        scope.launch { retryOutbox() }
    }

    /** Delivers everything queued in the outbox, oldest first. */
    suspend fun retryOutbox() = withContext(Dispatchers.IO) {
        if (!Prefs.isLoggedIn) return@withContext
        val pending = db.pending()
        for (m in pending) {
            try {
                val meta = m.mediaMeta.takeIf { it.isNotBlank() }?.let { runCatching { JSONObject(it) }.getOrNull() }
                val res = Http.send(m.conversationId, m.type, m.body, m.mediaUrl, meta, m.clientId, m.encrypted)
                val saved = parseMessage(res.optJSONObject("message"))
                if (saved != null) {
                    _plain.value[m.clientId]?.let { json ->
                        _plain.update { cache -> cache + (saved.id to json) }
                    }
                    db.removeFromOutbox(m.clientId)
                    db.deleteMessage("local:${m.clientId}")
                    db.saveMessages(listOf(saved))
                    if (m.conversationId == openConversationId) _messages.value = db.messages(m.conversationId)
                    _conversations.update { list ->
                        list.map { if (it.id == m.conversationId) it.copy(lastMessage = saved, updatedAt = saved.createdAt) else it }
                            .sortedByDescending { it.updatedAt }
                    }
                }
            } catch (t: Throwable) {
                db.bumpAttempts(m.clientId)
                // keep it queued: WorkManager retries later
                break
            }
        }
    }

    suspend fun deleteMessage(id: String) = withContext(Dispatchers.IO) {
        db.deleteMessage(id)
        if (id.startsWith("local:")) {
            db.removeFromOutbox(id.removePrefix("local:"))
        } else {
            runCatching { Http.deleteMessage(id) }
        }
        openConversationId?.let { _messages.value = db.messages(it) }
    }

    suspend fun editMessage(id: String, body: String) = withContext(Dispatchers.IO) {
        runCatching { Http.editMessage(id, body) }
        openConversationId?.let { loadMessages(it) }
    }

    /* ------------------------------ conversations --------------------------- */

    suspend fun startDirect(userId: String): String? = withContext(Dispatchers.IO) {
        val res = runCatching { Http.createDirect(userId) }.getOrNull()
        val conv = parseConversation(res?.optJSONObject("conversation"))
        if (conv != null) {
            db.saveConversations(listOf(conv))
            _conversations.value = db.conversations()
        }
        conv?.id
    }

    suspend fun startDirectByPhone(phone: String): String? = withContext(Dispatchers.IO) {
        val res = runCatching { Http.createDirectByPhone(phone) }.getOrNull()
        val conv = parseConversation(res?.optJSONObject("conversation"))
        if (conv != null) {
            db.saveConversations(listOf(conv))
            _conversations.value = db.conversations()
        }
        conv?.id
    }

    suspend fun createGroup(title: String, members: List<String>): String? = withContext(Dispatchers.IO) {
        val res = runCatching { Http.createGroup(title, members) }.getOrNull()
        val conv = parseConversation(res?.optJSONObject("conversation"))
        if (conv != null) {
            db.saveConversations(listOf(conv))
            _conversations.value = db.conversations()
        }
        conv?.id
    }

    /**
     * Encrypts the file (when E2EE is on), uploads it and sends the message.
     * The server only ever receives the encrypted blob.
     */
    suspend fun uploadThenSend(convId: String, file: java.io.File, type: String, durationMs: Long = 0L) =
        withContext(Dispatchers.IO) {
            val bytes = file.readBytes()
            var uploadFile = file
            var uploadName = file.name
            var key: String? = null
            var nonce: String? = null
            if (E2eeEngine.supported) {
                val sealed = E2eeEngine.encryptFile(bytes)
                uploadFile = java.io.File(file.parentFile, "${file.nameWithoutExtension}.enc").apply { writeBytes(sealed.bytes) }
                uploadName = "${file.nameWithoutExtension}.enc"
                key = sealed.key
                nonce = sealed.nonce
            }
            val up = try {
                Http.upload(uploadFile, durationMs, uploadName)
            } finally {
                if (uploadFile !== file) uploadFile.delete()
            }
            val url = up.optString("url")
            if (url.isBlank()) return@withContext
            val meta = (up.optJSONObject("meta") ?: JSONObject()).apply {
                put("name", file.name)
                put("size", bytes.size)
                put("mime", mimeOf(file))
                if (durationMs > 0) put("durationMs", durationMs)
                key?.let { put("k", it) }
                nonce?.let { put("n", it) }
            }
            send(convId, type, "", url, meta.toString())
        }

    private fun mimeOf(file: java.io.File): String =
        android.webkit.MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(file.extension.lowercase())
            ?: "application/octet-stream"

    /* ------------------------------- realtime -------------------------------- */

    private suspend fun onFrame(context: Context, frame: JSONObject) {
        when (frame.optString("t")) {
            "ready" -> {
                val user = parseUser(frame.optJSONObject("user"))
                if (user != null) {
                    Prefs.me = user
                    _me.value = user
                }
                startE2ee(context.applicationContext)
            }
            "message" -> {
                val message = parseMessage(frame.optJSONObject("message")) ?: return
                db.saveMessages(listOf(message))
                decryptInto(listOf(message))
                if (message.conversationId == openConversationId) {
                    _messages.value = db.messages(message.conversationId)
                    if (foreground) scope.launch { runCatching { Http.read(message.conversationId) } }
                }
                _conversations.update { list ->
                    list.map { if (it.id == message.conversationId) it.copy(lastMessage = message, updatedAt = message.createdAt) else it }
                        .sortedByDescending { it.updatedAt }
                }
                if (message.senderId != _me.value?.id) {
                    val conv = _conversations.value.firstOrNull { it.id == message.conversationId }
                    if (!foreground || message.conversationId != openConversationId) {
                        Notify.message(context, conv, message)
                    }
                }
            }
            "message:update" -> {
                val message = parseMessage(frame.optJSONObject("message")) ?: return
                db.saveMessages(listOf(message))
                if (message.conversationId == openConversationId) _messages.value = db.messages(message.conversationId)
            }
            "typing" -> {
                val convId = frame.optString("conversationId")
                val userId = frame.optString("userId")
                if (convId == openConversationId && userId != _me.value?.id) {
                    _typing.update { if (frame.optBoolean("on")) it + userId else it - userId }
                }
            }
            "presence" -> {
                val userId = frame.optString("userId")
                if (userId.isBlank()) return
                _presence.update { it + (userId to frame.optBoolean("online")) }
                _lastSeen.update { it + (userId to frame.optLong("lastSeen")) }
            }
            "presence:state" -> {
                val arr = frame.optJSONArray("states") ?: return
                for (i in 0 until arr.length()) {
                    val s = arr.optJSONObject(i) ?: continue
                    val userId = s.optString("userId")
                    _presence.update { it + (userId to s.optBoolean("online")) }
                    _lastSeen.update { it + (userId to s.optLong("lastSeen")) }
                }
            }
            "receipt" -> {
                val type = frame.optString("type")
                val convId = frame.optString("conversationId")
                if (type == "read") {
                    val mine = db.messages(convId).filter { it.senderId == _me.value?.id }
                    db.markStatus(mine.map { it.id }, "read")
                } else {
                    val ids = mutableListOf<String>()
                    val arr = frame.optJSONArray("messageIds")
                    if (arr != null) for (i in 0 until arr.length()) ids += arr.optString(i)
                    db.markStatus(ids, "delivered")
                }
                if (convId == openConversationId) _messages.value = db.messages(convId)
            }
            "conversation" -> {
                val conv = parseConversation(frame.optJSONObject("conversation")) ?: return
                db.saveConversations(listOf(conv))
                _conversations.value = db.conversations()
            }
            "conversation:settings" -> {
                val convId = frame.optString("conversationId")
                val settings = frame.optJSONObject("settings")
                if (convId.isNotBlank() && settings != null) {
                    db.updateSettings(convId, settings.toString())
                    _conversations.value = db.conversations()
                    if (convId == openConversationId) _messages.value = db.messages(convId)
                }
            }
            "user:key" -> {
                // the peer changed device: remember its new identity key
                val userId = frame.optString("userId")
                val key = frame.optString("publicKey")
                if (userId.isNotBlank() && key.isNotBlank()) E2eeEngine.rememberPeer(userId, key)
            }
            "conversation:keys" -> {
                // a fresh group key was distributed: drop the cached one and
                // pick it up again on the next decrypt
                E2eeEngine.dropGroupKey(frame.optString("conversationId"))
            }
            "event" -> {
                val type = frame.optString("type")
                val name = frame.optString("name").ifBlank { "الطرف الآخر" }
                _notice.value = when (type) {
                    "screenshot" -> "📸 $name التقط لقطة للشاشة"
                    "recording" -> "⏺️ $name بدأ تسجيل الشاشة"
                    "recording_stop" -> "⏹️ $name أوقف تسجيل الشاشة"
                    else -> null
                }
                parseMessage(frame.optJSONObject("message"))?.let { system ->
                    db.saveMessages(listOf(system))
                    if (system.conversationId == openConversationId) {
                        _messages.value = db.messages(system.conversationId)
                    }
                }
            }
            "error" -> {
                if (frame.optString("message") == "unauthorized") {
                    logout()
                }
            }
            else -> { /* call frames are handled by CallManager */ }
        }
    }

    /* -------------------------------- session -------------------------------- */

    fun setMe(user: User) {
        Prefs.me = user
        _me.value = user
    }

    fun logout() {
        if (::appContext.isInitialized) E2eeEngine.logout(appContext)
        _plain.value = emptyMap()
        _e2ee.value = false
        Prefs.clearSession()
        db.clearAll()
        _me.value = null
        _conversations.value = emptyList()
        _messages.value = emptyList()
        _contacts.value = emptyList()
        _calls.value = emptyList()
        SocketClient.stop()
    }
}
