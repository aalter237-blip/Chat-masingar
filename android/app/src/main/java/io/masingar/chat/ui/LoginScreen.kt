package io.masingar.chat.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.masingar.chat.R
import io.masingar.chat.data.Prefs
import io.masingar.chat.data.Repository
import io.masingar.chat.data.parseUser
import io.masingar.chat.net.Http
import io.masingar.chat.net.SocketClient
import io.masingar.chat.util.ContactsSync
import io.masingar.chat.util.Phone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun LoginScreen(onLoggedIn: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var country by remember { mutableStateOf(Phone.countryCode(context).toString()) }
    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var stage by remember { mutableStateOf("phone") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }

    suspend fun verify() = withContext(Dispatchers.IO) {
        val e164 = Phone.normalize("+$country$phone", Phone.deviceRegion(context))
        val res = Http.verifyOtp(e164, code.trim(), locale = java.util.Locale.getDefault().language)
        val user = parseUser(res.optJSONObject("user")) ?: error("bad response")
        Prefs.token = res.optString("accessToken")
        Prefs.refreshToken = res.optString("refreshToken")
        Prefs.me = user
        Repository.setMe(user)
        SocketClient.reconnect()
        SocketClient.startHeartbeat()
        Repository.refreshAll()
        if (ContactsSync.hasPermission(context)) {
            Repository.saveContacts(ContactsSync.sync(context))
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.login_sub),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))

        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = country,
                onValueChange = { if (it.length <= 4) country = it.filter(Char::isDigit) },
                label = { Text("+") },
                modifier = Modifier.width(96.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
            )
            Spacer(Modifier.width(8.dp))
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it.filter { c -> c.isDigit() } },
                label = { Text(stringResource(R.string.phone_hint)) },
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
            )
        }

        if (stage == "code") {
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = code,
                onValueChange = { if (it.length <= 6) code = it.filter(Char::isDigit) },
                label = { Text(stringResource(R.string.code_hint)) },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
            )
        }

        Spacer(Modifier.height(20.dp))

        Button(
            onClick = {
                error = null
                scope.launch {
                    loading = true
                    try {
                        val currentStage = stage
                        val otpResult = if (currentStage == "phone") {
                            withContext(Dispatchers.IO) {
                                val e164 = Phone.normalize("+$country$phone", Phone.deviceRegion(context))
                                Http.requestOtp(e164)
                            }
                        } else {
                            withContext(Dispatchers.IO) { verify() }
                            null
                        }
                        // Compose state must only be changed on the main thread. In
                        // particular, assigning `code` from the IO block used to
                        // crash the screen on demo servers that return devCode.
                        if (currentStage == "phone") {
                            val res = otpResult ?: error("empty OTP response")
                            val dev = res.optString("devCode")
                            info = when {
                                dev.isNotBlank() -> {
                                    code = dev
                                    "وضع تجريبي: كود التحقق $dev"
                                }
                                res.optBoolean("delivered", false) ->
                                    "تم إرسال كود التحقق برسالة SMS إلى رقمك"
                                else ->
                                    "تعذّر إرسال الرسالة الآن — أعد المحاولة بعد قليل"
                            }
                            stage = "code"
                        } else {
                            onLoggedIn()
                        }
                    } catch (t: Throwable) {
                        error = t.message
                    } finally {
                        loading = false
                    }
                }
            },
            enabled = !loading && phone.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (loading) CircularProgressIndicator(modifier = Modifier.height(20.dp), strokeWidth = 2.dp)
            else Text(if (stage == "phone") stringResource(R.string.send_code) else stringResource(R.string.verify))
        }

        if (stage == "code") {
            TextButton(onClick = {
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            Http.requestOtp(Phone.normalize("+$country$phone", Phone.deviceRegion(context)))
                        }
                    }
                }
            }) { Text(stringResource(R.string.resend_code)) }
        }

        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(text = it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        info?.let {
            Spacer(Modifier.height(12.dp))
            Surface(color = Color(0x22F9A825), shape = MaterialTheme.shapes.small) {
                Text(text = it, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
