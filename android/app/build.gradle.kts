import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/* Values a developer can override in android/local.properties (never committed) */
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(key: String, default: String = ""): String = localProps.getProperty(key) ?: default

android {
    namespace = "io.masingar.chat"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.masingar.chat"
        // Android 8.0 (API 26) is the minimum supported platform
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        resourceConfigurations += setOf("ar", "en")

        buildConfigField("String", "SERVER_URL", "\"${prop("SERVER_URL", "https://chatmassage.bonto.run")}\"")
        buildConfigField("String", "DEFAULT_COUNTRY_CODE", "\"${prop("DEFAULT_COUNTRY_CODE", "967")}\"")
        // Firebase (optional): fill these to wake the device for incoming calls
        buildConfigField("String", "FCM_API_KEY", "\"${prop("FCM_API_KEY")}\"")
        buildConfigField("String", "FCM_APP_ID", "\"${prop("FCM_APP_ID")}\"")
        buildConfigField("String", "FCM_PROJECT_ID", "\"${prop("FCM_PROJECT_ID")}\"")
        buildConfigField("String", "FCM_SENDER_ID", "\"${prop("FCM_SENDER_ID")}\"")
    }

    signingConfigs {
        // Real signing only when a keystore is configured (see local.properties.example)
        create("release") {
            val ks = prop("KEYSTORE_FILE")
            if (ks.isNotBlank() && rootProject.file(ks).exists()) {
                storeFile = rootProject.file(ks)
                storePassword = prop("KEYSTORE_PASSWORD")
                keyAlias = prop("KEY_ALIAS")
                keyPassword = prop("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile != null }
                ?: signingConfigs.getByName("debug")
        }
    }

    // No ABI split: the build must produce exactly ONE apk per variant that
    // works on every Android 8+ device (all ABIs packaged inside it).

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = false
    }
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf("-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi", "-Xjvm-default=all")
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/DEPENDENCIES")
        }
        jniLibs {
            // WebRTC ships all ABIs in one AAR; keep them all so the single
            // APK runs on armv7 / arm64 / x86_64 devices
            keepDebugSymbols += "**/libjingle_peerconnection_so.so"
        }
    }
}

dependencies {
    // AndroidX
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    // Pin a modern Fragment: registerForActivityResult() requires Fragment >= 1.3.0,
    // and the transitive version resolved in CI triggered the lint error
    // InvalidFragmentVersionForActivityResult in lintVitalRelease.
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.core:core-splashscreen:1.0.1")

    // Compose
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    // Networking / images
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.6.0")

    // Phone number handling (E.164 for every country in the world)
    implementation("com.googlecode.libphonenumber:libphonenumber:8.13.52")

    // Real time media (voice + video).
    // The original `org.webrtc:google-webrtc` was only published to
    // Bintray/JCenter, which is shut down, so a build using it cannot resolve
    // its dependencies any more. Stream republishes an up to date build of the
    // very same library (same org.webrtc.* API) on Maven Central.
    implementation("io.getstream:stream-webrtc-android:1.3.10")

    // Push (optional, wakes the device for incoming calls)
    implementation("com.google.firebase:firebase-messaging:24.1.0")

    // Tests
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
