package io.masingar.chat.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Brand = Color(0xFF00A884)
val BrandDark = Color(0xFF0B141A)
val BrandSurface = Color(0xFF111B21)
val BrandSurfaceVar = Color(0xFF1F2C33)
val BubbleOut = Color(0xFF005C4B)
val BubbleIn = Color(0xFF202C33)
val Muted = Color(0xFF8696A0)
val Danger = Color(0xFFEA4335)

private val DarkColors = darkColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    primaryContainer = BubbleOut,
    secondary = Color(0xFF25D366),
    background = BrandDark,
    surface = BrandSurface,
    surfaceVariant = BrandSurfaceVar,
    onBackground = Color(0xFFE9EDEF),
    onSurface = Color(0xFFE9EDEF),
    onSurfaceVariant = Muted,
    error = Danger,
)

private val LightColors = lightColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD9FDD3),
    secondary = Color(0xFF0F7A63),
    background = Color(0xFFF0F2F5),
    surface = Color.White,
    surfaceVariant = Color(0xFFF7F8FA),
    onBackground = Color(0xFF111B21),
    onSurface = Color(0xFF111B21),
    onSurfaceVariant = Color(0xFF667781),
    error = Danger,
)

@Composable
fun MasingarTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
