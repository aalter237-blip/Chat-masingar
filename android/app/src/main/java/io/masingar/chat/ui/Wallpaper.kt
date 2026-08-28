package io.masingar.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.masingar.chat.data.WALLPAPERS
import io.masingar.chat.data.Wallpaper

/**
 * The wallpaper of a chat is shared: it lives on the server and every member
 * receives it live, so both people always see the same background.
 *
 * The value stored is the same CSS gradient the web client uses; here we pull
 * the colours out of it and rebuild an equivalent Compose brush.
 */
private val HEX = Regex("#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})")

fun cssColors(css: String): List<Color> {
    if (css.isBlank()) return emptyList()
    val colors = HEX.findAll(css).mapNotNull { match ->
        val hex = match.groupValues[1]
        runCatching {
            when (hex.length) {
                6 -> Color(("FF$hex").toULong(16) or 0xFF000000uL)
                8 -> Color(hex.toULong(16))
                else -> return@runCatching null
            }
        }.getOrNull()
    }.toList()
    return colors
}

/** Brush of a wallpaper, or null when the chat uses the plain background. */
fun wallpaperBrush(wallpaper: Wallpaper?): Brush? {
    val w = wallpaper ?: return null
    if (w.id == "none") return null
    val css = w.css.ifBlank { WALLPAPERS.firstOrNull { it.id == w.id }?.css.orEmpty() }
    val colors = cssColors(css)
    if (colors.isEmpty()) return null
    return when {
        colors.size == 1 -> Brush.verticalGradient(listOf(colors[0], colors[0]))
        css.startsWith("radial") -> Brush.radialGradient(colors)
        else -> Brush.verticalGradient(colors)
    }
}

/** Picker shown from the chat menu: one tap and both sides get the wallpaper. */
@Composable
fun WallpaperPicker(current: Wallpaper?, onPick: (Wallpaper) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
        Text(
            text = "خلفية الدردشة (تظهر لكلا الطرفين)",
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(WALLPAPERS) { wallpaper ->
                val selected = current?.id == wallpaper.id
                val brush = wallpaperBrush(wallpaper)
                Box(
                    modifier = Modifier
                        .height(64.dp)
                        .background(
                            brush = brush ?: Brush.verticalGradient(
                                listOf(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.surfaceVariant),
                            ),
                            shape = RoundedCornerShape(10.dp),
                        )
                        .then(
                            if (selected) Modifier.border(
                                2.dp,
                                MaterialTheme.colorScheme.primary,
                                RoundedCornerShape(10.dp),
                            ) else Modifier,
                        )
                        .clickable { onPick(wallpaper) },
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        color = Color.Black.copy(alpha = 0.35f),
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Text(
                            text = labelOf(wallpaper.id),
                            style = MaterialTheme.typography.labelMedium,
                            color = Color.White,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

fun labelOf(id: String): String = when (id) {
    "none" -> "بدون"
    "teal" -> "أخضر"
    "night" -> "ليلي"
    "sunset" -> "غروب"
    "sand" -> "رملي"
    "ocean" -> "محيط"
    "dots" -> "منقّط"
    else -> "مخصص"
}
