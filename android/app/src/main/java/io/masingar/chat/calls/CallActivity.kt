package io.masingar.chat.calls

import android.Manifest
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.masingar.chat.R
import io.masingar.chat.data.Prefs
import io.masingar.chat.ui.theme.MasingarTheme
import io.masingar.chat.util.Format
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

class CallActivity : ComponentActivity() {

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            if (result[Manifest.permission.RECORD_AUDIO] == true) {
                CallManager.accept(this)
            } else {
                CallManager.decline()
                finish()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
        )
        setContent {
            MasingarTheme {
                CallScreen(
                    onAccept = {
                        val perms = mutableListOf(Manifest.permission.RECORD_AUDIO)
                        if (CallManager.call.value?.type == "video") perms += Manifest.permission.CAMERA
                        permissionLauncher.launch(perms.toTypedArray())
                    },
                    onDecline = { CallManager.decline(); finish() },
                    onEnd = { CallManager.end(); finish() },
                    onFinish = { finish() },
                )
            }
        }
    }
}

@Composable
fun CallScreen(
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onEnd: () -> Unit,
    onFinish: () -> Unit,
) {
    val context = LocalContext.current
    val call by CallManager.call.collectAsState()
    val state by CallManager.state.collectAsState()
    val stats by CallManager.stats.collectAsState()
    val localVideo by CallManager.localVideo.collectAsState()
    val remoteVideo by CallManager.remoteVideo.collectAsState()
    val remoteVideoOn by CallManager.remoteVideoEnabled.collectAsState()
    val muted by CallManager.muted.collectAsState()
    val speaker by CallManager.speaker.collectAsState()
    val videoOn by CallManager.videoEnabled.collectAsState()
    val isVideo = call?.type == "video"

    var elapsed by remember(state) { mutableStateOf(0L) }
    LaunchedEffect(state) {
        if (state == CallState.CONNECTED) {
            val start = System.currentTimeMillis()
            while (state == CallState.CONNECTED) {
                elapsed = System.currentTimeMillis() - start
                kotlinx.coroutines.delay(500)
            }
        }
    }
    LaunchedEffect(state) {
        if (state == CallState.IDLE) onFinish()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B141A)),
        contentAlignment = Alignment.Center,
    ) {
        if (isVideo && remoteVideoOn && remoteVideo != null) {
            VideoRenderer(track = remoteVideo, mirror = false, modifier = Modifier.fillMaxSize())
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(32.dp))
            Text(
                text = call?.peer?.name?.ifBlank { call?.peer?.phone }.orEmpty(),
                style = MaterialTheme.typography.headlineSmall,
                color = Color.White,
            )
            Text(
                text = statusText(state, elapsed),
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF8696A0),
            )
            if (Prefs.showStats && state == CallState.CONNECTED) {
                StatsPanel(stats = stats, modifier = Modifier.padding(top = 12.dp))
            }

            if (isVideo && !remoteVideoOn) {
                Spacer(Modifier.height(24.dp))
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = Color(0x22FFFFFF),
                ) {
                    Text(
                        text = stringRes(R.string.audio_only_notice),
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }

            Spacer(Modifier.weight(1f))

            if (isVideo && localVideo != null && videoOn) {
                VideoRenderer(
                    track = localVideo,
                    mirror = true,
                    modifier = Modifier
                        .size(width = 104.dp, height = 148.dp)
                        .align(Alignment.End)
                        .offset(x = (-8).dp)
                        .clip(RoundedCornerShape(14.dp)),
                )
                Spacer(Modifier.height(16.dp))
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (state == CallState.RINGING && call?.outgoing == false) {
                    FloatingActionButton(
                        onClick = onDecline,
                        containerColor = Color(0xFFEA4335),
                        contentColor = Color.White,
                    ) { Icon(Icons.Default.CallEnd, contentDescription = stringRes(R.string.decline)) }
                    FloatingActionButton(
                        onClick = onAccept,
                        containerColor = Color(0xFF00A884),
                        contentColor = Color.White,
                    ) { Icon(Icons.Default.Call, contentDescription = stringRes(R.string.accept)) }
                } else {
                    CallToggle(
                        icon = if (muted) Icons.Default.MicOff else Icons.Default.Mic,
                        active = muted,
                        label = stringRes(R.string.mute),
                    ) { CallManager.toggleMute() }
                    CallToggle(
                        icon = Icons.Default.VolumeUp,
                        active = speaker,
                        label = stringRes(R.string.speaker),
                    ) { CallManager.toggleSpeaker(context) }
                    if (isVideo) {
                        CallToggle(
                            icon = if (videoOn) Icons.Default.Videocam else Icons.Default.VideocamOff,
                            active = !videoOn,
                            label = stringRes(R.string.camera_off),
                        ) { CallManager.toggleVideo() }
                        CallToggle(
                            icon = Icons.Default.Cameraswitch,
                            active = false,
                            label = stringRes(R.string.flip_camera),
                        ) { CallManager.switchCamera() }
                    }
                    FloatingActionButton(
                        onClick = onEnd,
                        containerColor = Color(0xFFEA4335),
                        contentColor = Color.White,
                    ) { Icon(Icons.Default.CallEnd, contentDescription = stringRes(R.string.end_call)) }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun CallToggle(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    active: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(
            onClick = onClick,
            modifier = Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(if (active) Color.White else Color(0x33FFFFFF)),
        ) {
            Icon(icon, contentDescription = label, tint = if (active) Color(0xFF0B141A) else Color.White)
        }
        Text(text = label, color = Color(0xFF8696A0), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun StatsPanel(stats: CallStats, modifier: Modifier = Modifier) {
    val rows = listOf(
        "الجودة" to "${stats.level} (${stats.score}%)",
        "البث" to "${stats.bitrateKbps} kbps",
        "الاستجابة" to "${stats.rttMs} ms",
        "الفقد" to "${"%.1f".format(stats.lossPercent)}%",
        "الدقة" to (if (stats.width > 0) "${stats.width}×${stats.height} @${stats.fps}" else "-"),
        "الترميز" to "${stats.audioCodec.ifBlank { "-" }}/${stats.videoCodec.ifBlank { "-" }}",
    )
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = Color(0x22FFFFFF),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            rows.chunked(2).forEach { pair ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    pair.forEach { (k, v) ->
                        Text(
                            text = "$k: $v",
                            color = Color.White,
                            style = MaterialTheme.typography.labelSmall,
                            textAlign = TextAlign.Start,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun VideoRenderer(track: VideoTrack?, mirror: Boolean, modifier: Modifier) {
    // Read the shared EGL context LIVE (no remember): it becomes available only
    // after the WebRTC engine is created, and it must be rebuilt when a new
    // engine replaces the old one - reusing a released context crashes.
    val eglContext = CallManager.eglContext()
    if (eglContext == null) return
    key(eglContext) {
        AndroidView(
            factory = { ctx ->
                SurfaceViewRenderer(ctx).apply {
                    init(eglContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                    setEnableHardwareScaler(true)
                    setMirror(mirror)
                }
            },
            update = { view ->
                track?.addSink(view)
                view.setMirror(mirror)
            },
            onRelease = { view -> track?.removeSink(view); view.release() },
            modifier = modifier,
        )
    }
}

@Composable
private fun statusText(state: CallState, elapsed: Long): String = when (state) {
    CallState.CALLING -> stringRes(R.string.calling)
    CallState.RINGING -> if (CallManager.call.value?.outgoing == true) stringRes(R.string.calling) else stringRes(R.string.incoming_voice_call)
    CallState.CONNECTING -> stringRes(R.string.connecting)
    CallState.CONNECTED -> "${stringRes(R.string.connected)} · ${Format.duration(elapsed)}"
    CallState.RECONNECTING -> stringRes(R.string.reconnecting)
    CallState.ENDED -> stringRes(R.string.call_ended)
    CallState.IDLE -> ""
}

@Composable
private fun stringRes(id: Int): String = androidx.compose.ui.res.stringResource(id)
