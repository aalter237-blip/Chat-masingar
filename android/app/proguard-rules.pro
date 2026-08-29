# Masingar - keep rules

# WebRTC native bridge and its reflection based factories
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
-keepclasseswithmembers class org.webrtc.** { native <methods>; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.Nullable
-keepattributes Signature
-keepattributes *Annotation*
-keepclassmembers class **$WhenMappings { <fields>; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# libphonenumber resources
-keep class com.google.i18n.phonenumbers.** { *; }
-dontwarn com.google.i18n.phonenumbers.**

# Kotlin serialization free JSON (org.json is on device)
-keep class org.json.** { *; }

# Coroutines
-dontwarn kotlinx.coroutines.**

# Models are parsed from JSON with org.json only (no reflection)
-keep class io.masingar.chat.data.** { *; }
