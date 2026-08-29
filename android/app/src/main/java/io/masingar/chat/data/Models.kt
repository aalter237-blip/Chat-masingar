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
    /** Base64 X25519 public key: the only thing the server needs for E2EE. */
    val publicKey: String = "",
)

data class Conversation(
    val id: String,
    val type: String = "direct",
    val title: String = "",
    val avatar: String = "",
    val members: List<User> = emptyList(),
    val peer: User? = null,
    /** Raw JSON of the shared look of the chat (wallpaper, theme, ...). */
    val settings: String = "",
    val wallpaper: Wallpaper? = null,
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
    /** body holds an E2EE envelope when this is true. */
    val encrypted: Boolean = false,
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

/**
 * Background of a chat. It is stored on the server and pushed to every
 * member, so both people always see the same wallpaper.
 * `css` keeps the exact look of the web client; Android parses the colours
 * out of it (or the `id` when it is one of the presets below).
 */
data class Wallpaper(
    val id: String = "none",
    val css: String = "",
)

/** The presets are shared with the web client (web/js/app.js). */
val WALLPAPERS: List<Wallpaper> = listOf(
    Wallpaper("none", ""),
    Wallpaper("teal", "linear-gradient(160deg,#005c4b,#0b141a)"),
    Wallpaper("night", "linear-gradient(160deg,#1b2a4a,#0b141a)"),
    Wallpaper("sunset", "linear-gradient(160deg,#7b2d5e,#f9a825)"),
    Wallpaper("sand", "linear-gradient(160deg,#e6c9a8,#8d6e63)"),
    Wallpaper("ocean", "linear-gradient(160deg,#0f7a63,#053f8c)"),
    Wallpaper(
        "dots",
        "radial-gradient(circle at 20% 20%,#00a88433 2px,transparent 3px)," +
            "radial-gradient(circle at 70% 60%,#25d36622 2px,transparent 3px)," +
            "linear-gradient(160deg,#111b21,#0b141a)",
    ),
)

fun Conversation.wallpaperOrNull(): Wallpaper? {
    if (wallpaper != null) return wallpaper.takeIf { it.id != "none" }
    if (settings.isBlank()) return null
    return runCatching {
        val o = JSONObject(settings).optJSONObject("wallpaper") ?: return null
        val id = o.optString("id", "none")
        WALLPAPERS.firstOrNull { it.id == id } ?: Wallpaper(id, o.optString("css"))
    }.getOrNull()?.takeIf { it.id != "none" }
}

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
        publicKey = o.s("publicKey"),
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
        encrypted = o.optBoolean("encrypted", false),
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
        settings = o.optJSONObject("settings")?.toString().orEmpty(),
        wallpaper = o.optJSONObject("settings")?.optJSONObject("wallpaper")?.let { w ->
            val id = w.optString("id", "none")
            WALLPAPERS.firstOrNull { it.id == id } ?: Wallpaper(id, w.optString("css"))
        },
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
