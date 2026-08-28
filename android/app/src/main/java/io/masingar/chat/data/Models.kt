package io.masingar.chat.data

import org.json.JSONObject

/* --------------------------------- models -------------------------------- */

data class User(
    val id: String,
    val phone: String = "",
    val name: String = "",
    val avatar: String = "",
    val about: String = "",
    val online: Boolean = false,
    val lastSeen: Long = 0L,
)

data class Conversation(
    val id: String,
    val type: String = "direct",
    val title: String = "",
    val avatar: String = "",
    val members: List<User> = emptyList(),
    val peer: User? = null,
    val unread: Int = 0,
    val muted: Boolean = false,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
    val lastMessage: Message? = null,
)

data class Message(
    val id: String,
    val conversationId: String = "",
    val senderId: String = "",
    val type: String = "text",
    val body: String = "",
    val mediaUrl: String = "",
    val mediaMeta: String = "",
    val replyTo: String? = null,
    val clientId: String = "",
    val status: String = "sent",
    val createdAt: Long = 0L,
    val deleted: Boolean = false,
)

data class CallItem(
    val id: String,
    val conversationId: String? = null,
    val callerId: String = "",
    val calleeId: String = "",
    val type: String = "audio",
    val state: String = "ended",
    val startedAt: Long = 0L,
    val endedAt: Long = 0L,
    val durationMs: Long = 0L,
)

data class ContactItem(
    val name: String,
    val phoneHash: String,
    val user: User? = null,
)

data class IceServer(
    val urls: List<String>,
    val username: String? = null,
    val credential: String? = null,
)

/* --------------------------------- parsing -------------------------------- */

private fun JSONObject.s(key: String, default: String = ""): String =
    if (isNull(key)) default else optString(key, default)

private fun JSONObject.l(key: String, default: Long = 0L): Long =
    if (isNull(key)) default else optLong(key, default)

fun parseUser(o: JSONObject?): User? {
    o ?: return null
    val id = o.s("id")
    if (id.isBlank()) return null
    return User(
        id = id,
        phone = o.s("phone"),
        name = o.s("name"),
        avatar = o.s("avatar"),
        about = o.s("about"),
        online = o.optBoolean("online", false),
        lastSeen = o.l("lastSeen"),
    )
}

fun parseMessage(o: JSONObject?): Message? {
    o ?: return null
    val id = o.s("id")
    if (id.isBlank()) return null
    val media = o.optJSONObject("media")
    return Message(
        id = id,
        conversationId = o.s("conversationId"),
        senderId = o.s("senderId"),
        type = o.s("type", "text"),
        body = o.s("body"),
        mediaUrl = o.s("mediaUrl"),
        mediaMeta = media?.toString().orEmpty(),
        replyTo = o.s("replyTo").ifBlank { null },
        clientId = o.s("clientId"),
        status = o.s("status", "sent"),
        createdAt = o.l("createdAt"),
        deleted = o.optBoolean("deleted", false),
    )
}

fun parseConversation(o: JSONObject?): Conversation? {
    o ?: return null
    val id = o.s("id")
    if (id.isBlank()) return null
    val members = mutableListOf<User>()
    val arr = o.optJSONArray("members")
    if (arr != null) for (i in 0 until arr.length()) parseUser(arr.optJSONObject(i))?.let { members += it }
    return Conversation(
        id = id,
        type = o.s("type", "direct"),
        title = o.s("title"),
        avatar = o.s("avatar"),
        members = members,
        peer = parseUser(o.optJSONObject("peer")),
        unread = o.optInt("unread", 0),
        muted = o.optBoolean("muted", false),
        createdAt = o.l("createdAt"),
        updatedAt = o.l("updatedAt"),
        lastMessage = parseMessage(o.optJSONObject("lastMessage")),
    )
}

fun parseCall(o: JSONObject?): CallItem? {
    o ?: return null
    val id = o.s("id")
    if (id.isBlank()) return null
    return CallItem(
        id = id,
        conversationId = o.s("conversationId").ifBlank { null },
        callerId = o.s("callerId"),
        calleeId = o.s("calleeId"),
        type = o.s("type", "audio"),
        state = o.s("state", "ended"),
        startedAt = o.l("startedAt"),
        endedAt = o.l("endedAt"),
        durationMs = o.l("durationMs"),
    )
}

fun parseIce(o: JSONObject?): IceServer? {
    o ?: return null
    val urls = mutableListOf<String>()
    val raw = o.opt("urls")
    if (raw is String) urls += raw
    else {
        val arr = o.optJSONArray("urls")
        if (arr != null) for (i in 0 until arr.length()) urls += arr.optString(i)
    }
    if (urls.isEmpty()) return null
    return IceServer(urls, o.s("username").ifBlank { null }, o.s("credential").ifBlank { null })
}
