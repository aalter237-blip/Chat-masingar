/**
 * Telegram OTP gateway — official Bot API (free, no SMS credits, no QR codes,
 * no unofficial protocols).
 *
 * Setup (one minute, by the server operator):
 *   1. create the bot in Telegram: message @BotFather -> /newbot -> token
 *   2. set TELEGRAM_BOT_TOKEN (+ TELEGRAM_BOT_USERNAME so the apps can show it)
 *   3. every user opens the bot ONCE, presses Start and sends his phone number.
 *      That link (phone <-> chat) is stored in `telegram_links` and every
 *      verification code is then delivered to the linked chat as a message.
 *
 * The bot is send-only for OTP codes. Incoming messages are only used to
 * (un)link phone numbers and to answer /start, /help — nothing else is read
 * or stored.
 */
import { config } from './config.js';
import { log } from './util.js';
import * as store from './store.js';

const API = () => `https://api.telegram.org/bot${config.telegramBotToken}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = false;
let offset = 0;
let botUsername = '';

const HELP =
  'مرحباً 👋 أنا بوت رموز التحقق لتطبيق ماسنجر.\n\n' +
  'أرسل رقم هاتفك بالصيغة الدولية (مثال: 967771234567) لربطه بهذه المحادثة — ' +
  'بعدها تصلك رموز التحقق هنا عند تسجيل الدخول في التطبيق.\n\n' +
  'الأوامر:\n' +
  '/unlink — إلغاء ربط رقمك\n' +
  '/help — هذه التعليمات';

/** @returns the public bot username with a leading @ (or '' when unknown). */
export function botName() {
  return botUsername || config.telegramBotUsername || '';
}

/** Boot the gateway: verify the token, learn the username, start polling. */
export async function start() {
  if (!config.telegramBotToken || running) return;
  try {
    const res = await fetch(`${API()}/getMe`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) throw new Error(data?.description || `getMe failed (${res.status})`);
    botUsername = config.telegramBotUsername || (data.result.username ? '@' + data.result.username : '');
    log(`telegram: bot ${botUsername || '(no username)'} ready — users send their phone number to the bot once, codes arrive there`);
  } catch (err) {
    log('telegram: bot token rejected or unreachable ->', err.message);
    log('telegram: OTP falls back to the console until TELEGRAM_BOT_TOKEN works');
    return; // polling never starts with an invalid token
  }
  running = true;
  pollLoop().catch((err) => log('telegram: poll loop crashed ->', err.message));
}

export function stop() {
  running = false;
}

async function pollLoop() {
  while (running) {
    try {
      const res = await fetch(
        `${API()}/getUpdates?timeout=25&offset=${offset}&allowed_updates=["message"]`,
        { signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) {
        log(`telegram: getUpdates error ${res.status} — retrying`);
      } else {
        const data = await res.json().catch(() => null);
        if (data && data.ok) {
          for (const u of data.result || []) {
            offset = u.update_id + 1;
            handleUpdate(u);
          }
        }
      }
    } catch {
      /* transient network error: poll again after a short pause */
    }
    await sleep(300);
  }
}

function handleUpdate(u) {
  const msg = u.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return;
  const text = String(msg.text || '').trim();
  if (!text) return;
  const chatId = msg.chat.id;
  const name = msg.from?.username ? '@' + msg.from.username : msg.from?.first_name || '';

  if (text === '/start' || text === '/help') return reply(chatId, HELP);

  if (text === '/unlink') {
    const prev = store.findTelegramLinkByChat(chatId);
    if (prev) {
      store.deleteTelegramLink(prev.phone);
      log(`telegram: unlinked +${prev.phone} (chat ${chatId})`);
      return reply(chatId, `تم إلغاء ربط رقم ${maskPhone(prev.phone)}. أرسل رقمك في أي وقت لربطه من جديد.`);
    }
    return reply(chatId, 'لا يوجد رقم مرتبط بهذه المحادثة.');
  }

  const phone = normalizePhone(text);
  if (!phone) return reply(chatId, 'لم أتعرف على هذا الرقم. أرسل رقم الهاتف بالصيغة الدولية بدون + أو مسافات، مثال: 967771234567');

  const prev = store.findTelegramLinkByChat(chatId);
  if (prev && prev.phone === phone) {
    return reply(chatId, `رقمك ${maskPhone(phone)} مرتبط بالفعل بهذه المحادثة ✅`);
  }
  store.saveTelegramLink(phone, chatId, name);
  log(`telegram: linked ${name || 'user'} (chat ${chatId}) to phone +${phone}`);
  reply(chatId, `✅ تم ربط رقمك ${maskPhone(phone)} بنجاح. ستصل رموز التحقق إلى هذه المحادثة.`);
  if (prev) {
    reply(prev.chat_id, `⚠️ تم نقل ربط رقم ${maskPhone(phone)} إلى محادثة أخرى. أرسل رقمك لربطه من جديد إن أردت.`);
  }
}

/** Send one OTP code to the Telegram chat linked to `phone`. */
export async function sendOtp(phone, code) {
  if (!config.telegramBotToken) return { ok: false, error: 'telegram غير مفعّل' };

  const link = store.getTelegramLink(phone);
  if (!link) {
    return {
      ok: false,
      notLinked: true,
      error: `المستخدم لم يربط رقمه بالبوت بعد — افتح ${botName() || 'بوت تلجرام'} وأرسل رقمه مرة واحدة ثم أعد المحاولة`,
    };
  }

  try {
    const text = otpText(code);
    const res = await fetch(`${API()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: link.chat_id,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (data && data.ok) {
      log(`telegram: OTP delivered to +${phone} (chat ${link.chat_id})`);
      return { ok: true };
    }
    const desc = data?.description || `sendMessage ${res.status}`;
    log(`telegram: sendMessage failed for +${phone} -> ${desc}`);
    return { ok: false, error: desc };
  } catch (err) {
    log(`telegram: sendMessage attempt failed for +${phone} ->`, err.message);
    return { ok: false, error: err.message };
  }
}

export function otpText(code) {
  return String(config.telegramOtpText)
    .replace(/\$\{code\}/g, code)
    .replace(/\{\{code\}\}/g, code);
}

/** Public status: exposes no secrets, only state and masked phone numbers. */
export function summary() {
  return {
    enabled: !!config.telegramBotToken,
    botUsername: botName(),
    linked: store.countTelegramLinks(),
    phones: store.listTelegramLinks().map((l) => maskPhone(l.phone)),
  };
}

/* ------------------------------- helpers ----------------------------- */

function reply(chatId, text) {
  fetch(`${API()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000),
  }).catch((err) => log('telegram: reply failed ->', err.message));
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return digits;
}

function maskPhone(phone) {
  const p = String(phone);
  if (p.length <= 6) return '*'.repeat(p.length);
  return p.slice(0, 4) + '*'.repeat(Math.max(4, p.length - 6)) + p.slice(-2);
}
