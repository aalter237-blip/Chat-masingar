package io.masingar.chat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.masingar.chat.data.Prefs
import io.masingar.chat.net.SocketClient
import io.masingar.chat.work.SyncWorker

/** Restores the background sync after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED, -> {
                Prefs.init(context)
                SyncWorker.schedule(context)
                if (Prefs.isLoggedIn) {
                    SocketClient.start()
                    SocketClient.startHeartbeat()
                }
            }
        }
    }
}
