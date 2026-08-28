package io.masingar.chat.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import io.masingar.chat.data.Prefs
import io.masingar.chat.data.Repository
import io.masingar.chat.net.SocketClient
import io.masingar.chat.util.ContactsSync
import kotlinx.coroutines.runBlocking
import java.util.concurrent.TimeUnit

/**
 * Keeps the local cache fresh and re-delivers queued messages after the device
 * was offline. Also runs once after boot (see BootReceiver).
 */
class SyncWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {

    override fun doWork(): Result {
        val context = applicationContext
        if (!Prefs.isLoggedIn) return Result.success()
        Repository.init(context)
        return try {
            runBlocking {
                Repository.refreshAll()
                Repository.retryOutbox()
                if (ContactsSync.hasPermission(context)) {
                    Repository.saveContacts(ContactsSync.sync(context))
                }
            }
            Result.success()
        } catch (t: Throwable) {
            Result.retry()
        }
    }

    companion object {
        private const val NAME = "masingar-sync"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            runCatching {
                WorkManager.getInstance(context)
                    .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
            }
        }

        fun kick(context: Context) {
            SocketClient.reconnect()
            schedule(context)
        }
    }
}
