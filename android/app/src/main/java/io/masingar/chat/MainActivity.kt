package io.masingar.chat

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * ماسنجر لايت — غلاف WebView مصغّر حول تطبيق الويب.
 *
 * كل شيء (واجهة، دردشة، منشورات) يعمل داخل الـ WebView ويتحدث فوراً من
 * السيرفر بدون تحديث التطبيق، وحجم الـ APK يبقى بضع مئات الكيلوبايت.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var filePicker: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
                val serverHost = Uri.parse(BuildConfig.SERVER_URL).host ?: return false
                // روابط التطبيق تبقى داخلياً، وأي رابط خارجي يفتح في المتصفح
                return if (target.host == serverHost) false else {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
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

        setContentView(web)

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl(BuildConfig.SERVER_URL)
        }
    }

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
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        private const val PICK_IMAGE = 1001
    }
}
