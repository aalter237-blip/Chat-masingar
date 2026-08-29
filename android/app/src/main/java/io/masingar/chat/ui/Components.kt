package io.masingar.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import io.masingar.chat.data.User
import io.masingar.chat.net.Http
import io.masingar.chat.util.Format

@Composable
fun Avatar(user: User?, size: Dp = 48.dp, modifier: Modifier = Modifier) {
    val name = user?.name?.ifBlank { user.phone }.orEmpty()
    val url = user?.avatar.orEmpty()
    val seed = (user?.id ?: name).sumOf { it.code }
    val color = Color.hsv((seed % 360).toFloat(), 0.45f, 0.55f)
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(if (url.isBlank()) color else Color.Transparent),
        contentAlignment = Alignment.Center,
    ) {
        if (url.isNotBlank()) {
            AsyncImage(
                model = Http.media(url),
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size),
            )
        } else {
            Text(
                text = Format.initials(name),
                color = Color.White,
                style = MaterialTheme.typography.bodyMedium,
                fontSize = (size.value / 2.6).sp,
            )
        }
    }
}

@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Text(text = text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    }
}
