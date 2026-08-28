package io.masingar.chat.ui

import android.Manifest
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.masingar.chat.R
import io.masingar.chat.data.Conversation
import io.masingar.chat.data.Message
import io.masingar.chat.data.Prefs
import io.masingar.chat.data.Repository
import io.masingar.chat.net.Http
import io.masingar.chat.util.ContactsSync
import io.masingar.chat.util.Format
import io.masingar.chat.util.NetworkMonitor
import io.masingar.chat.util.Phone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class Tab { CHATS, CALLS, CONTACTS, SETTINGS }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenChat: (String) -> Unit,
    onStartCall: (peerId: String, type: String) -> Unit,
    onLogout: () -> Unit,
    requestContactsPermission: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(Tab.CHATS) }
    var search by remember { mutableStateOf("") }
    var showSearch by remember { mutableStateOf(false) }
    var addPhoneDialog by remember { mutableStateOf(false) }

    val conversations by Repository.conversations.collectAsState()
    val contacts by Repository.contacts.collectAsState()
    val calls by Repository.calls.collectAsState()
    val presence by Repository.presence.collectAsState()
    val syncing by Repository.syncing.collectAsState()
    val net by NetworkMonitor.info.collectAsState()

    LaunchedEffect(Unit) {
        Repository.refreshAll()
        if (ContactsSync.hasPermission(context)) {
            Repository.saveContacts(ContactsSync.sync(context))
        }
    }

    val filtered = remember(conversations, search) {
        if (search.isBlank()) conversations
        else conversations.filter { it.title.contains(search, true) || it.lastMessage?.body?.contains(search, true) == true }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (showSearch) {
                        OutlinedTextField(
                            value = search,
                            onValueChange = { search = it },
                            placeholder = { Text(stringResource(R.string.search_hint)) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        Column {
                            Text(
                                text = stringResource(R.string.app_name),
                                style = MaterialTheme.typography.titleLarge,
                            )
                            Text(
                                text = if (net.connected) net.typeLabel else stringResource(R.string.offline),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { showSearch = !showSearch }) {
                        Icon(Icons.Default.Search, contentDescription = stringResource(R.string.search_hint))
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == Tab.CHATS,
                    onClick = { tab = Tab.CHATS },
                    icon = { Icon(Icons.Default.Call, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_chats)) },
                )
                NavigationBarItem(
                    selected = tab == Tab.CALLS,
                    onClick = { tab = Tab.CALLS },
                    icon = { Icon(Icons.Default.Call, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_calls)) },
                )
                NavigationBarItem(
                    selected = tab == Tab.CONTACTS,
                    onClick = { tab = Tab.CONTACTS },
                    icon = { Icon(Icons.Default.PersonAdd, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_contacts)) },
                )
                NavigationBarItem(
                    selected = tab == Tab.SETTINGS,
                    onClick = { tab = Tab.SETTINGS },
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_settings)) },
                )
            }
        },
        floatingActionButton = {
            if (tab == Tab.CONTACTS) {
                FloatingActionButton(onClick = { addPhoneDialog = true }) {
                    Icon(Icons.Default.PersonAdd, contentDescription = stringResource(R.string.add_contact))
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.CHATS -> ChatsTab(items = filtered, presence = presence, onOpen = onOpenChat)
                Tab.CALLS -> CallsTab(items = calls, onCall = onStartCall)
                Tab.CONTACTS -> ContactsTab(
                    hasPermission = ContactsSync.hasPermission(context),
                    onGrant = requestContactsPermission,
                    onSync = {
                        scope.launch {
                            Repository.saveContacts(ContactsSync.sync(context, force = true))
                        }
                    },
                    onOpen = { userId ->
                        scope.launch {
                            Repository.startDirect(userId)?.let { onOpenChat(it) }
                        }
                    },
                    onCall = onStartCall,
                )
                Tab.SETTINGS -> SettingsTab(onLogout = onLogout)
            }
        }
    }

    if (addPhoneDialog) {
        AddByPhoneDialog(
            onDismiss = { addPhoneDialog = false },
            onConfirm = { number ->
                addPhoneDialog = false
                scope.launch {
                    val e164 = Phone.normalize(number, Phone.deviceRegion(context))
                    Repository.startDirectByPhone(e164)?.let { onOpenChat(it) }
                }
            },
        )
    }
}

/* ---------------------------------- chats ---------------------------------- */

@Composable
private fun ChatsTab(
    items: List<Conversation>,
    presence: Map<String, Boolean>,
    onOpen: (String) -> Unit,
) {
    if (items.isEmpty()) {
        EmptyState(stringResource(R.string.no_chats), modifier = Modifier.fillMaxSize())
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(items, key = { it.id }) { conv ->
            val peer = conv.peer
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(conv.id) }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(peer ?: io.masingar.chat.data.User(id = conv.id, name = conv.title))
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = conv.title,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = Format.day(conv.lastMessage?.createdAt ?: conv.updatedAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = previewOf(conv.lastMessage),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (conv.unread > 0) {
                            Spacer(Modifier.width(6.dp))
                            Surface(
                                shape = MaterialTheme.shapes.extraSmall,
                                color = MaterialTheme.colorScheme.primary,
                            ) {
                                Text(
                                    text = conv.unread.toString(),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    style = MaterialTheme.typography.labelSmall,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun previewOf(message: Message?): String {
    if (message == null) return ""
    val opened = Repository.payloadOf(message)?.optString("x").orEmpty()
    val text = if (message.encrypted) opened else message.body
    return when (message.type) {
        "image" -> "📷 صورة"
        "video" -> "🎥 فيديو"
        "audio" -> "🎤 رسالة صوتية"
        "file" -> "📎 ${runCatching { org.json.JSONObject(Repository.payloadOf(message)?.toString().orEmpty()).optJSONObject("m")?.optString("name").orEmpty() }.getOrDefault("").ifBlank { "ملف" }}"
        "call" -> "📞 مكالمة"
        else -> text.ifBlank { if (message.encrypted) "🔒 رسالة مشفّرة" else "" }
    }
}

/* ---------------------------------- calls ---------------------------------- */

@Composable
private fun CallsTab(items: List<io.masingar.chat.data.CallItem>, onCall: (String, String) -> Unit) {
    if (items.isEmpty()) {
        EmptyState(stringResource(R.string.no_calls), modifier = Modifier.fillMaxSize())
        return
    }
    val meId = Prefs.me?.id.orEmpty()
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(items, key = { it.id }) { call ->
            val outgoing = call.callerId == meId
            val peerId = if (outgoing) call.calleeId else call.callerId
            val peer = Repository.conversations.value
                .firstOrNull { it.members.any { m -> m.id == peerId } }
                ?.members?.firstOrNull { it.id == peerId }
                ?: io.masingar.chat.data.User(id = peerId)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onCall(peerId, call.type) }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(peer)
                Spacer(Modifier.width(12.dp))
                val icon = if (call.type == "video") "🎥" else "📞"
                val direction = when {
                    call.state == "missed" && !outgoing -> stringResource(R.string.call_missed)
                    outgoing -> stringResource(R.string.outgoing_call)
                    else -> stringResource(R.string.incoming_call)
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = peer.name.ifBlank { Phone.pretty(peer.phone) }, style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = "$icon $direction · ${Format.day(call.startedAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (call.state == "missed" && !outgoing) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (call.durationMs > 0) {
                    Text(text = Format.duration(call.durationMs), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

/* --------------------------------- contacts -------------------------------- */

@Composable
private fun ContactsTab(
    hasPermission: Boolean,
    onGrant: () -> Unit,
    onSync: () -> Unit,
    onOpen: (String) -> Unit,
    onCall: (String, String) -> Unit,
) {
    val contacts by Repository.contacts.collectAsState()
    if (!hasPermission) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(stringResource(R.string.contacts_permission_needed), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onGrant) { Text(stringResource(R.string.grant)) }
        }
        return
    }
    if (contacts.isEmpty()) {
        EmptyState(stringResource(R.string.no_contacts), modifier = Modifier.fillMaxSize())
        return
    }
    val registered = contacts.filter { it.user != null }
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "${stringResource(R.string.tab_contacts)} (${registered.size})",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onSync) { Text(stringResource(R.string.contacts_sync_now)) }
            }
        }
        items(registered, key = { it.phoneHash }) { contact ->
            val user = contact.user ?: return@items
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(user.id) }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(user)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = user.name, style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = user.about.ifBlank { Phone.pretty(user.phone) },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = { onCall(user.id, "audio") }) {
                    Icon(Icons.Default.Call, contentDescription = stringResource(R.string.voice_call))
                }
                IconButton(onClick = { onCall(user.id, "video") }) {
                    Icon(Icons.Default.Videocam, contentDescription = stringResource(R.string.video_call))
                }
            }
        }
    }
}

/* --------------------------------- settings -------------------------------- */

@Composable
private fun SettingsTab(onLogout: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by Repository.me.collectAsState()
    var quality by remember { mutableStateOf(Prefs.quality) }
    var auto by remember { mutableStateOf(Prefs.autoQuality) }
    var saver by remember { mutableStateOf(Prefs.dataSaver) }
    var fallback by remember { mutableStateOf(Prefs.audioOnlyFallback) }
    var stats by remember { mutableStateOf(Prefs.showStats) }
    var server by remember { mutableStateOf(Prefs.serverUrl) }
    var name by remember { mutableStateOf(me?.name.orEmpty()) }
    var about by remember { mutableStateOf(me?.about.orEmpty()) }
    var info by remember { mutableStateOf("") }

    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(stringResource(R.string.profile), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(stringResource(R.string.name)) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = about, onValueChange = { about = it }, label = { Text(stringResource(R.string.about)) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = {
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) { Http.updateMe(name = name, about = about) }
                                Repository.refreshAll()
                                info = context.getString(R.string.saved)
                            }
                        }
                    }) { Text(stringResource(R.string.save)) }
                }
            }
        }
        item {
            Spacer(Modifier.height(16.dp))
            Text(stringResource(R.string.calls_quality), style = MaterialTheme.typography.titleMedium)
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                listOf("saver" to R.string.quality_saver, "auto" to R.string.quality_auto, "hd" to R.string.quality_hd)
                    .forEach { (key, label) ->
                        TextButton(
                            onClick = { quality = key; Prefs.quality = key },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                text = stringResource(label),
                                color = if (quality == key) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
            }
            SettingSwitch(stringResource(R.string.auto_quality), auto) { auto = it; Prefs.autoQuality = it }
            SettingSwitch(stringResource(R.string.data_saver), saver) { saver = it; Prefs.dataSaver = it }
            SettingSwitch(stringResource(R.string.audio_only_fallback), fallback) { fallback = it; Prefs.audioOnlyFallback = it }
            SettingSwitch(stringResource(R.string.show_stats), stats) { stats = it; Prefs.showStats = it }
        }
        item {
            Spacer(Modifier.height(16.dp))
            Text(stringResource(R.string.server), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(value = server, onValueChange = { server = it }, label = { Text("URL") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Button(onClick = {
                Prefs.serverUrl = server.trim()
                scope.launch {
                    Repository.refreshAll()
                    io.masingar.chat.net.SocketClient.reconnect()
                }
            }) { Text(stringResource(R.string.save)) }
        }
        item {
            Spacer(Modifier.height(16.dp))
            Button(onClick = {
                scope.launch {
                    if (ContactsSync.hasPermission(context)) {
                        Repository.saveContacts(ContactsSync.sync(context, force = true))
                        info = context.getString(R.string.saved)
                    } else {
                        info = context.getString(R.string.contacts_permission_needed)
                    }
                }
            }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.contacts_sync_now)) }
        }
        item {
            Spacer(Modifier.height(24.dp))
            TextButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.logout), color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.version, "1.0.0", 1),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (info.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(text = info, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SettingSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun AddByPhoneDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_contact)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text(stringResource(R.string.phone_hint)) },
                singleLine = true,
            )
        },
        confirmButton = { TextButton(onClick = { if (text.isNotBlank()) onConfirm(text) }) { Text(stringResource(R.string.add_contact)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.cancel)) } },
    )
}
