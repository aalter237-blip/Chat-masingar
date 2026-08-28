package io.masingar.chat.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.telephony.TelephonyManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class NetInfo(
    val connected: Boolean = false,
    val wifi: Boolean = false,
    val cellular: Boolean = false,
    val metered: Boolean = false,
    val typeLabel: String = "",
    /** True for 2G/EDGE or 3G links: the app starts calls in "lean" mode there. */
    val slow: Boolean = false,
)

/**
 * Watches the active network so the call engine can pick the right starting
 * quality and the UI can warn the user when the link is weak.
 */
object NetworkMonitor {

    private val _info = MutableStateFlow(NetInfo())
    val info: StateFlow<NetInfo> = _info.asStateFlow()

    private var manager: ConnectivityManager? = null
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = refresh()
        override fun onLost(network: Network) = refresh()
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = refresh()
    }

    fun start(context: Context) {
        appContext = context.applicationContext
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        manager = cm
        runCatching { cm.unregisterNetworkCallback(callback) }
        cm.registerNetworkCallback(
            NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build(),
            callback,
        )
        refresh()
    }

    private fun refresh() {
        val cm = manager ?: return
        val network = cm.activeNetwork
        val caps = network?.let { cm.getNetworkCapabilities(it) }
        val connected = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        val wifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true ||
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true
        val cellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
        val metered = runCatching { cm.isActiveNetworkMetered }.getOrDefault(cellular)
        var slow = false
        var label = if (wifi) "Wi-Fi" else if (cellular) "Mobile data" else ""
        if (cellular) {
            val dataNetworkType = runCatching {
                val telephony = appContext?.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
                telephony?.dataNetworkType
            }.getOrNull()
            val (name, isSlow) = describeNetworkType(dataNetworkType)
            label = name
            slow = isSlow
        }
        _info.value = NetInfo(connected, wifi, cellular, metered, label, slow)
    }

    private fun describeNetworkType(type: Int?): Pair<String, Boolean> = when (type) {
        TelephonyManager.NETWORK_TYPE_GPRS,
        TelephonyManager.NETWORK_TYPE_EDGE,
        TelephonyManager.NETWORK_TYPE_CDMA,
        TelephonyManager.NETWORK_TYPE_1xRTT,
        TelephonyManager.NETWORK_TYPE_IDEN, -> "2G" to true
        TelephonyManager.NETWORK_TYPE_UMTS,
        TelephonyManager.NETWORK_TYPE_EVDO_0,
        TelephonyManager.NETWORK_TYPE_EVDO_A,
        TelephonyManager.NETWORK_TYPE_EVDO_B,
        TelephonyManager.NETWORK_TYPE_HSDPA,
        TelephonyManager.NETWORK_TYPE_HSUPA,
        TelephonyManager.NETWORK_TYPE_HSPA,
        TelephonyManager.NETWORK_TYPE_EHRPD,
        TelephonyManager.NETWORK_TYPE_HSPAP, -> "3G" to true
        TelephonyManager.NETWORK_TYPE_LTE -> "4G" to false
        TelephonyManager.NETWORK_TYPE_NR -> "5G" to false
        else -> "Mobile data" to false
    }

    /** Application context (safe to hold), set once in MasingarApp.onCreate. */
    var appContext: Context? = null
}
