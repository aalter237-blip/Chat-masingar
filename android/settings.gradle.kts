pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // WebRTC (io.getstream:stream-webrtc-android) is resolved from Maven
        // Central; JitPack is kept as a safety net for forks hosted there.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "Masingar"
include(":app")
