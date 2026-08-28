package io.masingar.chat.ui

import android.media.MediaRecorder
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import io.masingar.chat.R
import io.masingar.chat.data.Conversation
import io.masingar.chat.data.Message
import io.masingar.chat.data.Repository
import io.masingar.chat.net.Http
import io.masingar.chat.util.Format
import io.masingar.chat.util.Phone
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    conversation: Conversation,
    onBack: () -> Unit,
    onCall: (String, String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val messages by Repository.messages.collectAsState()
    val typing by Repository.typing.collectAsState()
    val presence by Repository.presence.collectAsState()
    val lastSeen by Repository.lastSeen.collectAsState()
    val listState = rememberLazyListState()
    var input by remember { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var recorder: MediaRecorder? by remember { mutableStateOf(null) }
    var recordFile: File? by remember { mutableStateOf(null) }

    val attachLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        scope.launch {
            val file = copyToCache(context, uri)
            val isVideo = context.contentResolver.getType(uri)?.startsWith("video") == true
            if (file != null) {
                Repository.uploadThenSend(conversation.id, file, if (isVideo) "video" else "image")
            }
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    LaunchedEffect(input) {
        Repository.sendTyping(conversation.id, input.isNotBlank())
    }
    DisposableEffect(Unit) {
        onDispose {
            runCatching { recorder?.stop(); recorder?.release() }
            Repository.sendTyping(conversation.id, false)
        }
    }

    val peer = conversation.peer
    val online = peer?.let { presence[it.id] } ?: false

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = null) }
                },
                title = {
                    Column {
                        Text(conversation.title, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = when {
                                conversation.type == "group" -> "${conversation.members.size} ${stringResource(R.string.tab_contacts)}"
                                online -> stringResource(R.string.online)
                                typing.isNotEmpty() -> stringResource(R.string.typing)
                                else -> stringResource(R.string.last_seen, Format.time(lastSeen[peer?.id] ?: peer?.lastSeen ?: 0L))
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (online) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { peer?.let { onCall(it.id, "audio") } }) {
                        Icon(Icons.Default.Call, contentDescription = stringResource(R.string.voice_call))
                    }
                    IconButton(onClick = { peer?.let { onCall(it.id, "video") } }) {
                        Icon(Icons.Default.Videocam, contentDescription = stringResource(R.string.video_call))
                    }
                },
            )
        },
        bottomBar = {
            Surface(tonalElevation = 2.dp) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    IconButton(onClick = { attachLauncher.launch("*/*") }) {
                        Icon(Icons.Default.AttachFile, contentDescription = stringResource(R.string.attach_file))
                    }
                    OutlinedTextField(
                        value = input,
                        onValueChange = { input = it },
                        placeholder = { Text(stringResource(R.string.message_hint)) },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp, max = 140.dp),
                        maxLines = 6,
                    )
                    if (input.isBlank()) {
                        IconButton(onClick = {
                            if (recording) {
                                recording = false
                                runCatching { recorder?.stop(); recorder?.release() }
                                recorder = null
                                recordFile?.let { file ->
                                    if (file.length() > 500) {
                                        scope.launch { Repository.uploadThenSend(conversation.id, file, "audio") }
                                    }
                                }
                            } else {
                                val file = File(context.cacheDir, "note_${System.currentTimeMillis()}.m4a")
                                val rec = if (android.os.Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
                                runCatching {
                                    rec.setAudioSource(MediaRecorder.AudioSource.MIC)
                                    rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                                    rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                                    rec.setAudioEncodingBitRate(48000)
                                    rec.setAudioSamplingRate(44100)
                                    rec.setOutputFile(file.absolutePath)
                                    rec.prepare()
                                    rec.start()
                                    recorder = rec
                                    recordFile = file
                                    recording = true
                                }.onFailure {
                                    runCatching { rec.release() }
                                }
                            }
                        }) {
                            Icon(
                                Icons.Default.Mic,
                                contentDescription = stringResource(R.string.record_voice),
                                tint = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        IconButton(onClick = {
                            val text = input.trim()
                            input = ""
                            if (text.isNotBlank()) Repository.send(conversation.id, "text", text)
                        }) {
                            Icon(Icons.Default.Send, contentDescription = stringResource(R.string.send_now), tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (messages.isEmpty()) {
                EmptyState(stringResource(R.string.no_messages), modifier = Modifier.fillMaxSize())
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().padding(horizontal = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(messages, key = { it.id }) { message -> MessageBubble(message, conversation) }
                    item { Spacer(Modifier.height(8.dp)) }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: Message, conversation: Conversation) {
    val mine = message.senderId == io.masingar.chat.data.Prefs.me?.id
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showMenu by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 1.dp,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clickable { showMenu = !showMenu },
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (conversation.type == "group" && !mine) {
                    Text(
                        text = conversation.members.firstOrNull { it.id == message.senderId }?.name.orEmpty(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                when {
                    message.deleted -> {
                        Text(stringResource(R.string.message_deleted), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    message.type == "image" && message.mediaUrl.isNotBlank() -> {
                        AsyncImage(
                            model = Http.media(message.mediaUrl),
                            contentDescription = null,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 260.dp)
                                .clip(RoundedCornerShape(10.dp)),
                        )
                        if (message.body.isNotBlank()) Text(message.body)
                    }
                    message.type == "audio" -> Text("🎤 ${stringResource(R.string.record_voice)}")
                    message.type == "file" -> Text("📎 ${message.body.ifBlank { "ملف" }}")
                    message.type == "call" -> Text("📞 ${message.body}")
                    else -> Text(text = message.body, textAlign = TextAlign.Start)
                }
                Row(
                    modifier = Modifier.align(Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = Format.time(message.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (mine) {
                        Spacer(Modifier.size(4.dp))
                        Text(
                            text = when (message.status) {
                                "read" -> "✓✓"
                                "delivered" -> "✓✓"
                                "sending" -> "⏳"
                                else -> "✓"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (message.status == "read") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (showMenu && mine) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = stringResource(R.string.delete),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable {
                            showMenu = false
                            scope.launch { Repository.deleteMessage(message.id) }
                        },
                    )
                }
            }
        }
    }
}

private fun copyToCache(context: android.content.Context, uri: Uri): File? = runCatching {
    val input = context.contentResolver.openInputStream(uri) ?: return null
    val ext = (context.contentResolver.getType(uri) ?: "").substringAfter('/').substringBefore(';').ifBlank { "bin" }
    val file = File(context.cacheDir, "up_${System.currentTimeMillis()}.$ext")
    FileOutputStream(file).use { out -> input.copyTo(out) }
    input.close()
    file
}.getOrNull()
