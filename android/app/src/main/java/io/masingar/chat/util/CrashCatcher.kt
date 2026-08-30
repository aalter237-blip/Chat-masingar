package io.masingar.chat.util

import android.content.Context
import android.os.Build
import io.masingar.chat.BuildConfig
import io.masingar.chat.data.Prefs
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Global uncaught-exception handler.
 *
 * Writes the crash stack trace (plus device / app / server info) to a file the
 * app shows on the next launch, so a crashing build is diagnosable without a
 * computer or adb. The platform crash dialog behaviour is preserved.
 */
object CrashCatcher {

    const val FILE_NAME = "masingar-crash.log"

    @Volatile
    private var installed = false

    fun install(context: Context) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching { write(app, thread, throwable) }
            // keep the platform behaviour (crash dialog) after logging
            prev?.uncaughtException(thread, throwable)
        }
    }

    private fun file(context: Context): File = File(context.filesDir, FILE_NAME)

    private fun write(context: Context, thread: Thread, t: Throwable) {
        val sw = StringWriter()
        t.printStackTrace(PrintWriter(sw))
        val info = StringBuilder()
            .append("== Masingar crash ==")
            .append("\ntime: ").append(System.currentTimeMillis())
            .append("\nthread: ").append(thread.name)
            .append("\ndevice: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
            .append("\nandroid: ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(')')
            .append("\nversionCode: ").append(BuildConfig.VERSION_CODE)
            .append("\nversionName: ").append(BuildConfig.VERSION_NAME)
            .append("\nserver: ").append(Prefs.serverUrl)
            .append('\n').append(sw.toString())
        file(context).writeText(info.toString())
        android.util.Log.e("MasingarCrash", info.toString())
    }

    /** Returns the last crash trace and deletes the file (one-shot). */
    fun consume(context: Context): String? {
        val f = file(context)
        if (!f.exists()) return null
        val text = runCatching { f.readText() }.getOrNull() ?: return null
        f.delete()
        return text
    }
}
