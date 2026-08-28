package io.masingar.chat.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import io.masingar.chat.BuildConfig

/**
 * Tiny typed wrapper around SharedPreferences.
 * The JWT is not a password but we still keep it in private mode only.
 */
object Prefs {
    private const val FILE = "masingar"
    private const val K_TOKEN = "token"
    private const val K_REFRESH = "refresh"
    private const val K_USER = "user"
    private const val K_ME = "me"
    private const val K_SERVER = "server"
    private const val K_COUNTRY = "country"
    private const val K_LANG = "lang"
    private const val K_THEME = "theme"
    private const val K_QUALITY = "quality"
    private const val K_AUTO = "auto_quality"
    private const val K_SAVER = "data_saver"
    private const val K_FALLBACK = "audio_fallback"
    private const val K_STATS = "show_stats"
    private const val K_CONTACTS_SYNCED = "contacts_synced"
    private const val K_LAST_SYNC = "last_sync"
    private const val K_PUSH = "push_token"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    var token: String
        get() = prefs.getString(K_TOKEN, "").orEmpty()
        set(value) = prefs.edit { putString(K_TOKEN, value) }

    var refreshToken: String
        get() = prefs.getString(K_REFRESH, "").orEmpty()
        set(value) = prefs.edit { putString(K_REFRESH, value) }

    var meJson: String
        get() = prefs.getString(K_ME, "").orEmpty()
        set(value) = prefs.edit { putString(K_ME, value) }

    var me: User?
        get() = meJson.takeIf { it.isNotBlank() }?.let { runCatching { parseUser(org.json.JSONObject(it)) }.getOrNull() }
        set(value) = run { meJson = value?.let { org.json.JSONObject().apply {
            put("id", it.id); put("phone", it.phone); put("name", it.name)
            put("avatar", it.avatar); put("about", it.about)
            if (it.publicKey.isNotBlank()) put("publicKey", it.publicKey)
        }.toString() }.orEmpty() }

    var serverUrl: String
        get() = prefs.getString(K_SERVER, "").orEmpty().ifBlank { BuildConfig.SERVER_URL }
        set(value) = prefs.edit { putString(K_SERVER, value) }

    var countryCode: String
        get() = prefs.getString(K_COUNTRY, "").orEmpty().ifBlank { BuildConfig.DEFAULT_COUNTRY_CODE }
        set(value) = prefs.edit { putString(K_COUNTRY, value) }

    var language: String
        get() = prefs.getString(K_LANG, "").orEmpty()
        set(value) = prefs.edit { putString(K_LANG, value) }

    var theme: String
        get() = prefs.getString(K_THEME, "system").orEmpty()
        set(value) = prefs.edit { putString(K_THEME, value) }

    /** saver | auto | hd */
    var quality: String
        get() = prefs.getString(K_QUALITY, "auto").orEmpty()
        set(value) = prefs.edit { putString(K_QUALITY, value) }

    var autoQuality: Boolean
        get() = prefs.getBoolean(K_AUTO, true)
        set(value) = prefs.edit { putBoolean(K_AUTO, value) }

    var dataSaver: Boolean
        get() = prefs.getBoolean(K_SAVER, false)
        set(value) = prefs.edit { putBoolean(K_SAVER, value) }

    var audioOnlyFallback: Boolean
        get() = prefs.getBoolean(K_FALLBACK, true)
        set(value) = prefs.edit { putBoolean(K_FALLBACK, value) }

    var showStats: Boolean
        get() = prefs.getBoolean(K_STATS, false)
        set(value) = prefs.edit { putBoolean(K_STATS, value) }

    var contactsSyncedAt: Long
        get() = prefs.getLong(K_CONTACTS_SYNCED, 0L)
        set(value) = prefs.edit { putLong(K_CONTACTS_SYNCED, value) }

    var lastSync: Long
        get() = prefs.getLong(K_LAST_SYNC, 0L)
        set(value) = prefs.edit { putLong(K_LAST_SYNC, value) }

    var pushToken: String
        get() = prefs.getString(K_PUSH, "").orEmpty()
        set(value) = prefs.edit { putString(K_PUSH, value) }

    val isLoggedIn: Boolean get() = token.isNotBlank() && me != null

    fun clearSession() = prefs.edit {
        remove(K_TOKEN); remove(K_REFRESH); remove(K_ME); remove(K_LAST_SYNC)
    }
}
