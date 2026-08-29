package io.masingar.chat.push

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.masingar.chat.data.Prefs
import io.masingar.chat.net.Http
import io.masingar.chat.net.SocketClient
import io.masingar.chat.util.Notify
import io.masingar.chat.work.SyncWorker

/**
 * Wakes the device when a push arrives:
 *  • message -> open the socket so the realtime frames flow in
 *  • call    -> open the socket (the invite is delivered over it) + ring
 */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Prefs.pushToken = token
        Thread { runCatching { Http.pushToken(token) } }.start()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        SocketClient.start()
        SocketClient.startHeartbeat()

        when (data["type"]) {
            "call" -> {
                Notify.wakeup(
                    this,
                    getString(io.masingar.chat.R.string.app_name),
                    if (data["callType"] == "video") getString(io.masingar.chat.R.string.incoming_video_call)
                    else getString(io.masingar.chat.R.string.incoming_voice_call),
                    io.masingar.chat.calls.CallActivity::class.java,
                )
                // give the socket a moment to deliver the invite, then refresh
                android.os.Handler(mainLooper).postDelayed({ SyncWorker.schedule(this) }, 1500)
            }
            else -> SyncWorker.schedule(this)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    companion object {
        fun openCall(intent: Intent?) = intent
    }
}
