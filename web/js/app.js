/* Masingar web client - application shell, chat, contacts and call UI. */
import { api, session, Realtime } from './api.js';
import { CallEngine, QUALITY_PRESETS, LADDER } from './rtc.js';
import { E2EE } from './crypto.js';
import { t, setLang, lang, isRTL, applyLang } from './i18n.js';

/* ------------------------------ utilities ------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const COUNTRIES = [
  ['967', 'اليمن 🇾🇪'], ['966', 'السعودية 🇸🇦'], ['971', 'الإمارات 🇦🇪'], ['968', 'عُمان 🇴🇲'],
  ['974', 'قطر 🇶🇦'], ['973', 'البحرين 🇧🇭'], ['965', 'الكويت 🇰🇼'], ['962', 'الأردن 🇯🇴'],
  ['963', 'سوريا 🇸🇾'], ['961', 'لبنان 🇱🇧'], ['964', 'العراق 🇮🇶'], ['970', 'فلسطين 🇵🇸'],
  ['20', 'مصر 🇪🇬'], ['218', 'ليبيا 🇱🇾'], ['216', 'تونس 🇹🇳'], ['213', 'الجزائر 🇩🇿'],
  ['212', 'المغرب 🇲🇦'], ['249', 'السودان 🇸🇩'], ['252', 'الصومال 🇸🇴'], ['253', 'جيبوتي 🇩🇯'],
  ['222', 'موريتانيا 🇲🇷'], ['90', 'تركيا 🇹🇷'], ['98', 'إيران 🇮🇷'], ['92', 'باكستان 🇵🇰'],
  ['91', 'الهند 🇮🇳'], ['93', 'أفغانستان 🇦🇫'], ['1', 'أمريكا/كندا 🇺🇸'], ['52', 'المكسيك 🇲🇽'],
  ['55', 'البرازيل 🇧🇷'], ['54', 'الأرجنتين 🇦🇷'], ['57', 'كولومبيا 🇨🇴'], ['56', 'تشيلي 🇨🇱'],
  ['51', 'بيرو 🇵🇪'], ['44', 'بريطانيا 🇬🇧'], ['33', 'فرنسا 🇫🇷'], ['49', 'ألمانيا 🇩🇪'],
  ['39', 'إيطاليا 🇮🇹'], ['34', 'إسبانيا 🇪🇸'], ['351', 'البرتغال 🇵🇹'], ['31', 'هولندا 🇳🇱'],
  ['32', 'بلجيكا 🇧🇪'], ['41', 'سويسرا 🇨🇭'], ['43', 'النمسا 🇦🇹'], ['46', 'السويد 🇸🇪'],
  ['47', 'النرويج 🇳🇴'], ['45', 'الدنمارك 🇩🇰'], ['358', 'فنلندا 🇫🇮'], ['48', 'بولندا 🇵🇱'],
  ['380', 'أوكرانيا 🇺🇦'], ['7', 'روسيا 🇷🇺'], ['81', 'اليابان 🇯🇵'], ['82', 'كوريا الجنوبية 🇰🇷'],
  ['86', 'الصين 🇨🇳'], ['65', 'سنغافورة 🇸🇬'], ['60', 'ماليزيا 🇲🇾'], ['62', 'إندونيسيا 🇮🇩'],
  ['63', 'الفلبين 🇵🇭'], ['66', 'تايلاند 🇹🇭'], ['84', 'فيتنام 🇻🇳'], ['880', 'بنغلاديش 🇧🇩'],
  ['234', 'نيجيريا 🇳🇬'], ['254', 'كينيا 🇰🇪'], ['233', 'غانا 🇬🇭'], ['27', 'جنوب أفريقيا 🇿🇦'],
  ['251', 'إثيوبيا 🇪🇹'], ['255', 'تنزانيا 🇹🇿'], ['256', 'أوغندا 🇺🇬'], ['20', 'مصر 🇪🇬'],
  ['61', 'أستراليا 🇦🇺'], ['64', 'نيوزيلندا 🇳🇿'], ['971', 'الإمارات 🇦🇪'],
];

/** Shared chat wallpapers (stored on the server, applied on both sides). */
const WALLPAPERS = [
  { id: 'none', label: 'بدون', css: '' },
  { id: 'teal', label: 'أخضر', css: 'linear-gradient(160deg,#005c4b,#0b141a)' },
  { id: 'night', label: 'ليلي', css: 'linear-gradient(160deg,#1b2a4a,#0b141a)' },
  { id: 'sunset', label: 'غروب', css: 'linear-gradient(160deg,#7b2d5e,#f9a825)' },
  { id: 'sand', label: 'رملي', css: 'linear-gradient(160deg,#e6c9a8,#8d6e63)' },
  { id: 'ocean', label: 'محيط', css: 'linear-gradient(160deg,#0f7a63,#053f8c)' },
  { id: 'dots', label: 'منقّط', css: 'radial-gradient(circle at 20% 20%,#00a88433 2px,transparent 3px),radial-gradient(circle at 70% 60%,#25d36622 2px,transparent 3px),linear-gradient(160deg,#111b21,#0b141a)' },
];

const state = {
  me: null,
  conversations: [],
  contacts: [],
  calls: [],
  messages: new Map(),
  presence: new Map(),
  typing: new Map(),
  activeConvId: null,
  iceServers: [],
  settings: loadSettings(),
  lastSync: 0,
  unreadTotal: 0,
  e2ee: false,
};

const rt = new Realtime();
/** id -> opened payload, so we do not decrypt the same message twice */
const decryptedCache = new Map();
/** url -> object URL of a decrypted attachment */
const mediaCache = new Map();
let engine = null; // active CallEngine
let pendingIncoming = null;
let ringtone = null;
const DEMO_PHONES = ['967771000001', '967771000002', '967771000003', '12025550123'];

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('masingar.settings') || '{}');
    return {
      theme: 'dark',
      quality: 'auto',
      dataSaver: false,
      autoQuality: true,
      audioOnlyFallback: true,
      showStats: false,
      sounds: true,
      ...raw,
    };
  } catch {
    return { theme: 'dark', quality: 'auto', dataSaver: false, autoQuality: true, audioOnlyFallback: true, showStats: false, sounds: true };
  }
}
function saveSettings() {
  localStorage.setItem('masingar.settings', JSON.stringify(state.settings));
}

/* ------------------------------ formatting ----------------------------- */

const fmtTime = (ts) => new Date(ts).toLocaleTimeString(lang() === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return t('today');
  if (d.toDateString() === y.toDateString()) return t('yesterday');
  return d.toLocaleDateString(lang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });
};
const fmtDuration = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
const initials = (name) =>
  (name || '؟')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');

function avatarEl(user, small = false) {
  const name = user?.name || (user?.phone ? '+' + user.phone : '؟');
  const el = h('div', { class: `avatar${small ? ' sm' : ''}` }, initials(name));
  if (user?.avatar) el.innerHTML = `<img src="${user.avatar}" alt="" />`;
  const seed = (user?.id || name).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (seed * 47) % 360;
  el.style.background = user?.avatar ? 'transparent' : `linear-gradient(145deg, hsl(${hue} 62% 45%), hsl(${(hue + 40) % 360} 62% 32%))`;
  return el;
}

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

function modal({ title, body, actions = [] }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (value) => {
      backdrop.remove();
      resolve(value);
    };
    const box = h(
      'div',
      { class: 'modal' },
      h('h3', { text: title }),
      body,
      h(
        'div',
        { class: 'modal-actions' },
        ...actions.map((a) =>
          h('button', { class: `btn ${a.kind || 'ghost'}`, style: 'flex:1', onclick: () => close(a.value ?? a.label) }, a.label)
        )
      )
    );
    backdrop.append(box);
    backdrop.addEventListener('click', (e) => e.target === backdrop && close(null));
    $('#modal-root').append(backdrop);
  });
}

/* -------------------------------- sound --------------------------------- */

let audioCtx = null;
function audio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(freq = 660, ms = 90, volume = 0.05) {
  try {
    const ctx = audio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
      osc.stop(ctx.currentTime + 0.06);
    }, ms);
  } catch {
    /* audio not available */
  }
}
function startRingtone() {
  stopRingtone();
  if (!state.settings.sounds) return;
  try {
    const ctx = audio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    lfo.frequency.value = 1.6;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    lfo.start();
    // ring 1s / silence 2s
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
    const timer = setInterval(() => {
      const t0 = ctx.currentTime;
      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    }, 3000);
    ringtone = { osc, gain, lfo, timer };
  } catch {
    /* ignore */
  }
}
function stopRingtone() {
  if (!ringtone) return;
  clearInterval(ringtone.timer);
  try {
    ringtone.gain.gain.value = 0.0001;
    ringtone.osc.stop();
    ringtone.lfo.stop();
  } catch {
    /* ignore */
  }
  ringtone = null;
}

/* ------------------------------ navigation ------------------------------ */

function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
}
function showTab(tab) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  $('#appbar-title').textContent = t(tab);
  if (tab === 'chats') renderChats();
  if (tab === 'calls') renderCalls();
  if (tab === 'contacts') renderContacts();
  if (tab === 'settings') renderSettings();
}

/* -------------------------------- login --------------------------------- */

function initLogin() {
  applyLang();
  const select = $('#country-code');
  const seen = new Set();
  select.innerHTML = '';
  for (const [code, label] of COUNTRIES) {
    if (seen.has(code)) continue;
    seen.add(code);
    select.append(h('option', { value: code }, `+${code} ${label}`));
  }
  const saved = localStorage.getItem('masingar.cc') || '967';
  select.value = [...select.options].some((o) => o.value === saved) ? saved : '967';
  select.addEventListener('change', () => localStorage.setItem('masingar.cc', select.value));

  /*
   * The demo shortcuts belong to a throwaway box only. A real server sends the
   * code over SMS and never hands it back, so it reports demo:false and the
   * shortcuts stay hidden - every account there is a real phone number.
   */
  const demoList = $('#demo-list');
  demoList.innerHTML = '';
  demoList.classList.add('hidden');
  api.health()
    .then((info) => {
      if (!info) return;
      // Telegram OTP bot enabled but no phone linked yet -> tell the admin.
      if (info.telegram?.enabled && info.telegram?.linked === 0) {
        const banner = $('#tg-banner');
        if (banner) {
          const bot = info.telegram.botUsername || 'بوت تلجرام';
          banner.textContent = '⚠️ بوت تلجرام مفعّل لكن لا يوجد أي رقم مرتبط بعد — أرسل للمستخدمين اسم البوت ' + bot + ' ليرسل كلٌّ منهم رقمه إليه مرة واحدة.';
          banner.classList.remove('hidden');
        }
      }
      if (info.demo !== true) return;
      for (const phone of DEMO_PHONES) {
        demoList.append(
          h('button', { class: 'demo-chip', type: 'button', onclick: () => ($('#phone').value = phone.replace(/^\d{3}/, '')) }, '+' + phone)
        );
      }
      demoList.classList.remove('hidden');
    })
    .catch(() => {
      /* offline / unknown server: no shortcuts */
    });

  let phone = '';
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.classList.add('hidden');
    const btn = $('#login-submit');
    const codeGroup = $('#code-group');
    const code = $('#code').value.trim();
    const cc = $('#country-code').value;
    const raw = $('#phone').value.trim();

    try {
      if (!codeGroup.classList.contains('hidden') && code.length >= 4) {
        btn.disabled = true;
        btn.textContent = t('connecting');
        const full = normalizePhone(raw, cc);
        const res = await api.verifyOtp(full, code, '');
        await onLoggedIn(res);
        return;
      }

      if (!raw) return;
      btn.disabled = true;
      phone = normalizePhone(raw, cc);
      const res = await api.requestOtp(phone);
      codeGroup.classList.remove('hidden');
      $('#resend').classList.remove('hidden');
      if (res.devCode) {
        const dev = $('#dev-code');
        dev.classList.remove('hidden');
        dev.textContent = `${t('codeLabel')}: ${res.devCode} — (${t('demoUsers')})`;
        $('#code').value = res.devCode;
      }
      const note = $('#demo-note');
      if (res.channel === 'telegram' && res.delivered) {
        note.textContent = 'تم إرسال كود التحقق عبر تلجرام — افتح تلجرام وستجد الرسالة من البوت.';
      } else if (res.channel === 'telegram' && !res.delivered) {
        const bot = res.botUsername || 'بوت تلجرام';
        note.textContent = 'لم يصل الكود: افتح بوت تلجرام ' + bot + ' وأرسل رقمك (مرة واحدة) ثم أعد طلب الكود.';
      } else if (res.channel === 'console' && res.provider !== 'console') {
        note.textContent = 'تعذّر الإرسال عبر تلجرام الآن — الكود مطبوع في سجلّ السيرفر (console).';
      } else if (res.provider === 'none') {
        note.textContent = 'وضع تجريبي: لم يتم إرسال رسالة نصية (لا يوجد مزوّد SMS مضبوط) — استخدم الكود الظاهر بالأعلى.';
      } else if (res.provider === 'whatsapp' && res.delivered) {
        note.textContent = 'تم إرسال كود التحقق عبر واتساب إلى رقمك.';
      } else if (res.provider === 'whatsapp') {
        note.textContent = 'تعذّر إرسال رسالة واتساب — تأكّد من ضبط WHATSAPP_PHONE_NUMBER_ID و WHATSAPP_ACCESS_TOKEN والقالب المعتمد، ثم أعد المحاولة.';
      } else if (res.delivered) {
        note.textContent = 'تم إرسال كود التحقق برسالة نصية إلى رقمك.';
      } else {
        note.textContent = 'تعذّر إرسال رسالة SMS الآن — تحقّق من اتصال بوابة الإرسال ثم أعد المحاولة.';
      }
      btn.textContent = t('verify');
      $('#code').focus();
    } catch (e2) {
      err.textContent = e2.message || 'حدث خطأ';
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      if ($('#code-group').classList.contains('hidden')) btn.textContent = t('sendCode');
    }
  });

  $('#resend').addEventListener('click', async () => {
    try {
      const res = await api.requestOtp(phone || normalizePhone($('#phone').value, $('#country-code').value));
      if (res.devCode) $('#code').value = res.devCode;
      toast(t('resend') + ' ✓');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function normalizePhone(raw, cc = '967') {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  s = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0')) s = cc + s.replace(/^0+/, '');
  if (s.length < 10 && !s.startsWith(cc)) s = cc + s;
  return s;
}

/* -------------------------------- boot ---------------------------------- */

async function onLoggedIn(res) {
  session.save(res.accessToken, res.refreshToken, res.user);
  state.me = res.user;
  if (res.isNew && !res.user.name) {
    const name = await modal({
      title: t('name'),
      body: h('input', { class: 'input', id: 'name-input', placeholder: t('name') }),
      actions: [
        { label: t('save'), kind: 'primary', value: 'save' },
        { label: t('logout'), value: 'skip' },
      ],
    }).then((v) => (v === 'save' ? $('#name-input')?.value : ''));
    if (name) {
      try {
        const up = await api.updateMe({ name });
        state.me = up.user;
        session.save(session.token, session.refreshToken, up.user);
      } catch {
        /* ignore */
      }
    }
  }
  await enterApp();
}

async function enterApp() {
  showScreen('main');
  showTab('chats');
  try {
    state.iceServers = (await api.ice()).iceServers || [];
  } catch {
    state.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
  }
  rt.connect();
  await Promise.all([loadConversations(), loadContacts(), loadCalls()]);
  renderChats();
  await initE2EE();
}

/* --------------------------------- E2EE ------------------------------------ */

/** Loads (or creates) the device identity and publishes the public key. */
async function initE2EE() {
  try {
    state.e2ee = await E2EE.init();
  } catch {
    state.e2ee = false;
  }
  if (!state.e2ee) return;
  registerPeers();
  try {
    const pub = await E2EE.publicKeyB64();
    if (pub && state.me && state.me.publicKey !== pub) {
      const res = await api.updateMe({ public_key: pub });
      state.me = res.user;
    }
  } catch {
    /* keep going: messages simply stay unencrypted for now */
  }
}

/** Caches the public keys of everybody we can talk to. */
function registerPeers() {
  if (!state.e2ee) return;
  for (const conv of state.conversations) {
    for (const m of conv.members || []) if (m.publicKey) E2EE.rememberPeer(m.id, m.publicKey);
  }
  for (const c of state.contacts) {
    if (c.user?.publicKey) E2EE.rememberPeer(c.user.id, c.user.publicKey);
  }
}

/** Makes sure the group key of a conversation is available locally. */
async function ensureGroupKey(conv) {
  if (!state.e2ee || !conv) return false;
  if (E2EE.groupKeys.has(conv.id)) return true;
  try {
    const res = await api.groupKeys(conv.id);
    const mine = (res.keys || []).find((k) => k.userId === state.me.id);
    if (!mine) return false;
    const record = typeof mine.enc === 'string' && mine.enc.trim().startsWith('{') ? JSON.parse(mine.enc) : mine;
    const author = mine.by || (conv.members || []).find((m) => m.id !== state.me.id)?.id;
    const got = author ? await E2EE.unwrapGroupKey(conv.id, record, state.me.id, author) : null;
    return !!got;
  } catch {
    return false;
  }
}

/** Generates a group key and hands a wrapped copy to every member. */
async function distributeGroupKey(conv) {
  if (!state.e2ee) return;
  const key = await E2EE.createGroupKey(conv.id);
  const entries = [];
  for (const m of conv.members || []) {
    if (m.id === state.me.id) continue;
    const wrapped = await E2EE.wrapGroupKey(conv.id, key, m.id, state.me.id);
    if (wrapped) entries.push({ userId: m.id, enc: JSON.stringify(wrapped), nonce: wrapped.nonce });
  }
  if (entries.length) await api.setGroupKeys(conv.id, entries);
}

/**
 * Sends a payload: encrypted end-to-end when possible, plain otherwise.
 * payload = { t:'text', x } | { t:'media', m:{ url, k, n, mime, name, size, kind } }
 */
async function deliver(convId, payload) {
  const conv = state.conversations.find((c) => c.id === convId);
  let body = '';
  let encrypted = false;

  if (state.e2ee && conv?.type === 'group') {
    if (!(await ensureGroupKey(conv)) && conv.members?.some((m) => m.id === state.me.id)) {
      await distributeGroupKey(conv);
    }
    const envelope = await E2EE.encryptGroup({ conversationId: convId, senderId: state.me.id, payload });
    if (envelope) {
      body = envelope;
      encrypted = true;
    }
  } else if (state.e2ee) {
    let peerId = conv?.peer?.id;
    // the peer may have published its key after we loaded the list
    if (peerId && !E2EE.hasPeer(peerId)) {
      await loadConversations().catch(() => {});
      registerPeers();
    }
    if (peerId) {
      const envelope = await E2EE.encryptDirect({ conversationId: convId, peerId, myId: state.me.id, payload });
      if (envelope) {
        body = envelope;
        encrypted = true;
      }
    }
  }
  if (!encrypted) body = payload.t === 'text' ? payload.x : JSON.stringify(payload);

  const media = payload.m || null;
  const type = media ? media.kind || 'image' : payload.t === 'media' ? 'file' : 'text';
  return api.sendMessage(convId, {
    type,
    body,
    encrypted,
    mediaUrl: media?.url || '',
    mediaMeta: media ? { k: media.k, n: media.n, mime: media.mime, name: media.name, size: media.size } : null,
    clientId: 'w' + Date.now(),
  });
}

/**
 * Opens a message. Outgoing messages carry a copy sealed for ourselves, so
 * they open here as well; the local cache only short circuits the work.
 */
async function openMessage(message) {
  if (!message.encrypted) return { t: 'text', x: message.body, plain: true };
  if (decryptedCache.has(message.id)) return decryptedCache.get(message.id);
  if (!state.e2ee) return null;
  const conv = state.conversations.find((c) => c.id === message.conversationId);
  try {
    if (conv?.type === 'group') {
      if (!(await ensureGroupKey(conv))) return null;
      const envelope = JSON.parse(atob(message.body));
      return await E2EE.decryptGroup({
        conversationId: message.conversationId,
        senderId: message.senderId,
        envelope,
      });
    }
    return await E2EE.decryptDirect({
      conversationId: message.conversationId,
      peerId: message.senderId,
      myId: state.me.id,
      body: message.body,
    });
  } catch {
    return null;
  }
}

async function loadConversations() {
  const res = await api.conversations();
  state.conversations = res.conversations || [];
  state.unreadTotal = state.conversations.reduce((n, c) => n + (c.unread || 0), 0);
  registerPeers();
}
async function loadContacts() {
  const res = await api.contacts();
  state.contacts = res.contacts || [];
  registerPeers();
}
async function loadCalls() {
  const res = await api.calls();
  state.calls = res.calls || [];
}

/* ------------------------------- chats tab ------------------------------ */

function peerOf(conv) {
  return conv.peer || conv.members?.find((m) => m.id !== state.me?.id) || null;
}

function renderChats() {
  const view = $('#view-chats');
  view.innerHTML = '';
  if (!state.conversations.length) {
    view.append(h('div', { class: 'empty' }, t('noChats')));
    return;
  }
  for (const conv of state.conversations) {
    const peer = peerOf(conv);
    const last = conv.lastMessage;
    const preview =
      last?.type === 'image'
        ? '📷 صورة'
        : last?.type === 'audio'
        ? '🎤 رسالة صوتية'
        : last?.type === 'video'
        ? '🎥 فيديو'
        : last?.type === 'call'
        ? '📞 مكالمة'
        : last?.body || '';
    view.append(
      h(
        'div',
        { class: 'list-item', onclick: () => openChat(conv.id) },
        avatarEl(peer || { name: conv.title }),
        h(
          'div',
          { class: 'item-main' },
          h(
            'div',
            { class: 'item-title' },
            h('span', { class: 'ellipsis', text: conv.title }),
            h('span', { class: 'muted', style: 'font-size:11px', text: last ? fmtDay(last.createdAt) : '' })
          ),
          h(
            'div',
            { class: 'item-sub' },
            h('span', { class: 'ellipsis', text: preview }),
            conv.unread ? h('span', { class: 'badge', text: String(conv.unread) }) : null
          )
        )
      )
    );
  }
}

/* ------------------------------- calls tab ------------------------------ */

function userById(id) {
  if (state.me?.id === id) return state.me;
  for (const c of state.conversations) for (const m of c.members || []) if (m.id === id) return m;
  for (const c of state.contacts) if (c.user?.id === id) return c.user;
  return null;
}

function renderCalls() {
  const view = $('#view-calls');
  view.innerHTML = '';
  if (!state.calls.length) {
    view.append(h('div', { class: 'empty' }, t('noCalls')));
    return;
  }
  for (const call of state.calls) {
    const outgoing = call.callerId === state.me?.id;
    const peer = userById(outgoing ? call.calleeId : call.callerId) || { name: 'مستخدم' };
    const missed = call.state === 'missed' && !outgoing;
    const icon = call.type === 'video' ? '🎥' : '📞';
    const stateLabel = missed ? t('missed') : outgoing ? t('outgoing') : t('incoming');
    view.append(
      h(
        'div',
        { class: 'list-item', onclick: () => startCall(peer.id, call.type) },
        avatarEl(peer, true),
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title' }, h('span', { text: peer.name || peer.phone })),
          h(
            'div',
            { class: 'item-sub' },
            h('span', { style: missed ? 'color:var(--danger)' : '', text: `${icon} ${stateLabel}` }),
            h('span', { text: call.durationMs ? fmtDuration(call.durationMs) : '' })
          )
        ),
        h('button', { class: 'icon-btn', onclick: (e) => (e.stopPropagation(), startCall(peer.id, 'audio')) }, '📞'),
        h('button', { class: 'icon-btn', onclick: (e) => (e.stopPropagation(), startCall(peer.id, 'video')) }, '🎥')
      )
    );
  }
}

/* ----------------------------- contacts tab ----------------------------- */

function renderContacts() {
  const view = $('#view-contacts');
  view.innerHTML = '';
  const registered = state.contacts.filter((c) => c.user);
  const others = state.contacts.filter((c) => !c.user);
  view.append(h('div', { class: 'section-title' }, `${t('contacts')} (${registered.length})`));

  if (!registered.length) view.append(h('div', { class: 'empty' }, t('noContacts')));
  for (const c of registered) {
    const online = state.presence.get(c.user.id)?.online;
    view.append(
      h(
        'div',
        { class: 'list-item', onclick: () => openChatWith(c.user.id) },
        avatarEl(c.user, true),
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title' }, h('span', { text: c.user.name || '+' + c.user.phone })),
          h('div', { class: 'item-sub' }, h('span', { text: online ? t('online') : c.user.about || '+' + c.user.phone }))
        ),
        h('button', { class: 'icon-btn', onclick: (e) => (e.stopPropagation(), startCall(c.user.id, 'audio')) }, '📞'),
        h('button', { class: 'icon-btn', onclick: (e) => (e.stopPropagation(), startCall(c.user.id, 'video')) }, '🎥')
      )
    );
  }

  if (others.length) {
    view.append(h('div', { class: 'section-title' }, `${t('contacts')} — غير مسجلين (${others.length})`));
    for (const c of others) {
      view.append(
        h(
          'div',
          { class: 'list-item', style: 'opacity:.6' },
          h('div', { class: 'avatar sm', text: initials(c.name || '؟') }),
          h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, h('span', { text: c.name || 'بدون اسم' })))
        )
      );
    }
  }

  view.append(
    h(
      'div',
      { style: 'padding:16px' },
      h('button', { class: 'btn primary block', onclick: addByPhone }, `＋ ${t('addByPhone')}`),
      h('button', { class: 'btn ghost block', onclick: createGroup }, `👥 ${t('group')}`)
    )
  );
}

async function addByPhone() {
  const input = h('input', { class: 'input', placeholder: '771234567', inputmode: 'tel' });
  const res = await modal({
    title: t('addByPhone'),
    body: input,
    actions: [
      { label: t('add'), kind: 'primary', value: 'ok' },
      { label: 'إلغاء', value: null },
    ],
  });
  if (!res) return;
  try {
    const phone = normalizePhone(input.value, $('#country-code')?.value || localStorage.getItem('masingar.cc') || '967');
    const found = await api.usersByPhone(phone);
    await openChatWith(found.user.id);
  } catch (e) {
    toast(e.message || 'غير مسجل', 'error');
  }
}

async function createGroup() {
  const registered = state.contacts.filter((c) => c.user);
  if (!registered.length) return toast(t('noContacts'), 'warn');
  const selected = new Set();
  const box = h('div', { style: 'max-height:260px;overflow:auto' });
  for (const c of registered) {
    box.append(
      h(
        'label',
        { class: 'card-row', style: 'border:none;padding:8px 0;cursor:pointer' },
        h('input', {
          type: 'checkbox',
          style: 'width:20px;height:20px',
          onchange: (e) => (e.target.checked ? selected.add(c.user.id) : selected.delete(c.user.id)),
        }),
        avatarEl(c.user, true),
        h('span', { class: 'grow', text: c.user.name || c.user.phone })
      )
    );
  }
  const title = h('input', { class: 'input', placeholder: 'اسم المجموعة' });
  const res = await modal({
    title: t('group'),
    body: h('div', {}, title, box),
    actions: [
      { label: 'إنشاء', kind: 'primary', value: 'ok' },
      { label: 'إلغاء', value: null },
    ],
  });
  if (!res) return;
  try {
    const conv = await api.createConversation({ type: 'group', title: title.value || t('group'), memberIds: [...selected] });
    await loadConversations();
    openChat(conv.conversation.id);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function openChatWith(userId) {
  try {
    const res = await api.createConversation({ userId });
    await loadConversations();
    openChat(res.conversation.id);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ------------------------------ settings tab ---------------------------- */

function renderSettings() {
  const view = $('#view-settings');
  view.innerHTML = '';
  const me = state.me || {};

  view.append(
    h(
      'div',
      { class: 'profile-hero' },
      avatarEl(me),
      h(
        'div',
        { style: 'flex:1;min-width:0' },
        h('div', { style: 'font-weight:700', text: me.name || t('name') }),
        h('div', { class: 'muted', style: 'font-size:13px', text: '+' + me.phone }),
        h('div', { class: 'muted', style: 'font-size:12px', text: me.about || '' })
      ),
      h('button', { class: 'icon-btn', onclick: editProfile }, '✏️')
    )
  );

  const qualityCard = h('div', { class: 'card' });
  qualityCard.append(
    h('div', { class: 'card-row' }, h('div', { class: 'grow' }, h('div', { text: t('quality') }), h('div', { class: 'val', text: 'تلقائي / توفير بيانات / عالي' })))
  );
  const seg = h('div', { class: 'seg', style: 'margin:0 14px 14px' });
  for (const [key, label] of [
    ['saver', t('dataSaver')],
    ['auto', t('autoQuality')],
    ['hd', t('hdVideo')],
  ]) {
    seg.append(
      h('button', {
        class: state.settings.quality === key ? 'active' : '',
        text: label.length > 22 ? label.slice(0, 22) + '…' : label,
        onclick: () => {
          state.settings.quality = key;
          saveSettings();
          renderSettings();
          toast(t('quality') + ': ' + label);
        },
      })
    );
  }
  qualityCard.append(seg);
  qualityCard.append(
    toggleRow(t('autoQuality'), state.settings.autoQuality, (v) => {
      state.settings.autoQuality = v;
      saveSettings();
    }),
    toggleRow(t('dataSaver'), state.settings.dataSaver, (v) => {
      state.settings.dataSaver = v;
      saveSettings();
    }),
    toggleRow('التبديل للصوت فقط عند ضعف الشبكة', state.settings.audioOnlyFallback, (v) => {
      state.settings.audioOnlyFallback = v;
      saveSettings();
    }),
    toggleRow(t('networkStats') + ' (أثناء المكالمة)', state.settings.showStats, (v) => {
      state.settings.showStats = v;
      saveSettings();
    })
  );
  view.append(qualityCard);

  const appCard = h('div', { class: 'card' });
  appCard.append(
    h(
      'div',
      { class: 'card-row' },
      h('div', { class: 'grow', text: t('language') }),
      h(
        'div',
        { class: 'seg', style: 'width:150px' },
        h('button', {
          class: lang() === 'ar' ? 'active' : '',
          text: 'العربية',
          onclick: () => {
            setLang('ar');
            rerenderAll();
          },
        }),
        h('button', {
          class: lang() === 'en' ? 'active' : '',
          text: 'English',
          onclick: () => {
            setLang('en');
            rerenderAll();
          },
        })
      )
    ),
    h(
      'div',
      { class: 'card-row' },
      h('div', { class: 'grow', text: t('theme') }),
      h(
        'div',
        { class: 'seg', style: 'width:150px' },
        h('button', {
          class: state.settings.theme === 'dark' ? 'active' : '',
          text: t('dark'),
          onclick: () => {
            state.settings.theme = 'dark';
            applyTheme();
            saveSettings();
            renderSettings();
          },
        }),
        h('button', {
          class: state.settings.theme === 'light' ? 'active' : '',
          text: t('light'),
          onclick: () => {
            state.settings.theme = 'light';
            applyTheme();
            saveSettings();
            renderSettings();
          },
        })
      )
    ),
    toggleRow('أصوات التنبيه', state.settings.sounds, (v) => {
      state.settings.sounds = v;
      saveSettings();
    })
  );
  view.append(appCard);

  const infoCard = h('div', { class: 'card' });
  infoCard.append(
    h('div', { class: 'card-row' }, h('div', { class: 'grow', text: 'خوادم الشبكة (ICE)' }), h('div', { class: 'val', text: `${state.iceServers.length} خوادم` })),
    h('div', { class: 'card-row' }, h('div', { class: 'grow', text: 'حالة الاتصال' }), h('div', { class: 'val', id: 'conn-state', text: rt.connected ? t('online') : t('offline') })),
    h('div', { class: 'card-row' }, h('div', { class: 'grow', text: 'التشفير من طرف لطرف' }), h('div', { class: 'val', text: state.e2ee ? '🔒 مُفعّل' : 'غير متاح في هذا المتصفح' })),
    h('div', { class: 'card-row' }, h('div', { class: 'grow', text: 'الإصدار' }), h('div', { class: 'val', text: '1.0.0 (web)' }))
  );
  view.append(infoCard);

  view.append(h('div', { style: 'padding:16px' }, h('button', { class: 'btn ghost block', onclick: logout }, t('logout'))));
}

function toggleRow(label, value, onChange) {
  return h(
    'div',
    { class: 'card-row' },
    h('div', { class: 'grow', text: label }),
    h('button', {
      class: 'switch',
      'aria-checked': String(!!value),
      'aria-label': label,
      onclick: (e) => {
        const next = e.currentTarget.getAttribute('aria-checked') !== 'true';
        e.currentTarget.setAttribute('aria-checked', String(next));
        onChange(next);
      },
    })
  );
}

async function editProfile() {
  const name = h('input', { class: 'input', value: state.me?.name || '', placeholder: t('name') });
  const about = h('input', { class: 'input', value: state.me?.about || '', placeholder: t('about') });
  const res = await modal({
    title: t('name'),
    body: h('div', { style: 'display:grid;gap:10px' }, name, about),
    actions: [
      { label: t('save'), kind: 'primary', value: 'ok' },
      { label: 'إلغاء', value: null },
    ],
  });
  if (!res) return;
  try {
    const up = await api.updateMe({ name: name.value, about: about.value });
    state.me = up.user;
    session.save(session.token, session.refreshToken, up.user);
    renderSettings();
    toast('تم الحفظ');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', state.settings.theme === 'light' ? '#f0f2f5' : '#0b141a');
}

function rerenderAll() {
  applyLang();
  applyTheme();
  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $$('.tab small').forEach((el) => (el.textContent = t(el.closest('.tab').dataset.tab)));
  const active = $('.tab.active')?.dataset.tab || 'chats';
  $('#appbar-title').textContent = t(active);
  renderChats();
  renderCalls();
  renderContacts();
  renderSettings();
  if (state.activeConvId) renderChatHeader();
}

/* -------------------------------- chat ---------------------------------- */

async function openChat(convId) {
  state.activeConvId = convId;
  showScreen('chat');
  renderChatHeader();
  applyWallpaper();
  const list = $('#messages');
  list.innerHTML = '';
  try {
    const res = await api.messages(convId, { limit: 100 });
    state.messages.set(convId, res.messages);
    renderMessages(convId);
    api.read(convId).catch(() => {});
    const conv = state.conversations.find((c) => c.id === convId);
    if (conv) {
      conv.unread = 0;
      renderChats();
    }
  } catch (e) {
    toast(e.message, 'error');
  }
  $('#input').focus();
}

function renderChatHeader() {
  const conv = state.conversations.find((c) => c.id === state.activeConvId);
  if (!conv) return;
  const peer = peerOf(conv);
  const isGroup = conv.type === 'group';
  $('#chat-avatar').replaceWith((() => {
    const el = avatarEl(peer || { name: conv.title }, true);
    el.id = 'chat-avatar';
    return el;
  })());
  $('#chat-name').textContent = conv.title;
  const online = isGroup ? false : !!state.presence.get(peer?.id)?.online;
  const status = $('#chat-status');
  if (isGroup) status.textContent = `${conv.members?.length || 0} أعضاء`;
  else if (online) {
    status.textContent = t('online');
    status.classList.add('online');
  } else {
    status.classList.remove('online');
    const lastSeen = state.presence.get(peer?.id)?.lastSeen || peer?.lastSeen;
    status.textContent = lastSeen ? `${t('lastSeen')} ${fmtTime(lastSeen)}` : t('offline');
  }
  $('#btn-video-call').style.display = isGroup ? 'none' : '';
}

function renderMessages(convId) {
  const list = $('#messages');
  const messages = state.messages.get(convId) || [];
  list.innerHTML = '';
  let lastDay = '';
  for (const m of messages) {
    const day = fmtDay(m.createdAt);
    if (day !== lastDay) {
      list.append(h('div', { class: 'day-sep', text: day }));
      lastDay = day;
    }
    list.append(messageEl(m));
  }
  list.scrollTop = list.scrollHeight;
}

/** Resolves the (possibly encrypted) attachment to a usable URL. */
async function resolveMedia(media) {
  if (!media?.url) return '';
  if (media.k && state.e2ee) {
    const cached = mediaCache.get(media.url);
    if (cached) return cached;
    try {
      const res = await fetch(media.url);
      const plain = await E2EE.decryptMedia(await res.arrayBuffer(), media.k, media.n);
      const url = URL.createObjectURL(new Blob([plain], { type: media.mime || 'application/octet-stream' }));
      mediaCache.set(media.url, url);
      return url;
    } catch {
      return media.url;
    }
  }
  return media.url;
}

/** Renders the content of one bubble from its (decrypted) payload. */
async function fillBubble(container, m, payload) {
  if (m.deleted) {
    container.append(h('i', { class: 'muted', text: t('deleted') }));
    return;
  }
  const media = payload.m || m.media || null;
  if ((payload.t === 'media' || m.type !== 'text') && media?.url) {
    const url = await resolveMedia(media);
    const kind = media.kind || (m.type === 'video' ? 'video' : m.type === 'audio' ? 'audio' : m.type === 'file' ? 'file' : 'image');
    if (kind === 'image') {
      container.append(h('img', { src: url, alt: media.name || 'صورة', onclick: () => window.open(url, '_blank') }));
    } else if (kind === 'video') {
      container.append(h('video', { src: url, controls: true, preload: 'metadata' }));
    } else if (kind === 'audio') {
      container.append(h('audio', { src: url, controls: true, preload: 'metadata' }), h('div', { class: 'muted', style: 'font-size:11px', text: '🎤 رسالة صوتية' }));
    } else {
      container.append(
        h('a', { href: url, target: '_blank', rel: 'noopener', download: media.name || '', style: 'color:inherit' }, `📎 ${media.name || 'ملف'}`)
      );
    }
    if (payload.x) container.append(h('div', { text: payload.x }));
    return;
  }
  if (m.type === 'call') {
    container.append(
      h('div', { class: 'call-row' },
        h('span', { text: m.media?.type === 'video' ? '🎥' : '📞' }),
        h('span', { text: m.body }),
        m.media?.durationMs ? h('span', { class: 'muted', text: fmtDuration(m.media.durationMs) }) : null)
    );
    return;
  }
  container.append(h('span', { text: payload.x ?? m.body ?? '' }));
}

/** Small notice shown in the middle of the chat (screenshot, system, ...). */
function systemEl(m) {
  return h(
    'div',
    { class: 'system-msg' },
    h('span', { text: m.body }),
    h('span', { class: 'muted', style: 'font-size:10px;margin-inline-start:6px', text: fmtTime(m.createdAt) })
  );
}

function messageEl(m) {
  if (m.type === 'system') return systemEl(m);
  const mine = m.senderId === state.me?.id;
  const conv = state.conversations.find((c) => c.id === m.conversationId);
  const isGroup = conv?.type === 'group';
  const el = h('div', { class: `msg ${mine ? 'out' : 'in'}`, dataset: { id: m.id } });

  const body = h('div', { class: 'bubble-body' });
  el.append(body);

  if (m.encrypted) {
    body.append(h('span', { class: 'muted', text: '🔒 …' }));
    openMessage(m).then(async (payload) => {
      body.innerHTML = '';
      if (!payload) {
        body.append(h('i', { class: 'muted', text: '🔒 رسالة مشفّرة — لا يمكن فتحها على هذا الجهاز' }));
        return;
      }
      await fillBubble(body, m, payload);
    });
  } else {
    fillBubble(body, m, { t: m.type === 'text' ? 'text' : 'media', x: m.body, m: m.media, plain: true });
  }

  const meta = h('div', { class: 'meta' }, h('span', { text: fmtTime(m.createdAt) }));
  if (mine) {
    const tick = m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : '✓';
    meta.append(h('span', { class: `tick${m.status === 'read' ? ' read' : ''}`, text: tick }));
  }
  el.append(meta);

  if (mine && m.type === 'text') {
    el.addEventListener('dblclick', async () => {
      const okDel = await modal({
        title: t('deleteMessage'),
        body: h('div', { class: 'muted', text: m.body.slice(0, 120) }),
        actions: [
          { label: t('deleteMessage'), kind: 'primary', value: 'yes' },
          { label: 'إلغاء', value: null },
        ],
      });
      if (okDel === 'yes') {
        try {
          await api.deleteMessage(m.id);
          const list = state.messages.get(m.conversationId) || [];
          const idx = list.findIndex((x) => x.id === m.id);
          if (idx >= 0) list[idx] = { ...list[idx], deleted: true, body: '' };
          renderMessages(m.conversationId);
        } catch (e) {
          toast(e.message, 'error');
        }
      }
    });
  }
  return el;
}

function pushMessage(convId, message) {
  const list = state.messages.get(convId) || [];
  if (list.some((m) => m.id === message.id)) return;
  list.push(message);
  state.messages.set(convId, list);
  if (state.activeConvId === convId) {
    const el = messageEl(message);
    $('#messages').append(el);
    $('#messages').scrollTop = $('#messages').scrollHeight;
    api.read(convId).catch(() => {});
  }
}

async function sendText() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !state.activeConvId) return;
  input.value = '';
  autoGrow(input);
  try {
    const res = await deliver(state.activeConvId, { t: 'text', x: text });
    pushMessage(state.activeConvId, res.message);
    if (res.message.encrypted) decryptedCache.set(res.message.id, { t: 'text', x: text });
    updateConvLast(state.activeConvId, res.message);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function updateConvLast(convId, message) {
  const conv = state.conversations.find((c) => c.id === convId);
  if (!conv) return;
  conv.lastMessage = message;
  conv.updatedAt = message.createdAt;
  state.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  renderChats();
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(120, el.scrollHeight) + 'px';
}

/* ------------------------------- recording ------------------------------ */

let recorder = null;
let recordChunks = [];
async function toggleRecord() {
  const btn = $('#btn-record');
  if (recorder) {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recordChunks = [];
    recorder.ondataavailable = (e) => recordChunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(recordChunks, { type: recorder.mimeType || 'audio/webm' });
      recorder = null;
      btn.classList.remove('recording');
      for (const t2 of stream.getTracks()) t2.stop();
      if (blob.size < 500) return;
      try {
        const prepared = state.e2ee
          ? await E2EE.encryptFile(new File([blob], 'note.m4a', { type: blob.type || 'audio/mp4' }))
          : null;
        const up = await api.upload(prepared ? new File([prepared.blob], 'enc.bin') : new File([blob], 'note.m4a'), { durationMs: 0 });
        const payload = {
          t: 'media',
          m: prepared
            ? { url: up.url, k: prepared.key, n: prepared.nonce, mime: 'audio/mp4', name: 'note.m4a', size: prepared.size, kind: 'audio' }
            : { url: up.url, mime: blob.type, name: 'note.m4a', size: blob.size, kind: 'audio' },
        };
        const res = await deliver(state.activeConvId, payload);
        if (res.message.encrypted) decryptedCache.set(res.message.id, payload);
        pushMessage(state.activeConvId, res.message);
        updateConvLast(state.activeConvId, res.message);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    recorder.start();
    btn.classList.add('recording');
    toast('جارٍ التسجيل — اضغط مرة أخرى للإرسال');
  } catch {
    toast(t('micDenied'), 'error');
  }
}


/* ------------------------- shared chat wallpaper --------------------------- */

function applyWallpaper() {
  const messages = $('#messages');
  if (!messages) return;
  const conv = state.conversations.find((c) => c.id === state.activeConvId);
  const wall = conv?.settings?.wallpaper;
  messages.style.background = '';
  messages.style.backgroundImage = '';
  messages.classList.remove('with-wallpaper');
  if (!wall || wall.id === 'none') return;
  const preset = WALLPAPERS.find((w) => w.id === wall.id);
  const css = preset ? preset.css : wall.css || '';
  if (!css) return;
  messages.style.background = css;
  messages.style.backgroundAttachment = 'fixed';
  messages.classList.add('with-wallpaper');
}

async function openWallpaperPicker() {
  const conv = state.conversations.find((c) => c.id === state.activeConvId);
  if (!conv) return;
  const grid = h('div', { class: 'wall-grid' });
  for (const w of WALLPAPERS) {
    grid.append(
      h(
        'button',
        {
          class: `wall-item${conv.settings?.wallpaper?.id === w.id ? ' active' : ''}`,
          onclick: async () => {
            try {
              const res = await api.settings(conv.id, { wallpaper: { id: w.id, css: w.css } });
              conv.settings = res.settings;
              applyWallpaper();
              document.querySelector('.modal-backdrop')?.remove();
              toast('تم تحديث خلفية الدردشة للطرفين ✓');
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        },
        h('span', { class: 'wall-swatch', style: w.css ? `background:${w.css}` : 'background:var(--bg-elev-2)' }),
        h('small', { text: w.label })
      )
    );
  }
  await modal({ title: 'خلفية الدردشة (تظهر لكلا الطرفين)', body: grid, actions: [{ label: 'إغلاق', kind: 'primary', value: null }] });
}

/* ------------------- screenshot / screen recording notices ------------------ */

/** Tells the peer that a screenshot was taken (or the screen is being recorded). */
function reportPrivacyEvent(type, meta = {}) {
  if (!state.activeConvId) return;
  rt.send({ t: 'event', type, conversationId: state.activeConvId, meta });
}

function installPrivacyWatchers() {
  // screenshots: keyboard shortcuts used by Windows / macOS / Linux
  window.addEventListener('keyup', (e) => {
    const key = e.key;
    const isPrint = key === 'PrintScreen' || key === 'PrintScrn' || key === 'Snapshot';
    const macShot = e.metaKey && e.shiftKey && ['3', '4', '5'].includes(key);
    const winSnip = e.metaKey && e.shiftKey && key.toLowerCase() === 's';
    if (isPrint || macShot || winSnip) reportPrivacyEvent('screenshot', { source: 'keyboard' });
  });
  window.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + PrintScreen and Ctrl + Shift + S are captured before the OS
    if ((e.ctrlKey || e.metaKey) && (e.key === 'PrintScreen' || e.key.toLowerCase() === 'p')) {
      reportPrivacyEvent('screenshot', { source: 'keyboard' });
    }
  });
  // screen sharing started from inside the tab (getDisplayMedia)
  if (navigator.mediaDevices?.getDisplayMedia) {
    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (...args) => {
      reportPrivacyEvent('recording', { source: 'display-media' });
      const stream = await original(...args);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => reportPrivacyEvent('recording_stop'));
      return stream;
    };
  }
  // window focus loss while typing is a weak signal; ignore it on purpose to
  // avoid false positives. Detection of third party recorders is not possible
  // from a browser - the Android app uses the platform APIs instead.
}

/* -------------------------------- calls --------------------------------- */

function engineSettings() {
  const preset = QUALITY_PRESETS[state.settings.quality] || QUALITY_PRESETS.auto;
  return {
    ...preset,
    dataSaver: state.settings.dataSaver || preset.dataSaver,
    autoQuality: state.settings.autoQuality,
    audioOnlyFallback: state.settings.audioOnlyFallback,
  };
}

function newEngine() {
  const e = new CallEngine({ iceServers: state.iceServers, settings: engineSettings() });
  e.attach(rt);
  e.addEventListener('state', (ev) => updateCallUi(ev.detail));
  e.addEventListener('stats', (ev) => updateCallStats(ev.detail));
  e.addEventListener('quality', (ev) => toast(`${t('quality')}: ${ev.detail.name}`, ev.detail.reason === 'weak-network' ? 'warn' : ''));
  e.addEventListener('notice', (ev) => toast(t(ev.detail.message), ev.detail.level === 'warn' ? 'warn' : ''));
  e.addEventListener('localstream', (ev) => {
    const el = $('#local-video');
    if (el) el.srcObject = ev.detail.stream;
  });
  e.addEventListener('remotestream', (ev) => {
    const el = $('#remote-video');
    if (el) el.srcObject = ev.detail.stream;
  });
  e.addEventListener('fatal', () => toast('تعذّر استمرار المكالمة بسبب الشبكة', 'error'));
  e.addEventListener('ended', () => closeCallUi());
  e.addEventListener('state', (ev) => {
    if (ev.detail.state === 'ended') closeCallUi();
  });
  return e;
}

async function startCall(peerId, type = 'audio') {
  if (engine) return toast('أنت في مكالمة بالفعل', 'warn');
  try {
    const conv = state.conversations.find((c) => c.type === 'direct' && c.members?.some((m) => m.id === peerId));
    engine = newEngine();
    openCallUi({ type, peer: userById(peerId) || { name: 'مستخدم' }, outgoing: true });
    await engine.startOutgoing({ to: peerId, type, conversationId: conv?.id });
    rt.addEventListener('call.ringing', onRingingOnce);
    function onRingingOnce(ev) {
      if (ev.detail.to !== peerId) return;
      engine?.setCallId(ev.detail.callId);
      rt.removeEventListener('call.ringing', onRingingOnce);
      setCallStatus(ev.detail.offline ? 'لا يرد الآن (جارٍ التنبيه)' : t('calling'));
    }
  } catch (e) {
    toast(e.message || t('micDenied'), 'error');
    closeCallUi();
  }
}

function openCallUi({ type, peer, outgoing }) {
  const overlay = $('#call-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = '';
  const videoBlock =
    type === 'video'
      ? h(
          'div',
          { class: 'videos' },
          h('video', { id: 'remote-video', class: 'remote-video', autoplay: true, playsinline: true }),
          h('video', { id: 'local-video', class: 'local-video', autoplay: true, playsinline: true, muted: true, dataset: { local: '1' } })
        )
      : h(
          'div',
          { class: 'call-center' },
          h('div', { class: 'call-avatar', text: initials(peer?.name || '؟') })
        );
  if (type !== 'video') {
    overlay.append(
      h('audio', { id: 'remote-video', autoplay: true, style: 'display:none' }),
      h('audio', { id: 'local-video', muted: true, style: 'display:none' })
    );
  }

  const stats = h('div', { class: `stats-panel ${state.settings.showStats ? '' : 'hidden'}`, id: 'stats-panel' });
  const qualityBar = h('div', { class: 'quality-bar' }, h('i', { id: 'quality-fill', style: 'width:100%' }));

  overlay.append(
    h(
      'div',
      { class: 'call-ui' },
      h(
        'div',
        { class: 'call-top' },
        avatarEl(peer, true),
        h(
          'div',
          { class: 'call-info' },
          h('div', { class: 'call-name', text: peer?.name || peer?.phone || '' }),
          h('div', { class: 'call-state', id: 'call-state', text: outgoing ? t('calling') : t('connecting') })
        ),
        h('div', { class: 'call-badge', id: 'call-badge', text: type === 'video' ? t('videoCall') : t('voiceCall') })
      ),
      videoBlock,
      qualityBar,
      stats,
      h(
        'div',
        { class: 'call-controls' },
        h('button', { class: 'call-btn', id: 'btn-mute', title: t('mute'), onclick: toggleMute }, '🎤'),
        type === 'video'
          ? h('button', { class: 'call-btn', id: 'btn-cam', title: t('camera'), onclick: toggleVideo }, '🎥')
          : null,
        type === 'video' ? h('button', { class: 'call-btn', id: 'btn-flip', title: t('switchCamera'), onclick: () => engine?.switchCamera() }, '🔄') : null,
        h('button', { class: 'call-btn', id: 'btn-speaker', title: t('speaker'), onclick: toggleSpeaker }, '🔊'),
        h('button', { class: 'call-btn', id: 'btn-stats', title: t('networkStats'), onclick: toggleStats }, '📊'),
        h('button', { class: 'call-btn danger', id: 'btn-end', title: t('end'), onclick: () => engine?.hangup() }, '✕')
      )
    )
  );
  if (engine) {
    const local = $('#local-video');
    if (local && engine.localStream) local.srcObject = engine.localStream;
    const remote = $('#remote-video');
    if (remote && engine.remoteStream?.getTracks().length) remote.srcObject = engine.remoteStream;
  }
  engine?.setSpeaker(type === 'video');
}

function setCallStatus(text, warn = false) {
  const el = $('#call-state');
  if (el) el.textContent = text;
  const badge = $('#call-badge');
  if (badge) badge.classList.toggle('warn', warn);
}

function updateCallUi({ state }) {
  const labels = {
    calling: t('calling'),
    connecting: t('connecting'),
    connected: t('connected'),
    reconnecting: t('reconnecting'),
  };
  setCallStatus(labels[state] || state, state === 'reconnecting');
  if (state === 'connected') startTimer();
}

let callTimer = null;
function startTimer() {
  clearInterval(callTimer);
  const started = Date.now();
  callTimer = setInterval(() => {
    const el = $('#call-state');
    if (!el || !engine || engine.state === 'ended') return clearInterval(callTimer);
    el.textContent = `${t('connected')} · ${fmtDuration(Date.now() - started)}`;
  }, 1000);
}

function updateCallStats(s) {
  const fill = $('#quality-fill');
  if (fill) {
    fill.style.width = `${s.qualityScore}%`;
    fill.className = s.qualityScore > 65 ? '' : s.qualityScore > 35 ? 'mid' : 'low';
  }
  const panel = $('#stats-panel');
  if (!panel) return;
  panel.innerHTML = '';
  const rows = [
    [t('quality'), `${s.level || '—'} (${s.qualityScore}%)`],
    [t('bitrate'), `${s.bitrateKbps} kbps`],
    ['صوت / فيديو', `${s.audioKbps} / ${s.videoKbps} kbps`],
    [t('rtt'), `${s.rtt} ms`],
    [t('loss'), `${s.loss}%`],
    [t('resolution'), s.width ? `${s.width}×${s.height} @ ${s.fps}` : '—'],
    [t('codec'), `${s.audioCodec || '—'}${s.videoCodec ? ' / ' + s.videoCodec : ''}`],
    ['الشبكة المتاحة', `${s.availableKbps} kbps`],
  ];
  for (const [k, v] of rows) panel.append(h('div', {}, h('b', { text: k + ': ' }), h('span', { text: v })));
}

function toggleMute() {
  if (!engine) return;
  const next = !engine.muted;
  engine.setMuted(next);
  $('#btn-mute').classList.toggle('active', next);
  $('#btn-mute').textContent = next ? '🔇' : '🎤';
}
function toggleVideo() {
  if (!engine) return;
  const next = !!engine.videoSuspended;
  engine.setVideoEnabled(next);
  $('#btn-cam').classList.toggle('active', !next);
  $('#btn-cam').textContent = next ? '🎥' : '🚫';
}
function toggleSpeaker() {
  if (!engine) return;
  const next = !engine.speakerOn;
  engine.setSpeaker(next);
  $('#btn-speaker').classList.toggle('active', next);
}
function toggleStats() {
  state.settings.showStats = !state.settings.showStats;
  saveSettings();
  $('#stats-panel')?.classList.toggle('hidden', !state.settings.showStats);
}

function closeCallUi() {
  clearInterval(callTimer);
  stopRingtone();
  $('#call-overlay').classList.add('hidden');
  $('#call-overlay').innerHTML = '';
  $('#incoming-overlay').classList.add('hidden');
  $('#incoming-overlay').innerHTML = '';
  engine?.detach();
  engine = null;
  pendingIncoming = null;
  loadCalls().then(renderCalls).catch(() => {});
  loadConversations().then(renderChats).catch(() => {});
}

/* incoming */

rt.addEventListener('call.incoming', async (ev) => {
  const f = ev.detail;
  if (engine) {
    rt.send({ t: 'call.busy', callId: f.callId, to: f.from.id });
    return;
  }
  pendingIncoming = f;
  showIncoming(f);
  startRingtone();
});

function showIncoming(f) {
  const overlay = $('#incoming-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = '';
  overlay.append(
    h(
      'div',
      { class: 'call-ui' },
      h(
        'div',
        { class: 'call-top' },
        avatarEl(f.from, true),
        h(
          'div',
          { class: 'call-info' },
          h('div', { class: 'call-name', text: f.from?.name || f.from?.phone }),
          h('div', { class: 'call-state', text: f.type === 'video' ? t('incomingVideo') : t('incomingVoice') })
        )
      ),
      h('div', { class: 'call-center' }, h('div', { class: 'call-avatar', text: initials(f.from?.name || '؟') })),
      h(
        'div',
        { class: 'call-controls' },
        h('button', { class: 'call-btn danger', onclick: () => rejectIncoming(f.callId, f.from.id) }, '✕'),
        h('button', {
          class: 'call-btn ok',
          onclick: async () => {
            stopRingtone();
            try {
              engine = newEngine();
              await engine.acceptIncoming({
                callId: f.callId,
                from: f.from.id,
                type: f.type,
                sdp: f.sdp || f.offer,
                conversationId: f.conversationId,
              });
              overlay.classList.add('hidden');
              overlay.innerHTML = '';
              pendingIncoming = null;
              openCallUi({ type: f.type, peer: f.from, outgoing: false });
              if (engine.localStream) $('#local-video').srcObject = engine.localStream;
              if (engine.remoteStream?.getTracks().length) $('#remote-video').srcObject = engine.remoteStream;
            } catch (e) {
              toast(e.message || t('micDenied'), 'error');
              closeCallUi();
            }
          },
        }, '📞')
      )
    )
  );
}

function rejectIncoming(callId, from) {
  rt.send({ t: 'call.decline', callId, to: from });
  stopRingtone();
  $('#incoming-overlay').classList.add('hidden');
  $('#incoming-overlay').innerHTML = '';
  pendingIncoming = null;
}

/* --------------------------- realtime events ---------------------------- */

rt.addEventListener('frame', async (ev) => {
  const f = ev.detail;
  switch (f.t) {
    case 'ready':
      state.me = f.user;
      break;
    case 'presence':
      state.presence.set(f.userId, { online: f.online, lastSeen: f.lastSeen });
      if (state.activeConvId) renderChatHeader();
      break;
    case 'presence:state':
      for (const s of f.states || []) state.presence.set(s.userId, { online: s.online, lastSeen: s.lastSeen });
      renderContacts();
      if (state.activeConvId) renderChatHeader();
      break;
    case 'message': {
      const convId = f.message.conversationId;
      const known = state.conversations.find((c) => c.id === convId);
      if (!known) await loadConversations();
      updateConvLast(convId, f.message);
      pushMessage(convId, f.message);
      if (state.activeConvId !== convId && state.settings.sounds) beep(520, 70, 0.04);
      break;
    }
    case 'message:update': {
      const list = state.messages.get(f.message.conversationId) || [];
      const idx = list.findIndex((m) => m.id === f.message.id);
      if (idx >= 0) {
        list[idx] = f.message;
        if (state.activeConvId === f.message.conversationId) renderMessages(f.message.conversationId);
      }
      break;
    }
    case 'typing': {
      if (f.conversationId !== state.activeConvId || f.userId === state.me?.id) break;
      const el = $('#typing-indicator');
      el.classList.toggle('hidden', !f.on);
      if (f.on) el.textContent = `${f.name} ${t('typing')}`;
      break;
    }
    case 'receipt': {
      const list = state.messages.get(f.conversationId) || [];
      if (f.type === 'delivered') {
        for (const id of f.messageIds || []) {
          const m = list.find((x) => x.id === id);
          if (m && m.status === 'sent') m.status = 'delivered';
        }
      } else if (f.type === 'read') {
        for (const m of list) if (m.senderId === state.me?.id) m.status = 'read';
      }
      if (state.activeConvId === f.conversationId) renderMessages(f.conversationId);
      break;
    }
    case 'conversation':
      await loadConversations();
      renderChats();
      break;
    case 'conversation:settings': {
      const conv = state.conversations.find((c) => c.id === f.conversationId);
      if (conv) conv.settings = f.settings;
      else await loadConversations();
      if (f.conversationId === state.activeConvId) applyWallpaper();
      toast('🎨 غيّر الطرف الآخر خلفية الدردشة');
      break;
    }
    case 'conversation:keys':
      // a group key was (re)distributed: drop the cached one and reload
      E2EE.groupKeys.delete(f.conversationId);
      break;
    case 'user:key':
      // the peer reinstalled / changed device: remember the new identity key
      if (f.publicKey) E2EE.rememberPeer(f.userId, f.publicKey);
      break;
    case 'event':
      if (f.message) pushMessage(f.message.conversationId, f.message);
      if (f.type === 'screenshot') toast('📸 التقط الطرف الآخر لقطة للشاشة', 'warn');
      if (f.type === 'recording') toast('⏺️ بدأ الطرف الآخر تسجيل الشاشة', 'warn');
      if (f.type === 'recording_stop') toast('⏹️ أوقف الطرف الآخر تسجيل الشاشة');
      break;
    case 'call.end':
    case 'call.decline':
    case 'call.busy':
      if (pendingIncoming && f.callId === pendingIncoming.callId) {
        stopRingtone();
        $('#incoming-overlay').classList.add('hidden');
        pendingIncoming = null;
        loadCalls().then(renderCalls).catch(() => {});
      }
      break;
    default:
      break;
  }
});

rt.addEventListener('status', (ev) => {
  const el = $('#conn-state');
  if (el) el.textContent = ev.detail.connected ? t('online') : t('offline');
});

window.addEventListener('masingar:unauthorized', () => {
  session.clear();
  location.reload();
});

/* -------------------------------- wiring -------------------------------- */

function wireUi() {
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  $('#chat-back').addEventListener('click', () => {
    state.activeConvId = null;
    showScreen('main');
    renderChats();
  });

  $('#btn-wallpaper').addEventListener('click', openWallpaperPicker);
  $('#btn-voice-call').addEventListener('click', () => {
    const conv = state.conversations.find((c) => c.id === state.activeConvId);
    const peer = peerOf(conv);
    if (peer) startCall(peer.id, 'audio');
  });
  $('#btn-video-call').addEventListener('click', () => {
    const conv = state.conversations.find((c) => c.id === state.activeConvId);
    const peer = peerOf(conv);
    if (peer) startCall(peer.id, 'video');
  });

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    sendText();
  });
  const input = $('#input');
  input.addEventListener('input', () => {
    autoGrow(input);
    if (state.activeConvId) rt.send({ t: 'typing', conversationId: state.activeConvId, on: !!input.value });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });

  $('#btn-record').addEventListener('click', toggleRecord);
  $('#btn-attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !state.activeConvId) return;
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
    try {
      const prepared = state.e2ee ? await E2EE.encryptFile(file) : null;
      const up = await api.upload(prepared ? new File([prepared.blob], 'enc.bin', { type: 'application/octet-stream' }) : file);
      const payload = {
        t: 'media',
        m: prepared
          ? { url: up.url, k: prepared.key, n: prepared.nonce, mime: prepared.mime, name: prepared.name, size: prepared.size, kind }
          : { url: up.url, mime: file.type, name: file.name, size: file.size, kind },
      };
      const res = await deliver(state.activeConvId, payload);
      if (res.message.encrypted) decryptedCache.set(res.message.id, payload);
      pushMessage(state.activeConvId, res.message);
      updateConvLast(state.activeConvId, res.message);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });

  const emojis = ['😀','😂','❤️','👍','🙏','🔥','🎉','😍','🤔','😢','👏','✅','🌹','☕','🌟','🚀','💡','📞','📅','💰'];
  const bar = $('#emoji-bar');
  for (const em of emojis) bar.append(h('button', { type: 'button', onclick: () => (input.value += em) }, em));
  $('#btn-emoji').classList.remove('hidden');
  $('#btn-emoji').addEventListener('click', () => bar.classList.toggle('hidden'));

  $('#btn-search').addEventListener('click', async () => {
    const q = prompt('بحث بالاسم أو الرقم:');
    if (!q) return;
    try {
      const res = await api.search(q);
      toast(res.users.length ? res.users.map((u) => u.name || u.phone).join(', ') : 'لا نتائج');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  $('#btn-new').addEventListener('click', addByPhone);

  window.addEventListener('beforeunload', () => engine?.hangup());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (session.token && !rt.connected) rt.connect();
  });
  setInterval(() => {
    if (session.token && rt.ws?.readyState === 1) rt.send({ t: 'ping' });
  }, 25000);
}

function logout() {
  engine?.hangup();
  rt.close();
  session.clear();
  location.reload();
}

/* --------------------------------- start -------------------------------- */

async function boot() {
  applyTheme();
  initLogin();
  wireUi();
  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));

  if (session.token) {
    try {
      const res = await api.me();
      state.me = res.user;
      session.save(session.token, session.refreshToken, res.user);
      await enterApp();
    } catch {
      session.clear();
      showScreen('login');
    }
  } else {
    showScreen('login');
  }

  installPrivacyWatchers();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
