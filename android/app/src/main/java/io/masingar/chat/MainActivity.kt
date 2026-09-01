package io.masingar.chat

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * ماسنجر لايت — غلاف WebView مصغّر حول تطبيق الويب.
 *
 * عنوان السيرفر قابل للتغيير من داخل التطبيق نفسه (بدون إعادة بناء APK):
 * - عند أول تشغيل إذا كان العنوان الافتراضي خاصاً بالمحاكي تظهر نافذة الإدخال
 * - وعند فشل الاتصال تظهر شاشة عربية فيها «إعادة المحاولة» و«تغيير العنوان»
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var prefs: SharedPreferences
    private var filePicker: ValueCallback<Array<Uri>>? = null

    /** عنوان السيرفر الحالي: المحفوظ في الجهاز أو الافتراضي من البناء. */
    private fun serverUrl(): String {
        val base = prefs.getString(KEY_SERVER, null) ?: BuildConfig.SERVER_URL
        return base.trim().trimEnd('/')
    }

    private fun isLocalHost(url: String): Boolean {
        val host = runCatching { Uri.parse(url).host }.getOrNull() ?: return false
        return host == "10.0.2.2" || host == "127.0.0.1" || host == "localhost"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // حفظ الجلسة والتوكن
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString MasingarLite/${BuildConfig.VERSION_NAME}"
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = Uri.parse(request.url.toString())
                val serverHost = runCatching { Uri.parse(serverUrl()).host }.getOrNull() ?: return false
                // روابط التطبيق تبقى داخلياً، وأي رابط خارجي يفتح في المتصفح
                return if (target.host == serverHost) false else {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    true
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // أخطاء الصفحة الرئيسية فقط (وليس الصور والملفات الفرعية)
                if (request.isForMainFrame) showErrorScreen()
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            /* إذن الكاميرا والميكروفون لمكالمات WebRTC والتسجيل الصوتي */
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread {
                    request?.grant(request.resources)
                }
            }

            /* إذن مشاركة الموقع الجغرافي */
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            /* اختيار الصور لرفعها في المنشورات/الدردشة */
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePicker?.onReceiveValue(null)
                filePicker = callback
                val intent = params.createIntent().apply { type = "image/*" }
                return try {
                    startActivityForResult(Intent.createChooser(intent, getString(R.string.pick_image)), PICK_IMAGE)
                    true
                } catch (e: android.content.ActivityNotFoundException) {
                    filePicker = null
                    Toast.makeText(this@MainActivity, R.string.pick_image, Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        checkRuntimePermissions()

        setContentView(web)

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            val url = serverUrl()
            if (isLocalHost(url)) {
                // عنوان المحاكي على جهاز حقيقي لا يعمل — اسأل عن العنوان فوراً
                askServerUrl(firstLaunch = true)
            } else {
                web.loadUrl(url)
            }
        }
    }

    /* ------------------------- شاشة الخطأ العربية ------------------------- */

    private fun showErrorScreen() {
        val pad = (16 * resources.displayMetrics.density).toInt()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad * 3, pad, pad * 3)
        }
        val title = TextView(this).apply {
            text = "لا يمكن الوصول إلى السيرفر"
            textSize = 18f
            gravity = Gravity.CENTER
        }
        val msg = TextView(this).apply {
            text = "تأكد أن السيرفر يعمل وأن الجوال على نفس الشبكة، أو غيّر عنوان السيرفر.\n\nالعنوان الحالي:\n${serverUrl()}"
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, pad, 0, pad * 2)
        }
        val retry = Button(this).apply {
            text = "إعادة المحاولة"
            setOnClickListener {
                setContentView(web)
                web.reload()
            }
        }
        val change = Button(this).apply {
            text = "تغيير عنوان السيرفر"
            setOnClickListener { askServerUrl(firstLaunch = false) }
        }
        box.addView(title)
        box.addView(msg)
        box.addView(retry)
        box.addView(change)
        setContentView(box)
    }

    /* --------------------- إدخال/تغيير عنوان السيرفر --------------------- */

    private fun askServerUrl(firstLaunch: Boolean) {
        val input = EditText(this).apply {
            hint = "https://example.com"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(serverUrl())
            setTextAlignment(View.TEXT_ALIGNMENT_CENTER)
        }
        AlertDialog.Builder(this)
            .setTitle("عنوان سيرفر ماسنجر لايت")
            .setMessage("اكتب عنوان السيرفر الذي يتصل به التطبيق.\nمثال: https://chat.myfamily.com")
            .setView(input)
            .setPositiveButton("حفظ") { _, _ ->
                val u = input.text.toString().trim().trimEnd('/')
                if (u.startsWith("http://") || u.startsWith("https://")) {
                    prefs.edit().putString(KEY_SERVER, u).apply()
                    setContentView(web)
                    web.loadUrl(u)
                    Toast.makeText(this, "تم الحفظ ✓", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "العنوان يجب أن يبدأ بـ http:// أو https://", Toast.LENGTH_LONG).show()
                    if (firstLaunch) web.loadUrl(serverUrl())
                }
            }
            .setNegativeButton("إلغاء") { _, _ ->
                if (firstLaunch) web.loadUrl(serverUrl())
            }
            .show()
    }

    /* ------------------------------ دورة الحياة ------------------------------ */

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_IMAGE) {
            val results = when (resultCode) {
                RESULT_OK -> WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                else -> null
            }
            filePicker?.onReceiveValue(results)
            filePicker = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onPause() {
        if (this::web.isInitialized) web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (this::web.isInitialized) web.onResume()
    }

    override fun onDestroy() {
        if (this::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    private fun checkRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val needed = mutableListOf<String>()
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO)
            }
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.CAMERA)
            }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
            if (needed.isNotEmpty()) {
                requestPermissions(needed.toTypedArray(), 1002)
            }
        }
    }

    companion object {
        private const val PREFS = "masingar_cfg"
        private const val KEY_SERVER = "server_url"
        private const val PICK_IMAGE = 1001
    }
}
