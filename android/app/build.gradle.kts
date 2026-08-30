import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
  ماسنجر لايت — تطبيق مصغّر: WebView واحد ولا مكتبات خارجية إطلاقاً
  (لا WebRTC ولا Firebase ولا Compose) لذلك حجم الـ APK بضع مئات الكيلوبايت فقط.
*/

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(key: String, default: String = ""): String = localProps.getProperty(key) ?: default

android {
    namespace = "io.masingar.chat"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.masingar.chat"
        minSdk = 24          // أندرويد 7.0 فما فوق
        targetSdk = 34
        versionCode = 3
        versionName = "2.0.0"

        // عنوان السيرفر — الافتراضي هو نشر Bonto، ويمكن تغييره داخل التطبيق
        // أو ضبطه في android/local.properties عند البناء المحلي
        buildConfigField("String", "SERVER_URL", "\"${prop("SERVER_URL", "https://chatmassage.bonto.run")}\"")
    }

    signingConfigs {
        // توقيع حقيقي اختياري: بدون ملف مفتاح يُوقَّع الإصدار بمفتاح التصحيح
        // (يكفي للتثبيت والاستخدام الشخصي داخل الدائرة).
        create("release") {
            val ks = prop("KEYSTORE_FILE")
            if (ks.isNotBlank()) {
                storeFile = rootProject.file(ks)
                storePassword = prop("KEYSTORE_PASSWORD")
                keyAlias = prop("KEY_ALIAS")
                keyPassword = prop("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false      // التطبيق صغير أصلاً — لا حاجة للتشويش
            isShrinkResources = false
            if (prop("KEYSTORE_FILE").isNotBlank()) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                signingConfig = signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true   // لقراءة SERVER_URL في MainActivity عبر BuildConfig
    }
}

// لا تبعيات على الإطلاق — فقط إطار أندرويد نفسه
dependencies { }
