package io.masingar.chat.util

import android.content.Context
import android.telephony.TelephonyManager
import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil
import java.security.MessageDigest
import java.util.Locale

/**
 * E.164 handling for every country in the world.
 * Uses libphonenumber (the same library Android's dialer uses) and falls back to
 * a light-weight normaliser when the number cannot be parsed.
 */
object Phone {

    private val util: PhoneNumberUtil by lazy { PhoneNumberUtil.getInstance() }

    /** ISO-3166 region of the device (SIM, then locale). */
    fun deviceRegion(context: Context): String {
        val iso = runCatching {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            when {
                tm?.networkCountryIso.isNullOrBlank().not() -> tm?.networkCountryIso
                tm?.simCountryIso.isNullOrBlank().not() -> tm?.simCountryIso
                else -> null
            }
        }.getOrNull()
        return (iso ?: Locale.getDefault().country).ifBlank { "YE" }.uppercase()
    }

    fun countryCodeForRegion(region: String): Int =
        runCatching { util.getCountryCodeForRegion(region.uppercase()) }.getOrDefault(0)

    fun countryCode(context: Context): Int {
        val code = countryCodeForRegion(deviceRegion(context))
        return if (code > 0) code else 967
    }

    /** Digits only, E.164, without the leading '+'. Empty when impossible. */
    fun normalize(input: String, defaultRegion: String = "YE"): String {
        val raw = input.trim()
        if (raw.isBlank()) return ""
        val digits = raw.map { ch ->
            when (ch) {
                in '0'..'9' -> ch
                '٠', '۰' -> '0'; '١', '۱' -> '1'; '٢', '۲' -> '2'; '٣', '۳' -> '3'; '٤', '۴' -> '4'
                '٥', '۵' -> '5'; '٦', '۶' -> '6'; '٧', '۷' -> '7'; '٨', '۸' -> '8'; '٩', '۹' -> '9'
                else -> ' '
            }
        }.joinToString("").filter { it != ' ' }

        val candidate = when {
            raw.startsWith("+") -> "+$digits"
            digits.startsWith("00") -> "+$digits".removePrefix("00").let { "+$it" }
            else -> digits
        }

        return try {
            val parsed = if (candidate.startsWith("+")) util.parse(candidate, null)
            else util.parse(candidate, defaultRegion)
            if (util.isValidNumber(parsed)) util.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164).removePrefix("+")
            else fallback(digits, defaultRegion)
        } catch (e: NumberParseException) {
            fallback(digits, defaultRegion)
        }
    }

    private fun fallback(digits: String, region: String): String {
        if (digits.isBlank()) return ""
        val code = countryCodeForRegion(region)
        val withoutTrunk = digits.trimStart('0')
        return when {
            code > 0 && digits.startsWith(code.toString()) -> digits
            code > 0 -> "$code$withoutTrunk"
            else -> withoutTrunk
        }
    }

    /** Privacy preserving key uploaded for contact discovery (server stores hashes). */
    fun hash(e164: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("masingar:$e164".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /** Pretty print for the UI: +967 771 234 567 */
    fun pretty(e164: String): String {
        if (e164.isBlank()) return ""
        return try {
            val parsed = util.parse("+$e164", null)
            util.format(parsed, PhoneNumberUtil.PhoneNumberFormat.INTERNATIONAL)
        } catch (e: NumberParseException) {
            "+$e164"
        }
    }

    fun national(e164: String): String {
        if (e164.isBlank()) return ""
        return try {
            val parsed = util.parse("+$e164", null)
            util.format(parsed, PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
        } catch (e: NumberParseException) {
            e164
        }
    }
}
