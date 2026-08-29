package io.masingar.chat.net

import android.webkit.MimeTypeMap
import io.masingar.chat.data.Prefs
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/** Thrown for any non 2xx answer; `code` mirrors the JSON error code. */
class ApiException(message: String, val code: String = "", val status: Int = 0) : IOException(message)

/**
 * Minimal REST client (OkHttp + org.json, no reflection, no code generation).
 * Every call is synchronous: wrap it in Dispatchers.IO.
 */
object Http {
    private val json = "application/json; charset=utf-8".toMediaType()

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun base(): String = Prefs.serverUrl.trim().trimEnd('/')

    /** Absolute URL of a media path returned by the server. */
    fun media(relativeOrAbsolute: String): String =
        if (relativeOrAbsolute.startsWith("http")) relativeOrAbsolute else base() + relativeOrAbsolute

    private fun call(
        method: String,
        path: String,
        body: JSONObject? = null,
        form: MultipartBody? = null,
        auth: Boolean = true,
    ): JSONObject {
        val reqBody = when {
            form != null -> form
            body != null -> body.toString().toRequestBody(json)
            method == "POST" || method == "PUT" -> "{}".toRequestBody(json)
            else -> null
        }
        val builder = Request.Builder().url(base() + path).method(method, reqBody)
        if (auth) {
            val token = Prefs.token
            if (token.isNotBlank()) builder.header("Authorization", "Bearer $token")
        }
        // The hosted server (Bonto) sleeps when idle and answers the first
        // request with an HTML "waking up" page (HTTP 200, no JSON). Wait a
        // few seconds and retry until a real JSON answer comes back - without
        // this the user would see "couldn't send the code" on a cold server.
        var attempt = 0
        while (true) {
            attempt++
            client.newCall(builder.build()).execute().use { res ->
                val text = res.body?.string().orEmpty()
                val parsed = runCatching { JSONObject(text) }.getOrNull()
                if (parsed != null) {
                    if (!res.isSuccessful) {
                        throw ApiException(
                            parsed.optString("message").ifBlank { "HTTP ${res.code}" },
                            parsed.optString("code"),
                            res.code,
                        )
                    }
                    return parsed
                }
                if (attempt < 3) {
                    Thread.sleep(4000L * attempt)
                    continue
                }
                throw ApiException("تعذّر فهم استجابة الخادم — أعد المحاولة")
            }
        }
    }

    private fun get(path: String) = call("GET", path)
    private fun post(path: String, body: JSONObject? = null) = call("POST", path, body)
    private fun put(path: String, body: JSONObject? = null) = call("PUT", path, body)
    private fun del(path: String, body: JSONObject? = null) = call("DELETE", path, body)

    /* --------------------------------- auth -------------------------------- */

    fun requestOtp(phone: String): JSONObject = post("/api/auth/otp/request", JSONObject().apply { put("phone", phone) })

    fun verifyOtp(phone: String, code: String, name: String = "", locale: String = ""): JSONObject =
        post("/api/auth/otp/verify", JSONObject().apply {
            put("phone", phone)
            put("code", code)
            if (name.isNotBlank()) put("name", name)
            if (locale.isNotBlank()) put("locale", locale)
            put("device", android.os.Build.MODEL)
        })

    fun refresh(refreshToken: String): JSONObject = post("/api/auth/refresh", JSONObject().apply { put("refreshToken", refreshToken) })

    fun logout(): JSONObject = post("/api/auth/logout", JSONObject().apply { put("refreshToken", Prefs.refreshToken) })

    fun me(): JSONObject = get("/api/me")

    fun updateMe(
        name: String? = null,
        about: String? = null,
        avatar: String? = null,
        publicKey: String? = null,
    ): JSONObject =
        patch(JSONObject().apply {
            name?.let { put("name", it) }
            about?.let { put("about", it) }
            avatar?.let { put("avatar", it) }
            publicKey?.let { put("public_key", it) }
        })

    private fun patch(body: JSONObject): JSONObject = call("PATCH", "/api/me", body)

    fun pushToken(token: String): JSONObject = post("/api/me/push-token", JSONObject().apply {
        put("token", token)
        put("platform", "android")
    })

    fun ice(): JSONObject = get("/api/ice")

    /* ------------------------------- contacts ------------------------------- */

    fun syncContacts(hashes: List<Pair<String, String>>): JSONObject {
        val arr = JSONArray()
        for ((hash, name) in hashes) arr.put(JSONObject().apply { put("hash", hash); put("name", name) })
        return post("/api/contacts/sync", JSONObject().apply { put("contacts", arr) })
    }

    fun contacts(): JSONObject = get("/api/contacts")

    /* ----------------------------- conversations ---------------------------- */

    fun conversations(): JSONObject = get("/api/conversations")

    fun createDirect(userId: String): JSONObject = post("/api/conversations", JSONObject().apply { put("userId", userId) })

    fun createDirectByPhone(phone: String): JSONObject = post("/api/conversations", JSONObject().apply { put("phone", phone) })

    fun createGroup(title: String, memberIds: List<String>): JSONObject =
        post("/api/conversations", JSONObject().apply {
            put("type", "group")
            put("title", title)
            put("memberIds", JSONArray().apply { memberIds.forEach { put(it) } })
        })

    fun messages(convId: String, limit: Int = 100, after: Long = 0L): JSONObject {
        val q = StringBuilder("?limit=$limit")
        if (after > 0) q.append("&after=$after")
        return get("/api/conversations/$convId/messages$q")
    }

    fun send(
        convId: String,
        type: String,
        body: String,
        mediaUrl: String = "",
        mediaMeta: JSONObject? = null,
        clientId: String = "",
        encrypted: Boolean = false,
    ): JSONObject = post("/api/conversations/$convId/messages", JSONObject().apply {
        put("type", type)
        put("body", body)
        if (mediaUrl.isNotBlank()) put("mediaUrl", mediaUrl)
        mediaMeta?.let { put("mediaMeta", it) }
        if (clientId.isNotBlank()) put("clientId", clientId)
        put("encrypted", encrypted)
    })

    /* ------------------------- shared look of a chat ------------------------- */

    /** Sets (or clears with null) the wallpaper for everybody in the chat. */
    fun setWallpaper(convId: String, id: String, css: String): JSONObject =
        post("/api/conversations/$convId/settings", JSONObject().apply {
            put("settings", JSONObject().apply {
                if (id == "none") put("wallpaper", JSONObject.NULL)
                else put("wallpaper", JSONObject().apply { put("id", id); put("css", css) })
            })
        })

    /* ---------------------------- group keys (E2EE) -------------------------- */

    fun groupKeys(convId: String): JSONObject = get("/api/conversations/$convId/keys")

    fun setGroupKeys(convId: String, keys: JSONArray): JSONObject =
        post("/api/conversations/$convId/keys", JSONObject().apply { put("keys", keys) })

    fun read(convId: String): JSONObject = post("/api/conversations/$convId/read")

    fun editMessage(id: String, body: String): JSONObject = put("/api/messages/$id", JSONObject().apply { put("body", body) })

    fun deleteMessage(id: String): JSONObject = del("/api/messages/$id")

    /* -------------------------------- uploads ------------------------------- */

    fun upload(file: File, durationMs: Long = 0L, uploadName: String = file.name): JSONObject {
        val mime = MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(file.extension.lowercase())
            ?: "application/octet-stream"
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", uploadName, file.asRequestBody(mime.toMediaType()))
            .apply { if (durationMs > 0) addFormDataPart("durationMs", durationMs.toString()) }
            .build()
        return call("POST", "/api/uploads", form = form)
    }

    /* --------------------------------- calls -------------------------------- */

    fun calls(): JSONObject = get("/api/calls")

    fun createCall(calleeId: String, type: String): JSONObject =
        post("/api/calls", JSONObject().apply { put("calleeId", calleeId); put("type", type) })

    fun userByPhone(phone: String): JSONObject = get("/api/users/by-phone/$phone")

    fun search(q: String): JSONObject = get("/api/search?q=${java.net.URLEncoder.encode(q, "UTF-8")}")

    /** One shot delta sync, used after the device was offline. */
    fun sync(since: Long): JSONObject = get("/api/sync?since=$since")
}
