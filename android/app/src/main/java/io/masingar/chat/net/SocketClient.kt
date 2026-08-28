package io.masingar.chat.net

import io.masingar.chat.data.Prefs
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
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Persistent WebSocket to /ws.
 *
 * • automatic reconnect with exponential backoff
 * • heart beat (application level ping every 25s)
 * • frames are published on a SharedFlow so any screen can listen
 */
object SocketClient {

    enum class Conn { IDLE, CONNECTING, CONNECTED, RECONNECTING, OFFLINE }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var socket: WebSocket? = null
    private val running = AtomicBoolean(false)
    private var attempt = 0

    private val _frames = MutableSharedFlow<JSONObject>(replay = 0, extraBufferCapacity = 128)
    val frames = _frames.asSharedFlow()

    private val _state = MutableStateFlow(Conn.IDLE)
    val state: StateFlow<Conn> = _state.asStateFlow()

    private val outbox = java.util.concurrent.ConcurrentLinkedQueue<String>()

    fun start() {
        if (running.getAndSet(true)) {
            socket?.let { if (Prefs.isLoggedIn) return }
        }
        scope.launch { connectLoop() }
    }

    fun stop() {
        running.set(false)
        socket?.close(1000, "bye")
        socket = null
        _state.value = Conn.IDLE
    }

    /** Force a reconnect (used after login/logout or a network change). */
    fun reconnect() {
        socket?.cancel()
        socket = null
        attempt = 0
        if (!running.getAndSet(true)) scope.launch { connectLoop() }
    }

    private suspend fun connectLoop() {
        while (running.get()) {
            if (!Prefs.isLoggedIn) {
                _state.value = Conn.OFFLINE
                delay(3000)
                continue
            }
            _state.value = if (attempt == 0) Conn.CONNECTING else Conn.RECONNECTING
            try {
                val url = Http.base().replacePrefix("http", "ws") + "/ws?token=" + Prefs.token
                val request = Request.Builder().url(url).build()
                val connected = java.util.concurrent.CountDownLatch(1)
                socket = client.newWebSocket(request, object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        attempt = 0
                        _state.value = Conn.CONNECTED
                        connected.countDown()
                        // flush anything that was queued while offline
                        while (true) outbox.poll()?.let { webSocket.send(it) } ?: break
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                        _frames.tryEmit(json)
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        connected.countDown()
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        connected.countDown()
                    }
                })
                connected.await()
            } catch (t: Throwable) {
                /* fall through to the backoff below */
            }
            val delayMs = (1000L * (1L shl attempt.coerceAtMost(5)))
            attempt = (attempt + 1).coerceAtMost(6)
            _state.value = Conn.RECONNECTING
            delay(delayMs)
        }
    }

    fun send(obj: JSONObject) {
        val text = obj.toString()
        val ws = socket
        if (ws != null) {
            if (!ws.send(text)) outbox.offer(text)
        } else {
            outbox.offer(text)
        }
    }

    fun send(type: String, vararg pairs: Pair<String, Any?>) {
        val json = JSONObject().apply { put("t", type) }
        for ((k, v) in pairs) {
            when (v) {
                null -> json.put(k, JSONObject.NULL)
                is String -> json.put(k, v)
                is Boolean -> json.put(k, v)
                is Int -> json.put(k, v)
                is Long -> json.put(k, v)
                is Double -> json.put(k, v)
                is JSONObject -> json.put(k, v)
                else -> json.put(k, v.toString())
            }
        }
        send(json)
    }

    /** Heartbeat keeps NAT/2G sessions alive and detects dead links early. */
    fun startHeartbeat() {
        scope.launch {
            while (running.get()) {
                delay(25_000)
                if (state.value == Conn.CONNECTED) send("ping")
            }
        }
    }

    private fun String.replacePrefix(from: String, to: String): String =
        if (startsWith(from)) to + removePrefix(from) else this
}
