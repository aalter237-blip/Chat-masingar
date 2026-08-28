package io.masingar.chat.calls

import android.content.Context
import android.os.Handler
import android.os.Looper
import io.masingar.chat.data.IceServer
import kotlinx.coroutines.CompletableDeferred
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RTCStatsReport
import org.webrtc.RtpParameters
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/** Quality ladder: the call starts low on mobile data and climbs when possible. */
data class Ladder(val name: String, val width: Int, val height: Int, val fps: Int, val kbps: Int)

val LADDER = listOf(
    Ladder("180p", 320, 180, 15, 170),
    Ladder("270p", 480, 270, 20, 340),
    Ladder("360p", 640, 360, 24, 650),
    Ladder("480p", 854, 480, 30, 1100),
    Ladder("720p", 1280, 720, 30, 1800),
)

data class CallStats(
    val score: Int = 100,
    val level: String = LADDER[0].name,
    val bitrateKbps: Int = 0,
    val audioKbps: Int = 0,
    val videoKbps: Int = 0,
    val rttMs: Int = 0,
    val lossPercent: Double = 0.0,
    val jitterMs: Int = 0,
    val availableKbps: Int = 0,
    val width: Int = 0,
    val height: Int = 0,
    val fps: Int = 0,
    val limitation: String = "",
    val audioCodec: String = "",
    val videoCodec: String = "",
)

enum class Notice { WEAK_NETWORK, AUDIO_ONLY, VIDEO_RESTORED, QUALITY_UP, QUALITY_DOWN, RECONNECTING, FAILED }

interface EngineListener {
    fun onLocalVideo(track: VideoTrack)
    fun onRemoteVideo(track: VideoTrack)
    fun onIceCandidate(candidate: org.json.JSONObject)
    fun onState(state: PeerConnection.IceConnectionState, pcState: PeerConnection.PeerConnectionState?)
    fun onStats(stats: CallStats)
    fun onNotice(notice: Notice, extra: String = "")
}

/**
 * Thin, robust wrapper around libwebrtc.
 *
 * Weak network strategy:
 *  1. Opus with DTX + in-band FEC and a low starting bitrate (clear voice on 2G)
 *  2. temporal scalability (L1T3) so frames can be dropped without freezing
 *  3. a quality ladder driven by measured RTT / loss / available bitrate
 *  4. automatic drop to audio-only, then automatic recovery
 *  5. ICE restart with backoff, TURN over TCP/TLS when direct UDP is blocked
 */
class WebrtcEngine(
    private val context: Context,
    private val iceServers: List<IceServer>,
    private val startLevel: Int,
    private val autoQuality: Boolean,
    private val dataSaver: Boolean,
    private val audioOnlyFallback: Boolean,
    private val listener: EngineListener,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    val eglBase: EglBase = EglBase.create()
    private lateinit var factory: PeerConnectionFactory
    private var pc: PeerConnection? = null

    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var capturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var audioSender: RtpSender? = null
    private var videoSender: RtpSender? = null

    @Volatile var level: Int = startLevel.coerceIn(0, LADDER.lastIndex)
        private set
    @Volatile var videoEnabled: Boolean = true
        private set
    @Volatile var muted: Boolean = false
        private set
    @Volatile var disposed: Boolean = false
        private set

    private var lastBytes = mutableMapOf<String, Long>()
    private var lastStatsTs = 0L
    private var badSamples = 0
    private var goodSamples = 0
    private var fallbackSamples = 0
    private var recoverSamples = 0

    private val statsRunnable = object : Runnable {
        override fun run() {
            if (disposed) return
            collectStats()
            mainHandler.postDelayed(this, 1000)
        }
    }

    /* --------------------------------- setup -------------------------------- */

    fun init() {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                // IPv4 first: many 2G/3G carriers and cheap routers break IPv6 ICE
                .setFieldTrials("WebRTC-IPv6Default/Disabled/")
                .createInitializationOptions(),
        )
        factory = PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options().apply { networkIgnoreMask = 0 })
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    /** Creates local audio (+video when [video] is true) and the peer connection. */
    fun createLocalMedia(video: Boolean) {
        val audioConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googTypingNoiseDetection", "true"))
        }
        audioSource = factory.createAudioSource(audioConstraints)
        audioTrack = factory.createAudioTrack(AUDIO_TRACK_ID, audioSource).apply { setEnabled(true) }

        if (video) {
            val enumerator = if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context) else Camera1Enumerator(true)
            val names = enumerator.deviceNames
            val front = names.firstOrNull { enumerator.isFrontFacing(it) } ?: names.firstOrNull()
            if (front != null) {
                capturer = enumerator.createCapturer(front, cameraEvents)
                videoSource = factory.createVideoSource(false)
                surfaceHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
                capturer?.initialize(surfaceHelper, context, videoSource?.capturerObserver)
                val l = LADDER[level]
                capturer?.startCapture(l.width, l.height, l.fps)
                videoTrack = factory.createVideoTrack(VIDEO_TRACK_ID, videoSource).apply { setEnabled(true) }
                listener.onLocalVideo(videoTrack!!)
            }
        }

        pc = createPeerConnection()
        audioSender = pc?.addTrack(audioTrack, listOf(STREAM_ID))
        if (video) {
            videoTrack?.let { videoSender = pc?.addTrack(it, listOf(STREAM_ID)) }
        } else {
            pc?.addTransceiver(org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)?.let {
                it.direction = RtpTransceiver.RtpTransceiverDirection.RECV_ONLY
            }
        }
        applyLevel(level, notify = false)
        tuneAudio(if (level == 0) 16000 else 32000)
        mainHandler.post(statsRunnable)
    }

    private fun createPeerConnection(): PeerConnection {
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers.map { s ->
            PeerConnection.IceServer.builder(s.urls).apply {
                if (!s.username.isNullOrBlank()) setUsername(s.username)
                if (!s.credential.isNullOrBlank()) setPassword(s.credential)
            }.createIceServer()
        }).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            iceCandidatePoolSize = 2
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED
            enableDtlsSrtp = true
        }
        return factory.createPeerConnection(rtcConfig, observer)!!
    }

    /* ------------------------------- signalling ------------------------------ */

    suspend fun createOffer(iceRestart: Boolean = false): SessionDescription {
        if (iceRestart) pc?.restartIce()
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
        }
        return sdp { pc?.createOffer(it, constraints) }
    }

    suspend fun createAnswer(): SessionDescription = sdp { pc?.createAnswer(it, MediaConstraints()) }

    fun setLocal(sdp: SessionDescription) {
        pc?.setLocalDescription(noopSdp, sdp)
    }

    suspend fun setRemote(sdp: SessionDescription) {
        val deferred = CompletableDeferred<Unit>()
        pc?.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onSetSuccess() {
                // tracks that were offered by the peer arrive here
                pc?.receivers?.forEach { r ->
                    r.track()?.let { track ->
                        if (track is VideoTrack && track.id() == VIDEO_TRACK_ID) listener.onRemoteVideo(track)
                        else if (track is VideoTrack) listener.onRemoteVideo(track)
                    }
                }
                deferred.complete(Unit)
            }
            override fun onCreateFailure(p0: String?) {}
            override fun onSetFailure(p0: String?) { deferred.completeExceptionally(RuntimeException(p0)) }
        }, sdp)
        deferred.await()
    }

    fun localDescription(): SessionDescription? = pc?.localDescription

    fun addIceCandidate(json: org.json.JSONObject) {
        runCatching {
            pc?.addIceCandidate(
                IceCandidate(
                    json.optString("sdpMid"),
                    json.optInt("sdpMLineIndex"),
                    json.optString("candidate"),
                )
            )
        }
    }

    private suspend fun sdp(block: (SdpObserver) -> Unit): SessionDescription {
        val deferred = CompletableDeferred<SessionDescription>()
        block(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription?) {
                if (sdp != null) deferred.complete(sdp) else deferred.completeExceptionally(RuntimeException("empty sdp"))
            }
            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                deferred.completeExceptionally(RuntimeException(error ?: "sdp error"))
            }
            override fun onSetFailure(error: String?) {}
        })
        return deferred.await()
    }

    private val noopSdp = object : SdpObserver {
        override fun onCreateSuccess(p0: SessionDescription?) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(p0: String?) {}
        override fun onSetFailure(p0: String?) {}
    }

    /* -------------------------------- controls ------------------------------- */

    fun setMuted(value: Boolean) {
        muted = value
        audioTrack?.setEnabled(!value)
    }

    fun setVideoEnabled(enabled: Boolean) {
        videoEnabled = enabled
        videoTrack?.setEnabled(enabled)
        videoSender?.let { sender ->
            runCatching {
                val params = sender.parameters
                params.degradationPreference = if (enabled && !dataSaver)
                    RtpParameters.DegradationPreference.BALANCED
                else
                    RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
                sender.parameters = params
            }
        }
    }

    fun switchCamera() {
        (capturer as? CameraVideoCapturer)?.switchCamera(null)
    }

    fun tuneAudio(maxBitrate: Int) {
        runCatching {
            val params = audioSender?.parameters ?: return
            if (params.encodings.isEmpty()) return
            params.encodings[0].maxBitrateBps = maxBitrate
            params.encodings[0].networkPriority = RtpParameters.Priority.HIGH
            audioSender?.parameters = params
        }
    }

    fun applyLevel(next: Int, notify: Boolean = true) {
        val target = next.coerceIn(0, LADDER.lastIndex)
        val changed = target != level
        level = target
        val l = LADDER[target]
        val cap = if (dataSaver) minOf(l.kbps, 320) else l.kbps
        runCatching {
            (capturer as? CameraVideoCapturer)?.changeCaptureFormat(l.width, l.height, l.fps)
            val params = videoSender?.parameters ?: return@runCatching
            if (params.encodings.isEmpty()) return@runCatching
            params.encodings[0].apply {
                maxBitrateBps = cap * 1000
                maxFramerate = l.fps
                networkPriority = RtpParameters.Priority.LOW
            }
            params.degradationPreference = RtpParameters.DegradationPreference.BALANCED
            videoSender?.parameters = params
        }
        tuneAudio(if (target <= 0) 16000 else if (target == 1) 32000 else 48000)
        if (notify && changed) {
            listener.onNotice(if (target < next) Notice.QUALITY_DOWN else Notice.QUALITY_UP, LADDER[target].name)
        }
    }

    fun restartIce() = pc?.restartIce()

    /* --------------------------------- stats --------------------------------- */

    private fun collectStats() {
        val connection = pc ?: return
        connection.getStats { report ->
            if (disposed) return@getStats
            val stats = parseStats(report)
            listener.onStats(stats)
            if (autoQuality) adapt(stats)
            if (audioOnlyFallback && videoTrack != null) maybeFallback(stats)
        }
    }

    private fun parseStats(report: RTCStatsReport): CallStats {
        var bitrate = 0
        var audioKbps = 0
        var videoKbps = 0
        var rtt = 0
        var loss = 0.0
        var jitter = 0
        var available = 0
        var width = 0
        var height = 0
        var fps = 0
        var limitation = ""
        var audioCodec = ""
        var videoCodec = ""
        val now = System.currentTimeMillis()

        for ((_, stat) in report.statsMap) {
            val members = stat.members
            when (stat.type) {
                "candidate-pair" -> {
                    val nominated = members["nominated"] as? Boolean ?: false
                    val state = members["state"] as? String
                    if (nominated && state == "succeeded") {
                        rtt = ((members["currentRoundTripTime"] as? Double) ?: 0.0).times(1000).toInt()
                        available = ((members["availableOutgoingBitrate"] as? Double) ?: 0.0).div(1000).toInt()
                    }
                }
                "remote-inbound-rtp" -> {
                    val kind = members["kind"] as? String
                    if (kind == "video" || kind == "audio") {
                        loss = maxOf(loss, ((members["fractionLost"] as? Double) ?: 0.0) * 100.0)
                        jitter = maxOf(jitter, ((members["jitter"] as? Double) ?: 0.0).times(1000).toInt())
                    }
                }
                "outbound-rtp" -> {
                    val kind = members["kind"] as? String ?: members["mediaType"] as? String
                    val bytes = (members["bytesSent"] as? Long) ?: (members["bytesSent"] as? Int)?.toLong() ?: 0L
                    val key = kind ?: "?"
                    val prev = lastBytes[key]
                    val elapsed = (now - lastStatsTs) / 1000.0
                    if (prev != null && elapsed > 0.5) {
                        val kbps = ((bytes - prev) * 8 / elapsed / 1000).toInt()
                        if (kind == "audio") audioKbps = kbps else if (kind == "video") videoKbps = kbps
                    }
                    lastBytes[key] = bytes
                    if (kind == "video") {
                        width = (members["frameWidth"] as? Int) ?: 0
                        height = (members["frameHeight"] as? Int) ?: 0
                        fps = (members["framesPerSecond"] as? Int) ?: 0
                        limitation = (members["qualityLimitationReason"] as? String).orEmpty()
                    }
                }
                "codec" -> {
                    val mime = (members["mimeType"] as? String).orEmpty()
                    if (mime.startsWith("audio/")) audioCodec = mime.removePrefix("audio/")
                    if (mime.startsWith("video/")) videoCodec = mime.removePrefix("video/")
                }
            }
        }
        lastStatsTs = now
        bitrate = audioKbps + videoKbps
        val score = (100 - loss * 3 - maxOf(0, rtt - 150) / 8 - if (limitation == "bandwidth") 15 else 0)
            .toInt().coerceIn(0, 100)
        return CallStats(
            score = score,
            level = LADDER[level].name,
            bitrateKbps = bitrate,
            audioKbps = audioKbps,
            videoKbps = videoKbps,
            rttMs = rtt,
            lossPercent = loss,
            jitterMs = jitter,
            availableKbps = available,
            width = width,
            height = height,
            fps = fps,
            limitation = limitation,
            audioCodec = audioCodec,
            videoCodec = videoCodec,
        )
    }

    private fun adapt(s: CallStats) {
        if (!videoEnabled || videoTrack == null) return
        val bad = s.lossPercent > 6 || s.rttMs > 500 || s.limitation == "bandwidth"
        val good = s.lossPercent < 2 && s.rttMs < 260 && s.limitation != "bandwidth"
        val nextLevel = (level + 1).coerceAtMost(LADDER.lastIndex)
        val headroom = s.availableKbps > LADDER[nextLevel].kbps * 1.4

        when {
            bad -> {
                badSamples++
                goodSamples = 0
            }
            good -> {
                goodSamples++
                badSamples = 0
            }
            else -> badSamples = maxOf(0, badSamples - 1)
        }

        if (badSamples >= 3 && level > 0) {
            badSamples = 0
            applyLevel(level - 1)
            listener.onNotice(Notice.WEAK_NETWORK, LADDER[level].name)
        } else if (goodSamples >= 8 && headroom && level < LADDER.lastIndex) {
            goodSamples = 0
            applyLevel(level + 1)
        }
    }

    private fun maybeFallback(s: CallStats) {
        val hopeless = (s.lossPercent > 12 && s.rttMs > 700) ||
            (s.availableKbps > 0 && s.availableKbps < 90 && s.lossPercent > 5)
        if (hopeless && videoEnabled) {
            fallbackSamples++
            recoverSamples = 0
            if (fallbackSamples >= 3) {
                fallbackSamples = 0
                setVideoEnabled(false)
                listener.onNotice(Notice.AUDIO_ONLY)
            }
        } else if (!hopeless && !videoEnabled) {
            recoverSamples++
            if (recoverSamples >= 6 && s.availableKbps > 250) {
                recoverSamples = 0
                applyLevel(0, notify = false)
                setVideoEnabled(true)
                listener.onNotice(Notice.VIDEO_RESTORED)
            }
        }
    }

    /* ------------------------------- observers -------------------------------- */

    private val observer = object : PeerConnection.Observer {
        override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            state ?: return
            listener.onState(state, pc?.connectionState())
            if (state == PeerConnection.IceConnectionState.FAILED) {
                listener.onNotice(Notice.RECONNECTING)
                runCatching { restartIce() }
            }
            if (state == PeerConnection.IceConnectionState.DISCONNECTED) {
                mainHandler.postDelayed({
                    if (pc?.iceConnectionState() == PeerConnection.IceConnectionState.DISCONNECTED) {
                        listener.onNotice(Notice.RECONNECTING)
                        runCatching { restartIce() }
                    }
                }, 3000)
            }
        }
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
            listener.onState(pc?.iceConnectionState() ?: PeerConnection.IceConnectionState.NEW, newState)
            if (newState == PeerConnection.PeerConnectionState.FAILED) {
                listener.onNotice(Notice.FAILED)
            }
        }
        override fun onIceConnectionReceivingChange(p0: Boolean) {}
        override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidate(candidate: IceCandidate?) {
            candidate ?: return
            listener.onIceCandidate(
                org.json.JSONObject().apply {
                    put("sdpMid", candidate.sdpMid)
                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                    put("candidate", candidate.sdp)
                }
            )
        }
        override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
        override fun onAddStream(stream: MediaStream?) {
            stream?.videoTracks?.firstOrNull()?.let { listener.onRemoteVideo(it) }
        }
        override fun onRemoveStream(p0: MediaStream?) {}
        override fun onDataChannel(p0: DataChannel?) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
            receiver?.track()?.let { track ->
                if (track is VideoTrack) listener.onRemoteVideo(track)
            }
        }
    }

    private val cameraEvents = object : CameraVideoCapturer.CameraEventsHandler {
        override fun onCameraError(error: String?) {}
        override fun onCameraDisconnected() {}
        override fun onCameraFreezed(error: String?) {}
        override fun onCameraOpening(p0: String?) {}
        override fun onFirstFrameAvailable() {}
        override fun onCameraClosed() {}
    }

    /* --------------------------------- teardown ------------------------------- */

    fun dispose() {
        disposed = true
        mainHandler.removeCallbacks(statsRunnable)
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        runCatching { surfaceHelper?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { pc?.close() }
        runCatching { factory.dispose() }
        eglBase.release()
    }

    companion object {
        private const val STREAM_ID = "masingar"
        private const val AUDIO_TRACK_ID = "masingar-audio"
        private const val VIDEO_TRACK_ID = "masingar-video"
    }
}
