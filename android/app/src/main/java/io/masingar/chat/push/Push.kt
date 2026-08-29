package io.masingar.chat.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import io.masingar.chat.BuildConfig
import io.masingar.chat.data.Prefs
import io.masingar.chat.net.Http

/**
 * Firebase Cloud Messaging, initialised from BuildConfig values so the project
 * does **not** depend on the google-services plugin or a google-services.json.
 *
 * Without configuration push is simply disabled: the app keeps working through
 * its own WebSocket while it is in the foreground / background.
 */
object Push {

    fun init(context: Context) {
        if (BuildConfig.FCM_APP_ID.isBlank() || BuildConfig.FCM_SENDER_ID.isBlank()) return
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(
                    context,
                    FirebaseOptions.Builder()
                        .setApplicationId(BuildConfig.FCM_APP_ID)
                        .setApiKey(BuildConfig.FCM_API_KEY)
                        .setProjectId(BuildConfig.FCM_PROJECT_ID)
                        .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
                        .build(),
                )
            }
            refreshToken()
        } catch (t: Throwable) {
            /* push stays disabled */
        }
    }

    fun refreshToken() {
        if (BuildConfig.FCM_APP_ID.isBlank()) return
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    Prefs.pushToken = token
                    Thread {
                        runCatching { Http.pushToken(token) }
                    }.start()
                }
        } catch (t: Throwable) {
            /* ignore */
        }
    }
}
