package io.masingar.chat.util

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.core.content.ContextCompat

/**
 * Tells the chat when this device captured the screen, so the other person
 * knows a screenshot was taken (or the screen is being recorded).
 *
 * • Android 14+ : the platform hands us `ScreenCaptureCallback`, no permission.
 * • Older       : we watch the media store for a fresh file in the
 *                 Screenshots / screen recording folders. That needs the media
 *                 permission, so it stays off until the user granted it.
 *
 * Nothing is uploaded; only a small notice is sent through the websocket.
 */
class ScreenCaptureWatcher(private val onCapture: (type: String) -> Unit) {

    private var activity: Activity? = null
    private var callback: Any? = null
    private var observer: ContentObserver? = null
    private var resolver: ContentResolver? = null
    private var lastFire = 0L

    @SuppressLint("NewApi")
    fun attach(target: Activity) {
        detach()
        activity = target
        if (Build.VERSION.SDK_INT >= 34) {
            val cb = Activity.ScreenCaptureCallback { fire("screenshot") }
            runCatching {
                target.registerScreenCaptureCallback(target.mainExecutor, cb)
                callback = cb
            }
        }
        if (Build.VERSION.SDK_INT < 34 && hasMediaPermission(target)) {
            val handler = Handler(Looper.getMainLooper())
            val obs = object : ContentObserver(handler) {
                override fun onChange(selfChange: Boolean) {
                    val context = activity ?: return
                    if (looksLikeCapture(context)) fire("screenshot")
                }
            }
            runCatching {
                target.contentResolver.registerContentObserver(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, obs,
                )
                observer = obs
                resolver = target.contentResolver
            }
        }
    }

    @SuppressLint("NewApi")
    fun detach() {
        val target = activity
        if (target != null) {
            if (Build.VERSION.SDK_INT >= 34) {
                (callback as? Activity.ScreenCaptureCallback)?.let {
                    runCatching { target.unregisterScreenCaptureCallback(it) }
                }
            }
            observer?.let { runCatching { resolver?.unregisterContentObserver(it) } }
        }
        callback = null
        observer = null
        resolver = null
        activity = null
    }

    private fun fire(type: String) {
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastFire < 4000) return
        lastFire = now
        onCapture(type)
    }

    /** True when a screenshot/recording file appeared in the last few seconds. */
    private fun looksLikeCapture(context: Context): Boolean {
        if (!hasMediaPermission(context)) return false
        val since = (System.currentTimeMillis() - 8000) / 1000
        val projection = if (Build.VERSION.SDK_INT >= 29) {
            arrayOf(
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.RELATIVE_PATH,
            )
        } else {
            arrayOf(
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.DATA,
            )
        }
        val selection = "${MediaStore.Images.Media.DATE_ADDED} >= ?"
        return runCatching {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                arrayOf(since.toString()),
                "${MediaStore.Images.Media.DATE_ADDED} DESC",
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val name = cursor.getString(0).orEmpty().lowercase()
                    val path = cursor.getString(1).orEmpty().lowercase()
                    if (name.contains("screenshot") || path.contains("screenshot") ||
                        name.contains("screenrec") || path.contains("screenrec") ||
                        name.contains("screen_record") || path.contains("screen_record")
                    ) return@use true
                }
                false
            } ?: false
        }.getOrDefault(false)
    }

    private fun hasMediaPermission(context: Context): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 33) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
}
