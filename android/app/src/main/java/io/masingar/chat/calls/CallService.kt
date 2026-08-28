package io.masingar.chat.calls

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import io.masingar.chat.R
import io.masingar.chat.data.User
import io.masingar.chat.util.Notify
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.json.JSONObject

/**
 * Keeps a call alive when the screen is off:
 * foreground service + partial wake lock + proximity sensor + audio routing
 * (earpiece / speaker / Bluetooth headset).
 */
class CallService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var audioManager: AudioManager
    private var wakeLock: PowerManager.WakeLock? = null
    private var proximityLock: PowerManager.WakeLock? = null
    private var focusRequest: AudioFocusRequest? = null
    private var previousMode = AudioManager.MODE_NORMAL
    private var bluetoothScoOn = false

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        previousMode = audioManager.mode
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // notification buttons arrive here
        when (intent?.action) {
            ACTION_ACCEPT -> {
                handleAction(this, ACTION_ACCEPT)
                return START_STICKY
            }
            ACTION_DECLINE -> {
                handleAction(this, ACTION_DECLINE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_END -> {
                handleAction(this, ACTION_END)
                stopSelf()
                return START_NOT_STICKY
            }
        }

        val state = runCatching { CallState.valueOf(intent?.getStringExtra(EXTRA_STATE) ?: "") }
            .getOrDefault(CallState.CONNECTED)
        val type = intent?.getStringExtra(EXTRA_TYPE) ?: "audio"
        val peer = intent?.getStringExtra(EXTRA_PEER)?.takeIf { it.isNotBlank() }?.let { json ->
            runCatching {
                val o = JSONObject(json)
                User(
                    id = o.optString("id"),
                    phone = o.optString("phone"),
                    name = o.optString("name"),
                    avatar = o.optString("avatar"),
                    about = o.optString("about"),
                )
            }.getOrNull()
        }
        val speaker = intent?.getBooleanExtra(EXTRA_SPEAKER, false) ?: false

        val notification = buildNotification(peer, state, type)
        try {
            ServiceCompat.startForeground(
                this,
                Notify.ID_CALL,
                notification,
                if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL else 0,
            )
        } catch (t: Throwable) {
            // Background start is restricted on Android 12+: the notification
            // still rings, the user just has to tap it.
            runCatching { Notify.createChannels(this) }
        }

        acquireLocks(type)
        routeAudio(speaker)
        return START_STICKY
    }

    private fun buildNotification(peer: User?, state: CallState, type: String): android.app.Notification {
        val openIntent = PendingIntent.getActivity(
            this, 20,
            Intent(this, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            pendingFlags(),
        )

        val builder = NotificationCompat.Builder(this, Notify.CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(peer?.name?.ifBlank { peer.phone }.orEmpty().ifBlank { getString(R.string.app_name) })
            .setContentText(stateText(state, type))
            .setContentIntent(openIntent)
            .setOngoing(state != CallState.RINGING)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(false)

        if (state == CallState.RINGING) {
            builder.setFullScreenIntent(openIntent, true)
            builder.addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_delete, getString(R.string.decline), actionIntent(ACTION_DECLINE)
                ).build()
            )
            builder.addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_call, getString(R.string.accept), actionIntent(ACTION_ACCEPT)
                ).build()
            )
        } else {
            builder.addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_close_clear_cancel, getString(R.string.end_call), actionIntent(ACTION_END)
                ).build()
            )
        }
        return builder.build()
    }

    private fun actionIntent(action: String): PendingIntent =
        PendingIntent.getService(
            this, action.hashCode(),
            Intent(this, CallService::class.java).setAction(action),
            pendingFlags(),
        )

    private fun pendingFlags(): Int =
        if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else PendingIntent.FLAG_UPDATE_CURRENT

    private fun stateText(state: CallState, type: String): String = when (state) {
        CallState.RINGING -> if (type == "video") getString(R.string.incoming_video_call) else getString(R.string.incoming_voice_call)
        CallState.CALLING -> getString(R.string.calling)
        CallState.CONNECTING -> getString(R.string.connecting)
        CallState.CONNECTED -> getString(R.string.ongoing_call)
        CallState.RECONNECTING -> getString(R.string.reconnecting)
        CallState.ENDED -> getString(R.string.call_ended)
        else -> getString(R.string.app_name)
    }

    private fun acquireLocks(type: String) {
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (wakeLock == null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Masingar:call").apply {
                setReferenceCounted(false)
                runCatching { acquire(60 * 60 * 1000L) }
            }
        }
        if (type != "video" && proximityLock == null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            proximityLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "Masingar:proximity").apply {
                setReferenceCounted(false)
                runCatching { acquire() }
            }
        }
    }

    private fun routeAudio(speaker: Boolean) {
        runCatching { audioManager.mode = AudioManager.MODE_IN_COMMUNICATION }
        requestFocus()
        runCatching {
            audioManager.isSpeakerphoneOn = speaker
            if (!speaker) {
                val hasBt = runCatching { audioManager.isBluetoothScoAvailableOffCall }.getOrDefault(false)
                if (hasBt && !bluetoothScoOn) {
                    audioManager.startBluetoothSco()
                    audioManager.isBluetoothScoOn = true
                    bluetoothScoOn = true
                }
            } else if (bluetoothScoOn) {
                audioManager.stopBluetoothSco()
                audioManager.isBluetoothScoOn = false
                bluetoothScoOn = false
            }
        }
    }

    private fun requestFocus() {
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusRequest == null) {
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).build()
                focusRequest = req
                runCatching { audioManager.requestAudioFocus(req) }
            }
        } else {
            @Suppress("DEPRECATION")
            runCatching {
                audioManager.requestAudioFocus(
                    null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                )
            }
        }
    }

    private fun releaseAudio() {
        runCatching {
            if (bluetoothScoOn) {
                audioManager.stopBluetoothSco()
                audioManager.isBluetoothScoOn = false
                bluetoothScoOn = false
            }
            audioManager.isSpeakerphoneOn = false
            audioManager.mode = previousMode
            if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(null)
            }
            focusRequest = null
        }
    }

    override fun onDestroy() {
        releaseAudio()
        runCatching { wakeLock?.release() }
        runCatching { proximityLock?.release() }
        wakeLock = null
        proximityLock = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): android.os.IBinder? = null

    companion object {
        private const val EXTRA_STATE = "state"
        private const val EXTRA_TYPE = "type"
        private const val EXTRA_PEER = "peer"
        private const val EXTRA_SPEAKER = "speaker"
        const val ACTION_ACCEPT = "io.masingar.chat.CALL_ACCEPT"
        const val ACTION_DECLINE = "io.masingar.chat.CALL_DECLINE"
        const val ACTION_END = "io.masingar.chat.CALL_END"

        fun start(context: Context, call: io.masingar.chat.calls.ActiveCall?, state: CallState) {
            val intent = Intent(context, CallService::class.java).apply {
                putExtra(EXTRA_STATE, state.name)
                putExtra(EXTRA_TYPE, call?.type ?: "audio")
                putExtra(EXTRA_SPEAKER, state != CallState.RINGING && call?.type == "video")
                putExtra(
                    EXTRA_PEER,
                    call?.peer?.let { JSONObject().apply {
                        put("id", it.id); put("phone", it.phone); put("name", it.name); put("avatar", it.avatar)
                    }.toString() }.orEmpty(),
                )
            }
            runCatching {
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            }.onFailure {
                runCatching { context.startService(intent) }
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallService::class.java)) }
        }

        fun setSpeaker(context: Context, on: Boolean) {
            val intent = Intent(context, CallService::class.java).apply {
                putExtra(EXTRA_STATE, CallState.CONNECTED.name)
                putExtra(EXTRA_SPEAKER, on)
            }
            runCatching { context.startService(intent) }
        }

        fun handleAction(context: Context, action: String?) {
            when (action) {
                ACTION_ACCEPT -> {
                    CallManager.accept(context)
                    context.startActivity(
                        Intent(context, CallActivity::class.java).addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        )
                    )
                }
                ACTION_DECLINE -> CallManager.decline()
                ACTION_END -> CallManager.end()
            }
        }
    }
}
