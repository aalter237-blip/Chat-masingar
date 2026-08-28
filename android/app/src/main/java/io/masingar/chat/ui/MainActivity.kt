package io.masingar.chat.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import io.masingar.chat.R
import io.masingar.chat.calls.CallActivity
import io.masingar.chat.calls.CallManager
import io.masingar.chat.calls.CallState
import io.masingar.chat.data.Prefs
import io.masingar.chat.data.Repository
import io.masingar.chat.net.SocketClient
import io.masingar.chat.ui.theme.MasingarTheme
import io.masingar.chat.util.ContactsSync
import io.masingar.chat.util.NetworkMonitor
import io.masingar.chat.util.Notify
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            if (result[Manifest.permission.READ_CONTACTS] == true) {
                lifecycleScope.launch {
                    Repository.saveContacts(ContactsSync.sync(this@MainActivity))
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        NetworkMonitor.start(this)
        Notify.createChannels(this)
        Repository.init(this)
        CallManager.init(this)

        if (Prefs.isLoggedIn) {
            SocketClient.start()
            SocketClient.startHeartbeat()
            lifecycleScope.launch { Repository.refreshAll() }
        }

        setContent {
            MasingarTheme {
                AppRoot(
                    onRequestPermissions = { askPermissions() },
                    onLogout = {
                        Repository.logout()
                        recreate()
                    },
                )
            }
        }

        askPermissions()
    }

    override fun onStart() {
        super.onStart()
        Repository.foreground = true
        io.masingar.chat.work.SyncWorker.schedule(this)
    }

    override fun onStop() {
        Repository.foreground = false
        super.onStop()
    }

    private fun askPermissions() {
        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA, Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33) needed += Manifest.permission.POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT >= 31) needed += Manifest.permission.BLUETOOTH_CONNECT
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    }
}

@Composable
fun AppRoot(onRequestPermissions: () -> Unit, onLogout: () -> Unit) {
    val context = LocalContext.current
    val me by Repository.me.collectAsState()
    val conversations by Repository.conversations.collectAsState()
    val callState by CallManager.state.collectAsState()

    var screen by remember { mutableStateOf(if (me != null) "home" else "login") }
    var openConvId by remember { mutableStateOf<String?>(null) }

    // Show the call UI as soon as a call starts or rings
    LaunchedEffect(callState) {
        if (callState == CallState.RINGING || callState == CallState.CALLING || callState == CallState.CONNECTING) {
            context.startActivity(
                Intent(context, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            )
        }
    }

    fun startCall(peerId: String, type: String, conversationId: String? = null) {
        if (!CallManager.hasPermissions(context, type == "video")) {
            Toast.makeText(context, context.getString(R.string.error_permission), Toast.LENGTH_SHORT).show()
            onRequestPermissions()
            return
        }
        CallManager.startCall(context, peerId, type, conversationId)
    }

    when (screen) {
        "login" -> LoginScreen(onLoggedIn = { screen = "home" })

        "home" -> HomeScreen(
            onOpenChat = { id ->
                openConvId = id
                Repository.openConversation(id)
                screen = "chat"
            },
            onStartCall = { peerId, type -> startCall(peerId, type) },
            onLogout = onLogout,
            requestContactsPermission = onRequestPermissions,
        )

        "chat" -> {
            BackHandler {
                Repository.closeConversation()
                openConvId = null
                screen = "home"
            }
            val conv = conversations.firstOrNull { it.id == openConvId }
            if (conv == null) {
                LaunchedEffect(Unit) { screen = "home" }
            } else {
                ChatScreen(
                    conversation = conv,
                    onBack = {
                        Repository.closeConversation()
                        openConvId = null
                        screen = "home"
                    },
                    onCall = { peerId, type -> startCall(peerId, type, conv.id) },
                )
            }
        }
    }
}
