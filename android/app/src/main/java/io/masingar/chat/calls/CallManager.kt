package io.masingar.chat.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import io.masingar.chat.data.IceServer
import io.masingar.chat.data.Prefs
import io.masingar.chat.data.Repository
import io.masingar.chat.data.User
import io.masingar.chat.data.parseUser
import io.masingar.chat.net.SocketClient
import io.masingar.chat.util.NetworkMonitor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.PeerConnection
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack

enum class CallState { IDLE, CALLING, RINGING, CONNECTING, CONNECTED, RECONNECTING, ENDED }

data class ActiveCall(
    val callId: String = "",
    val peerId: String = "",
    val peer: User? = null,
    val type: String = "audio",
    val outgoing: Boolean = false,
    val conversationId: String? = null,
    val startedAt: Long = 0L,
)

/**
 * Owns the call lifecycle and binds the signalling socket to the WebRTC engine.
 * The UI only observes the StateFlows below.
 */
object CallManager {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _call = MutableStateFlow<ActiveCall?>(null)
    val call: StateFlow<ActiveCall?> = _call.asStateFlow()

    private val _state = MutableStateFlow(CallState.IDLE)
    val state: StateFlow<CallState> = _state.asStateFlow()

    private val _stats = MutableStateFlow(CallStats())
    val stats: StateFlow<CallStats> = _stats.asStateFlow()

    private val _notices = MutableSharedFlow<Pair<Notice, String>>(extraBufferCapacity = 8)
    val notices = _notices.asSharedFlow()

    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()

    private val _remoteVideo = MutableStateFlow<VideoTrack?>(null)
    val remoteVideo: StateFlow<VideoTrack?> = _remoteVideo.asStateFlow()

    private val _remoteVideoEnabled = MutableStateFlow(true)
    val remoteVideoEnabled: StateFlow<Boolean> = _remoteVideoEnabled.asStateFlow()

    private val _muted = MutableStateFlow(false)
    val muted: StateFlow<Boolean> = _muted.asStateFlow()

    private val _speaker = MutableStateFlow(false)
    val speaker: StateFlow<Boolean> = _speaker.asStateFlow()

    private val _videoEnabled = MutableStateFlow(true)
    val videoEnabled: StateFlow<Boolean> = _videoEnabled.asStateFlow()

    private var engine: WebrtcEngine? = null
    private var pendingOffer: JSONObject? = null
    private var pendingIncoming: JSONObject? = null
    private var connectStartedAt = 0L
    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        scope.launch {
            SocketClient.frames.collect { frame -> onFrame(frame) }
        }
    }

    /* ------------------------------- outgoing -------------------------------- */

    fun startCall(context: Context, peerId: String, type: String, conversationId: String? = null) {
        if (_state.value != CallState.IDLE) return
        val isVideo = type == "video"
        if (!hasPermissions(context, isVideo)) return

        _call.value = ActiveCall(
            peerId = peerId,
            peer = findUser(peerId),
            type = type,
            outgoing = true,
            conversationId = conversationId,
        )
        _state.value = CallState.CALLING
        _speaker.value = isVideo

        scope.launch {
            try {
                val eng = createEngine(context)
                eng.createLocalMedia(isVideo)
                _videoEnabled.value = isVideo
                val offer = eng.createOffer()
                eng.setLocal(offer)
                SocketClient.send(
                    "call.invite",
                    "to" to peerId,
                    "type" to type,
                    "conversationId" to (conversationId ?: ""),
                    "sdp" to JSONObject().apply {
                        put("sdp", offer.description)
                        put("type", offer.type.canonicalForm())
                    },
                )
                CallService.start(context, _call.value, CallState.CALLING)
                // ring timeout: 45s like the server side
                delay(45_000)
                if (_state.value == CallState.CALLING || _state.value == CallState.RINGING) end(reason = "timeout")
            } catch (t: Throwable) {
                end(reason = "failed")
            }
        }
    }

    /* ------------------------------- incoming -------------------------------- */

    fun accept(context: Context) {
        val invite = pendingIncoming ?: return
        val isVideo = invite.optString("type") == "video"
        if (!hasPermissions(context, isVideo)) {
            decline()
            return
        }
        val from = invite.optJSONObject("from")
        _call.value = ActiveCall(
            callId = invite.optString("callId"),
            peerId = from?.optString("id").orEmpty(),
            peer = parseUser(from),
            type = invite.optString("type", "audio"),
            outgoing = false,
            conversationId = invite.optString("conversationId").ifBlank { null },
        )
        _state.value = CallState.CONNECTING
        _speaker.value = isVideo

        scope.launch {
            try {
                val eng = createEngine(context)
                eng.createLocalMedia(isVideo)
                _videoEnabled.value = isVideo
                val sdpJson = invite.optJSONObject("sdp") ?: invite.optJSONObject("offer") ?: return@launch
                eng.setRemote(
                    SessionDescription(
                        SessionDescription.Type.fromCanonicalForm(sdpJson.optString("type", "offer")),
                        sdpJson.optString("sdp"),
                    )
                )
                val answer = eng.createAnswer()
                eng.setLocal(answer)
                SocketClient.send(
                    "call.answer",
                    "callId" to invite.optString("callId"),
                    "to" to _call.value?.peerId,
                    "sdp" to JSONObject().apply {
                        put("sdp", answer.description)
                        put("type", answer.type.canonicalForm())
                    },
                )
                CallService.start(context, _call.value, CallState.CONNECTING)
                connectStartedAt = System.currentTimeMillis()
                pendingIncoming = null
            } catch (t: Throwable) {
                end(reason = "failed")
            }
        }
    }

    fun decline() {
        val invite = pendingIncoming ?: return
        SocketClient.send("call.decline", "callId" to invite.optString("callId"), "to" to invite.optString("from"))
        pendingIncoming = null
        reset()
        CallService.stop(appContext ?: return)
    }

    fun end(reason: String = "ended") {
        val active = _call.value
        val duration = if (connectStartedAt > 0) System.currentTimeMillis() - connectStartedAt else 0L
        if (active != null && active.callId.isNotBlank()) {
            SocketClient.send(
                "call.end",
                "callId" to active.callId,
                "to" to active.peerId,
                "reason" to reason,
                "durationMs" to duration,
                "quality" to JSONObject().apply {
                    put("score", _stats.value.score)
                    put("level", _stats.value.level)
                    put("rtt", _stats.value.rttMs)
                    put("loss", _stats.value.lossPercent)
                }.toString(),
            )
        }
        reset()
        CallService.stop(appContext ?: return)
    }

    /* -------------------------------- controls -------------------------------- */

    fun toggleMute() {
        val next = !_muted.value
        _muted.value = next
        engine?.setMuted(next)
    }

    fun toggleSpeaker(context: Context) {
        val next = !_speaker.value
        _speaker.value = next
        CallService.setSpeaker(context, next)
    }

    fun toggleVideo() {
        val next = !_videoEnabled.value
        _videoEnabled.value = next
        engine?.setVideoEnabled(next)
        _call.value?.let { call ->
            if (call.callId.isNotBlank()) {
                SocketClient.send(
                    "call.media",
                    "callId" to call.callId,
                    "to" to call.peerId,
                    "video" to next,
                    "reason" to "user",
                )
            }
        }
    }

    fun switchCamera() = engine?.switchCamera()

    /* ------------------------------- internal --------------------------------- */

    private fun createEngine(context: Context): WebrtcEngine {
        engine?.dispose()
        val ice = Repository.ice.value.ifEmpty {
            listOf(IceServer(listOf("stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302")))
        }
        val startLevel = when (Prefs.quality) {
            "saver" -> 0
            "hd" -> 3
            else -> if (NetworkMonitor.info.value.slow) 0 else 1
        }
        val eng = WebrtcEngine(
            context = context,
            iceServers = ice,
            startLevel = startLevel,
            autoQuality = Prefs.autoQuality,
            dataSaver = Prefs.dataSaver || Prefs.quality == "saver",
            audioOnlyFallback = Prefs.audioOnlyFallback,
            listener = engineListener,
        )
        eng.init()
        engine = eng
        return eng
    }

    private val engineListener = object : EngineListener {
        override fun onLocalVideo(track: VideoTrack) {
            _localVideo.value = track
        }
        override fun onRemoteVideo(track: VideoTrack) {
            _remoteVideo.value = track
        }
        override fun onIceCandidate(candidate: JSONObject) {
            val callId = _call.value?.callId.orEmpty()
            SocketClient.send(
                "call.ice",
                "callId" to callId,
                "to" to _call.value?.peerId,
                "candidate" to candidate,
            )
        }
        override fun onState(state: PeerConnection.IceConnectionState, pcState: PeerConnection.PeerConnectionState?) {
            when (pcState ?: mapIce(state)) {
                PeerConnection.PeerConnectionState.CONNECTED -> {
                    if (_state.value != CallState.CONNECTED) {
                        connectStartedAt = System.currentTimeMillis()
                        _state.value = CallState.CONNECTED
                    }
                }
                PeerConnection.PeerConnectionState.CONNECTING -> if (_state.value != CallState.CONNECTED) _state.value = CallState.CONNECTING
                PeerConnection.PeerConnectionState.DISCONNECTED -> _state.value = CallState.RECONNECTING
                PeerConnection.PeerConnectionState.FAILED -> _state.value = CallState.RECONNECTING
                else -> Unit
            }
        }
        override fun onStats(stats: CallStats) {
            _stats.value = stats
        }
        override fun onNotice(notice: Notice, extra: String) {
            _notices.tryEmit(notice to extra)
        }
    }

    private fun mapIce(state: PeerConnection.IceConnectionState): PeerConnection.PeerConnectionState? = when (state) {
        PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED ->
            PeerConnection.PeerConnectionState.CONNECTED
        PeerConnection.IceConnectionState.CHECKING -> PeerConnection.PeerConnectionState.CONNECTING
        PeerConnection.IceConnectionState.DISCONNECTED -> PeerConnection.PeerConnectionState.DISCONNECTED
        PeerConnection.IceConnectionState.FAILED -> PeerConnection.PeerConnectionState.FAILED
        PeerConnection.IceConnectionState.CLOSED -> PeerConnection.PeerConnectionState.CLOSED
        else -> null
    }

    private fun onFrame(frame: JSONObject) {
        when (frame.optString("t")) {
            "call.incoming" -> {
                if (_state.value != CallState.IDLE) {
                    SocketClient.send(
                        "call.busy",
                        "callId" to frame.optString("callId"),
                        "to" to parseUser(frame.optJSONObject("from"))?.id,
                    )
                    return
                }
                pendingIncoming = frame
                val from = parseUser(frame.optJSONObject("from"))
                _call.value = ActiveCall(
                    callId = frame.optString("callId"),
                    peerId = from?.id.orEmpty(),
                    peer = from,
                    type = frame.optString("type", "audio"),
                    outgoing = false,
                    conversationId = frame.optString("conversationId").ifBlank { null },
                )
                _state.value = CallState.RINGING
                appContext?.let { CallService.start(it, _call.value, CallState.RINGING) }
            }
            "call.ringing" -> {
                val callId = frame.optString("callId")
                if (callId.isNotBlank()) {
                    _call.value = _call.value?.copy(callId = callId)
                    appContext?.let { CallService.start(it, _call.value, CallState.RINGING) }
                    if (_state.value == CallState.CALLING) _state.value = CallState.RINGING
                }
            }
            "call.answer" -> {
                val sdp = frame.optJSONObject("sdp") ?: frame.optJSONObject("answer") ?: return
                scope.launch {
                    runCatching {
                        engine?.setRemote(
                            SessionDescription(
                                SessionDescription.Type.fromCanonicalForm(sdp.optString("type", "answer")),
                                sdp.optString("sdp"),
                            )
                        )
                        connectStartedAt = System.currentTimeMillis()
                        _state.value = CallState.CONNECTING
                    }
                }
            }
            "call.ice" -> {
                val candidate = frame.optJSONObject("candidate") ?: return
                engine?.addIceCandidate(candidate)
            }
            "call.restart" -> {
                val sdp = frame.optJSONObject("sdp") ?: return
                scope.launch {
                    runCatching {
                        val eng = engine ?: return@runCatching
                        if (eng.localDescription()?.type == SessionDescription.Type.OFFER) return@runCatching
                        eng.setRemote(
                            SessionDescription(
                                SessionDescription.Type.fromCanonicalForm(sdp.optString("type", "offer")),
                                sdp.optString("sdp"),
                            )
                        )
                        val answer = eng.createAnswer()
                        eng.setLocal(answer)
                        SocketClient.send(
                            "call.ice",
                            "callId" to _call.value?.callId,
                            "to" to _call.value?.peerId,
                            "restart" to true,
                            "sdp" to JSONObject().apply {
                                put("sdp", answer.description)
                                put("type", answer.type.canonicalForm())
                            },
                        )
                    }
                }
            }
            "call.decline" -> {
                if (frame.optString("callId") == _call.value?.callId) {
                    _state.value = CallState.ENDED
                    reset()
                    CallService.stop(appContext ?: return)
                }
            }
            "call.busy" -> {
                if (frame.optString("callId") == _call.value?.callId) {
                    _notices.tryEmit(Notice.FAILED to "busy")
                    reset()
                    CallService.stop(appContext ?: return)
                }
            }
            "call.end" -> {
                if (frame.optString("callId") == _call.value?.callId || frame.optString("callId").isBlank()) {
                    if (_state.value == CallState.RINGING) {
                        _call.value?.peer?.let { appContext?.let { ctx -> io.masingar.chat.util.Notify.missedCall(ctx, it, _call.value?.type ?: "audio") } }
                    }
                    _state.value = CallState.ENDED
                    reset()
                    CallService.stop(appContext ?: return)
                }
            }
            "call.media" -> {
                if (frame.optString("callId") == _call.value?.callId) {
                    _remoteVideoEnabled.value = frame.optBoolean("video", true)
                }
            }
            else -> Unit
        }
    }

    private fun reset() {
        scope.launch {
            engine?.dispose()
            engine = null
            _localVideo.value = null
            _remoteVideo.value = null
            _remoteVideoEnabled.value = true
            _muted.value = false
            _videoEnabled.value = true
            _stats.value = CallStats()
            connectStartedAt = 0L
            delay(600)
            _state.value = CallState.IDLE
            _call.value = null
        }
    }

    private fun findUser(id: String): User? {
        Repository.conversations.value.forEach { conv ->
            conv.members.firstOrNull { it.id == id }?.let { return it }
        }
        Repository.contacts.value.forEach { c ->
            if (c.user?.id == id) return c.user
        }
        return null
    }

    /** Shared EGL context used by the Compose video renderers. */
    fun eglContext(): org.webrtc.EglBase.Context? = engine?.eglBase?.eglBaseContext

    fun hasPermissions(context: Context, video: Boolean): Boolean {
        val audio = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val cam = !video || ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        return audio && cam
    }
}
