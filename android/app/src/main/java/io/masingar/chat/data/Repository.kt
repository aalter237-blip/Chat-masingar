package io.masingar.chat.data

import android.content.Context
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

    var openConversationId: String? = null
    @Volatile var foreground: Boolean = false

    @Volatile private var initialized = false

    fun init(context: Context) {
        db = LocalDb(context.applicationContext)
        if (initialized) return
        initialized = true
        loadLocal()
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

    /* ------------------------------- sending -------------------------------- */

    /** Queues locally, then tries to deliver. Works with no network at all. */
    fun send(convId: String, type: String, body: String, mediaUrl: String = "", mediaMeta: String = "") {
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
        )
        db.saveMessages(listOf(pending))
        db.enqueue(pending)
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
                val res = Http.send(m.conversationId, m.type, m.body, m.mediaUrl, meta, m.clientId)
                val saved = parseMessage(res.optJSONObject("message"))
                if (saved != null) {
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

    suspend fun uploadThenSend(convId: String, file: java.io.File, type: String, durationMs: Long = 0L) =
        withContext(Dispatchers.IO) {
            val up = Http.upload(file, durationMs)
            val url = up.optString("url")
            val meta = up.optJSONObject("meta")?.toString().orEmpty()
            if (url.isNotBlank()) send(convId, type, "", url, meta)
        }

    /* ------------------------------- realtime -------------------------------- */

    private suspend fun onFrame(context: Context, frame: JSONObject) {
        when (frame.optString("t")) {
            "ready" -> {
                val user = parseUser(frame.optJSONObject("user"))
                if (user != null) {
                    Prefs.me = user
                    _me.value = user
                }
            }
            "message" -> {
                val message = parseMessage(frame.optJSONObject("message")) ?: return
                db.saveMessages(listOf(message))
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
