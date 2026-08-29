package io.masingar.chat.util

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import io.masingar.chat.R
import io.masingar.chat.data.Conversation
import io.masingar.chat.data.Message
import io.masingar.chat.data.Repository
import io.masingar.chat.data.User

object Notify {
    const val CH_MESSAGES = "messages"
    const val CH_CALLS = "calls"
    const val CH_SERVICE = "service"
    const val ID_CALL = 9001
    const val ID_SERVICE = 9002

    fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun createChannels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (Build.VERSION.SDK_INT >= 26) {
            val messages = NotificationChannel(
                CH_MESSAGES,
                context.getString(R.string.channel_messages),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.channel_messages_desc)
                enableVibration(true)
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build(),
                )
            }
            val calls = NotificationChannel(
                CH_CALLS,
                context.getString(R.string.channel_calls),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.channel_calls_desc)
                enableVibration(true)
            }
            val service = NotificationChannel(
                CH_SERVICE,
                context.getString(R.string.channel_service),
                NotificationManager.IMPORTANCE_LOW,
            )
            manager.createNotificationChannels(listOf(messages, calls, service))
        }
    }

    private fun person(context: Context, user: User?): Person =
        Person.Builder()
            .setName(user?.name?.ifBlank { user.phone }.orEmpty().ifBlank { context.getString(R.string.app_name) })
            .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
            .build()

    fun message(context: Context, conv: Conversation?, m: Message) {
        if (!canPost(context)) return
        val id = conv?.id?.hashCode() ?: m.conversationId.hashCode()
        val preview = when (m.type) {
            "image" -> "📷"
            "video" -> "🎥"
            "audio" -> "🎤"
            "file" -> "📎"
            "call" -> "📞"
            else -> if (m.encrypted) {
                Repository.payloadOf(m)?.optString("x")?.takeIf { it.isNotBlank() } ?: "🔒 رسالة مشفّرة"
            } else {
                m.body
            }
        }
        val notification = NotificationCompat.Builder(context, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(conv?.title ?: context.getString(R.string.new_message))
            .setContentText(preview)
            .setStyle(NotificationCompat.MessagingStyle(person(context, null))
                .addMessage(preview, m.createdAt, person(context, conv?.peer)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
    }

    fun missedCall(context: Context, user: User?, type: String) {
        if (!canPost(context)) return
        val notification = NotificationCompat.Builder(context, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(context.getString(R.string.call_missed))
            .setContentText(context.getString(R.string.missed_call_from, user?.name?.ifBlank { user.phone }.orEmpty()))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify((type + user?.id).hashCode(), notification) }
    }

    /** Low priority notification used while a call is running in the foreground. */
    fun callNotification(
        context: Context,
        user: User?,
        state: String,
        isVideo: Boolean,
        contentIntent: android.app.PendingIntent?,
    ): android.app.Notification {
        val builder = NotificationCompat.Builder(context, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(user?.name?.ifBlank { user.phone }.orEmpty().ifBlank { context.getString(R.string.app_name) })
            .setContentText(state)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        contentIntent?.let { builder.setContentIntent(it) }
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setStyle(
                NotificationCompat.CallStyle.forOngoingCall(person(context, user), contentIntent ?: dummyIntent(context))
            )
        }
        return builder.build()
    }

    /**
     * Generic high priority notification used to wake the device from a push.
     * It opens the given activity as a full screen intent (calls ring on the
     * lock screen this way).
     */
    fun wakeup(context: Context, title: String, body: String, activity: Class<*>) {
        val flags =
            if (Build.VERSION.SDK_INT >= 23) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            else android.app.PendingIntent.FLAG_UPDATE_CURRENT
        val intent = android.content.Intent(context, activity).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        val pi = android.app.PendingIntent.getActivity(context, 77, intent, flags)
        val notification = NotificationCompat.Builder(context, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pi, true)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        if (!canPost(context)) return
        runCatching { NotificationManagerCompat.from(context).notify(title.hashCode(), notification) }
    }

    private fun dummyIntent(context: Context): android.app.PendingIntent {
        val intent = android.content.Intent(context, io.masingar.chat.calls.CallActivity::class.java)
        val flags = if (Build.VERSION.SDK_INT >= 23) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT
        return android.app.PendingIntent.getActivity(context, 1, intent, flags)
    }
}
