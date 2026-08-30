package io.masingar.chat

import android.app.Application
import coil.Coil
import coil.ImageLoader
import io.masingar.chat.data.Prefs
import io.masingar.chat.net.SocketClient
import io.masingar.chat.push.Push
import io.masingar.chat.util.CrashCatcher
import io.masingar.chat.util.NetworkMonitor
import io.masingar.chat.util.Notify
import io.masingar.chat.work.SyncWorker

class MasingarApp : Application() {

    override fun onCreate() {
        super.onCreate()
        CrashCatcher.install(this)
        Prefs.init(this)
        Notify.createChannels(this)
        NetworkMonitor.start(this)
        Coil.setImageLoader(
            ImageLoader.Builder(this)
                .crossfade(true)
                .respectCacheHeaders(false)
                .build(),
        )
        Push.init(this)
        SyncWorker.schedule(this)
        if (Prefs.isLoggedIn) SocketClient.start()
    }
}
