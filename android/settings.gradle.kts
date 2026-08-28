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
        // WebRTC prebuilt binaries live in Google's Maven repository; the
        // entry below is a safety net for mirrors that host the same AAR.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "Masingar"
include(":app")
