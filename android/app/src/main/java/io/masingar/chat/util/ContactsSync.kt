package io.masingar.chat.util

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import io.masingar.chat.data.ContactItem
import io.masingar.chat.data.Prefs
import io.masingar.chat.data.parseUser
import io.masingar.chat.net.Http
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray

/**
 * Reads the address book, converts every number to E.164 and uploads only
 * SHA-256 hashes: the server never learns the raw numbers of your contacts.
 */
object ContactsSync {

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED

    /** number (normalised) -> display name */
    fun readPhoneNumbers(context: Context): Map<String, String> {
        if (!hasPermission(context)) return emptyMap()
        val region = Phone.deviceRegion(context)
        val result = linkedMapOf<String, String>()
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
        )
        runCatching {
            context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection, null, null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC",
            )?.use { cur ->
                val nameIdx = cur.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numIdx = cur.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                while (cur.moveToNext()) {
                    val name = cur.getString(nameIdx)?.trim().orEmpty()
                    val number = cur.getString(numIdx) ?: continue
                    val e164 = Phone.normalize(number, region)
                    if (e164.length < 8) continue
                    if (!result.containsKey(e164)) result[e164] = name
                }
            }
        }
        return result
    }

    /**
     * Uploads the hashes and returns the contacts that already use Masingar.
     * Results are cached locally so the UI works offline too.
     */
    suspend fun sync(context: Context, force: Boolean = false): List<ContactItem> = withContext(Dispatchers.IO) {
        if (!hasPermission(context)) return@withContext emptyList()

        val numbers = readPhoneNumbers(context)
        val pairs = numbers.map { (e164, name) -> Phone.hash(e164) to name }
        if (pairs.isEmpty()) return@withContext emptyList()

        val res = runCatching {
            Http.syncContacts(pairs)
        }.getOrNull()

        val users = mutableMapOf<String, ContactItem>()
        if (res != null) {
            val arr: JSONArray = res.optJSONArray("users") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val user = parseUser(arr.optJSONObject(i)) ?: continue
                users[user.id] = ContactItem(user.name.ifBlank { Phone.pretty(user.phone) }, "", user)
            }
            Prefs.contactsSyncedAt = System.currentTimeMillis()
        }

        // merge with what we already know locally (phoneHash -> name)
        val byHash = pairs.associate { it.first to it.second }
        val contacts = byHash.map { (hash, name) ->
            val user = users.values.firstOrNull { it.user?.let { u -> Phone.hash(u.phone) } == hash }
            ContactItem(name, hash, user?.user)
        }.sortedWith(compareBy({ it.user == null }, { it.name.lowercase() }))

        contacts
    }
}
