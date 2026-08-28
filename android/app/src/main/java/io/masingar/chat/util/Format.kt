package io.masingar.chat.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object Format {
    fun time(ts: Long): String =
        if (ts <= 0) "" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))

    fun day(ts: Long): String {
        if (ts <= 0) return ""
        val cal = Calendar.getInstance()
        val target = Calendar.getInstance().apply { timeInMillis = ts }
        return when {
            sameDay(cal, target) -> todayLabel()
            sameDay(apply2(cal) { add(Calendar.DAY_OF_YEAR, -1) }, target) -> yesterdayLabel()
            else -> SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ts))
        }
    }

    fun full(ts: Long): String =
        if (ts <= 0) "" else SimpleDateFormat("d MMM, HH:mm", Locale.getDefault()).format(Date(ts))

    fun duration(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
        else String.format(Locale.US, "%d:%02d", m, s)
    }

    fun initials(name: String): String {
        val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        return when {
            parts.isEmpty() -> "؟"
            parts.size == 1 -> parts[0].take(2)
            else -> (parts[0].take(1) + parts[1].take(1))
        }
    }

    private fun sameDay(a: Calendar, b: Calendar): Boolean =
        a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)

    private fun apply2(cal: Calendar, block: Calendar.() -> Unit): Calendar {
        val copy = cal.clone() as Calendar
        copy.block()
        return copy
    }

    private fun todayLabel(): String = if (isArabic()) "اليوم" else "Today"

    private fun yesterdayLabel(): String = if (isArabic()) "أمس" else "Yesterday"

    private fun isArabic(): Boolean =
        Locale.getDefault().language.startsWith("ar")
}
