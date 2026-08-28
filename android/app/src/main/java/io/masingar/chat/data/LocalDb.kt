package io.masingar.chat.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Local cache so the app is fully usable offline:
 * everything shown in the UI is read from here and refreshed from the network.
 */
class LocalDb(context: Context) : SQLiteOpenHelper(context, "masingar.db", null, 3) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS conversations(
                id TEXT PRIMARY KEY, type TEXT, title TEXT, avatar TEXT,
                members TEXT, peer TEXT, unread INTEGER, muted INTEGER,
                created_at INTEGER, updated_at INTEGER, last_message TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS messages(
                id TEXT PRIMARY KEY, conversation_id TEXT, sender_id TEXT, type TEXT,
                body TEXT, media_url TEXT, media_meta TEXT, status TEXT,
                client_id TEXT, created_at INTEGER, deleted INTEGER)"""
        )
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS contacts(
                phone_hash TEXT PRIMARY KEY, name TEXT, user TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS calls(
                id TEXT PRIMARY KEY, conversation_id TEXT, caller_id TEXT, callee_id TEXT,
                type TEXT, state TEXT, started_at INTEGER, ended_at INTEGER, duration_ms INTEGER)"""
        )
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS outbox(
                client_id TEXT PRIMARY KEY, conversation_id TEXT, type TEXT, body TEXT,
                media_url TEXT, media_meta TEXT, reply_to TEXT, created_at INTEGER, attempts INTEGER)"""
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_calls_time ON calls(started_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        db.execSQL("DROP TABLE IF EXISTS conversations")
        db.execSQL("DROP TABLE IF EXISTS messages")
        db.execSQL("DROP TABLE IF EXISTS contacts")
        db.execSQL("DROP TABLE IF EXISTS calls")
        db.execSQL("DROP TABLE IF EXISTS outbox")
        onCreate(db)
    }

    /* ----------------------------- conversations ---------------------------- */

    fun saveConversations(list: List<Conversation>) {
        writableDatabase.beginTransaction()
        try {
            for (c in list) {
                val v = ContentValues().apply {
                    put("id", c.id)
                    put("type", c.type)
                    put("title", c.title)
                    put("avatar", c.avatar)
                    put("members", org.json.JSONArray().apply { c.members.forEach { put(it.toJson()) } }.toString())
                    put("peer", c.peer?.toJson().orEmpty())
                    put("unread", c.unread)
                    put("muted", if (c.muted) 1 else 0)
                    put("created_at", c.createdAt)
                    put("updated_at", c.updatedAt)
                    put("last_message", c.lastMessage?.toJson().orEmpty())
                }
                writableDatabase.insertWithOnConflict("conversations", null, v, SQLiteDatabase.CONFLICT_REPLACE)
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun conversations(): List<Conversation> {
        val out = mutableListOf<Conversation>()
        readableDatabase.query("conversations", null, null, null, null, null, "updated_at DESC").use { cur ->
            while (cur.moveToNext()) {
                val members = mutableListOf<User>()
                val arr = org.json.JSONArray(cur.getString(cur.getColumnIndexOrThrow("members")).ifBlank { "[]" })
                for (i in 0 until arr.length()) parseUser(arr.optJSONObject(i))?.let { members += it }
                out += Conversation(
                    id = cur.getString(cur.getColumnIndexOrThrow("id")),
                    type = cur.getString(cur.getColumnIndexOrThrow("type")) ?: "direct",
                    title = cur.getString(cur.getColumnIndexOrThrow("title")) ?: "",
                    avatar = cur.getString(cur.getColumnIndexOrThrow("avatar")) ?: "",
                    members = members,
                    peer = cur.getString(cur.getColumnIndexOrThrow("peer")).takeIf { !it.isNullOrBlank() }
                        ?.let { runCatching { parseUser(org.json.JSONObject(it)) }.getOrNull() },
                    unread = cur.getInt(cur.getColumnIndexOrThrow("unread")),
                    muted = cur.getInt(cur.getColumnIndexOrThrow("muted")) == 1,
                    createdAt = cur.getLong(cur.getColumnIndexOrThrow("created_at")),
                    updatedAt = cur.getLong(cur.getColumnIndexOrThrow("updated_at")),
                    lastMessage = cur.getString(cur.getColumnIndexOrThrow("last_message")).takeIf { !it.isNullOrBlank() }
                        ?.let { runCatching { parseMessage(org.json.JSONObject(it)) }.getOrNull() },
                )
            }
        }
        return out
    }

    /* -------------------------------- messages ------------------------------ */

    fun saveMessages(list: List<Message>) {
        writableDatabase.beginTransaction()
        try {
            for (m in list) {
                writableDatabase.insertWithOnConflict("messages", null, m.toValues(), SQLiteDatabase.CONFLICT_REPLACE)
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun messages(convId: String, limit: Int = 200): List<Message> {
        val out = mutableListOf<Message>()
        readableDatabase.query(
            "messages", null, "conversation_id = ?", arrayOf(convId),
            null, null, "created_at DESC", limit.toString()
        ).use { cur ->
            while (cur.moveToNext()) out += cur.toMessage()
        }
        return out.asReversed()
    }

    fun message(id: String): Message? {
        readableDatabase.query("messages", null, "id = ?", arrayOf(id), null, null, null, "1").use { cur ->
            return if (cur.moveToFirst()) cur.toMessage() else null
        }
    }

    fun deleteMessage(id: String) {
        val v = ContentValues().apply {
            put("body", ""); put("media_url", ""); put("deleted", 1)
        }
        writableDatabase.update("messages", v, "id = ?", arrayOf(id))
    }

    fun markStatus(ids: List<String>, status: String) {
        if (ids.isEmpty()) return
        writableDatabase.beginTransaction()
        try {
            val v = ContentValues().apply { put("status", status) }
            for (id in ids) writableDatabase.update("messages", v, "id = ?", arrayOf(id))
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun markConversationRead(convId: String) {
        val v = ContentValues().apply { put("unread", 0) }
        writableDatabase.update("conversations", v, "id = ?", arrayOf(convId))
    }

    /* -------------------------------- contacts ------------------------------ */

    fun saveContacts(list: List<ContactItem>) {
        writableDatabase.beginTransaction()
        try {
            for (c in list) {
                val v = ContentValues().apply {
                    put("phone_hash", c.phoneHash)
                    put("name", c.name)
                    put("user", c.user?.toJson().orEmpty())
                }
                writableDatabase.insertWithOnConflict("contacts", null, v, SQLiteDatabase.CONFLICT_REPLACE)
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun contacts(): List<ContactItem> {
        val out = mutableListOf<ContactItem>()
        readableDatabase.query("contacts", null, null, null, null, null, "name COLLATE NOCASE ASC").use { cur ->
            while (cur.moveToNext()) {
                val userJson = cur.getString(cur.getColumnIndexOrThrow("user"))
                out += ContactItem(
                    name = cur.getString(cur.getColumnIndexOrThrow("name")) ?: "",
                    phoneHash = cur.getString(cur.getColumnIndexOrThrow("phone_hash")),
                    user = userJson.takeIf { it.isNotBlank() }?.let { runCatching { parseUser(org.json.JSONObject(it)) }.getOrNull() },
                )
            }
        }
        return out
    }

    /* ---------------------------------- calls ------------------------------- */

    fun saveCalls(list: List<CallItem>) {
        writableDatabase.beginTransaction()
        try {
            for (c in list) {
                val v = ContentValues().apply {
                    put("id", c.id)
                    put("conversation_id", c.conversationId)
                    put("caller_id", c.callerId)
                    put("callee_id", c.calleeId)
                    put("type", c.type)
                    put("state", c.state)
                    put("started_at", c.startedAt)
                    put("ended_at", c.endedAt)
                    put("duration_ms", c.durationMs)
                }
                writableDatabase.insertWithOnConflict("calls", null, v, SQLiteDatabase.CONFLICT_REPLACE)
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun calls(limit: Int = 100): List<CallItem> {
        val out = mutableListOf<CallItem>()
        readableDatabase.query("calls", null, null, null, null, null, "started_at DESC", limit.toString()).use { cur ->
            while (cur.moveToNext()) {
                out += CallItem(
                    id = cur.getString(cur.getColumnIndexOrThrow("id")),
                    conversationId = cur.getString(cur.getColumnIndexOrThrow("conversation_id")),
                    callerId = cur.getString(cur.getColumnIndexOrThrow("caller_id")) ?: "",
                    calleeId = cur.getString(cur.getColumnIndexOrThrow("callee_id")) ?: "",
                    type = cur.getString(cur.getColumnIndexOrThrow("type")) ?: "audio",
                    state = cur.getString(cur.getColumnIndexOrThrow("state")) ?: "ended",
                    startedAt = cur.getLong(cur.getColumnIndexOrThrow("started_at")),
                    endedAt = cur.getLong(cur.getColumnIndexOrThrow("ended_at")),
                    durationMs = cur.getLong(cur.getColumnIndexOrThrow("duration_ms")),
                )
            }
        }
        return out
    }

    /* --------------------------------- outbox ------------------------------- */
    /* Messages are queued here first and removed only after the server ACKs.  */

    fun enqueue(m: Message) {
        val v = ContentValues().apply {
            put("client_id", m.clientId)
            put("conversation_id", m.conversationId)
            put("type", m.type)
            put("body", m.body)
            put("media_url", m.mediaUrl)
            put("media_meta", m.mediaMeta)
            put("reply_to", m.replyTo)
            put("created_at", m.createdAt)
            put("attempts", 0)
        }
        writableDatabase.insertWithOnConflict("outbox", null, v, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun pending(): List<Message> {
        val out = mutableListOf<Message>()
        readableDatabase.query("outbox", null, null, null, null, null, "created_at ASC", "50").use { cur ->
            while (cur.moveToNext()) {
                val idx = { name: String -> cur.getColumnIndexOrThrow(name) }
                out += Message(
                    id = "",
                    conversationId = cur.getString(idx("conversation_id")) ?: "",
                    senderId = "",
                    type = cur.getString(idx("type")) ?: "text",
                    body = cur.getString(idx("body")) ?: "",
                    mediaUrl = cur.getString(idx("media_url")) ?: "",
                    mediaMeta = cur.getString(idx("media_meta")) ?: "",
                    replyTo = cur.getString(idx("reply_to")),
                    clientId = cur.getString(idx("client_id")) ?: "",
                    status = "sending",
                    createdAt = cur.getLong(idx("created_at")),
                )
            }
        }
        return out
    }

    fun bumpAttempts(clientId: String) {
        writableDatabase.execSQL("UPDATE outbox SET attempts = attempts + 1 WHERE client_id = ?", arrayOf(clientId))
    }

    fun removeFromOutbox(clientId: String) {
        writableDatabase.delete("outbox", "client_id = ?", arrayOf(clientId))
    }

    fun clearAll() {
        writableDatabase.beginTransaction()
        try {
            writableDatabase.delete("conversations", null, null)
            writableDatabase.delete("messages", null, null)
            writableDatabase.delete("contacts", null, null)
            writableDatabase.delete("calls", null, null)
            writableDatabase.delete("outbox", null, null)
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    /* --------------------------------- helpers ------------------------------- */

    private fun Message.toValues() = ContentValues().apply {
        put("id", id)
        put("conversation_id", conversationId)
        put("sender_id", senderId)
        put("type", type)
        put("body", body)
        put("media_url", mediaUrl)
        put("media_meta", mediaMeta)
        put("status", status)
        put("client_id", clientId)
        put("created_at", createdAt)
        put("deleted", if (deleted) 1 else 0)
    }

    private fun android.database.Cursor.toMessage(): Message {
        val idx = { name: String -> getColumnIndexOrThrow(name) }
        return Message(
            id = getString(idx("id")),
            conversationId = getString(idx("conversation_id")) ?: "",
            senderId = getString(idx("sender_id")) ?: "",
            type = getString(idx("type")) ?: "text",
            body = getString(idx("body")) ?: "",
            mediaUrl = getString(idx("media_url")) ?: "",
            mediaMeta = getString(idx("media_meta")) ?: "",
            status = getString(idx("status")) ?: "sent",
            clientId = getString(idx("client_id")) ?: "",
            createdAt = getLong(idx("created_at")),
            deleted = getInt(idx("deleted")) == 1,
        )
    }

    private fun User.toJson() = org.json.JSONObject().apply {
        put("id", id); put("phone", phone); put("name", name)
        put("avatar", avatar); put("about", about); put("online", online); put("lastSeen", lastSeen)
    }

    private fun Message.toJson() = org.json.JSONObject().apply {
        put("id", id); put("conversationId", conversationId); put("senderId", senderId)
        put("type", type); put("body", body); put("mediaUrl", mediaUrl)
        put("status", status); put("createdAt", createdAt); put("deleted", deleted)
        if (mediaMeta.isNotBlank()) put("media", org.json.JSONObject(mediaMeta))
    }
}
