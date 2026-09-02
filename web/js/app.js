/* ==========================================================================
   واتساب لايت — تطبيق واتساب متكامل لدائرة صغيرة
   مظهر وتصميم وأداء وخصائص واتساب الرسمية (WhatsApp Authentic UI)
   ========================================================================== */

import { api, session, connect } from './api.js';

/* ------------------------------ أدوات عامة ------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function toast(message, kind = 'info') {
  const el = h('div', { class: 'toast ' + kind, text: message });
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 20);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2600);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return 'الآن';
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `قبل ${hr} س`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `قبل ${d} ي`;
  return new Date(ts).toLocaleDateString('ar', { month: 'short', day: 'numeric' });
}

function formatChatTime(ts) {
  const now = new Date();
  const d = new Date(ts);
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar', { month: 'short', day: 'numeric' });
}

const AVATAR_COLORS = ['#25d366', '#128c7e', '#075e54', '#34b7f1', '#e05297', '#f4a261', '#e76f51', '#8e7dbe'];
function avatar(name, size = 40) {
  const letter = (name || '؟').trim().charAt(0);
  const color = AVATAR_COLORS[[...(name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return h('span', { class: 'avatar', style: `width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.44)}px` }, letter);
}

const fmtPhone = (p) => '+' + String(p || '').replace(/(\d{3})(?=\d)/, '$1 ');

function toAsciiDigits(str) {
  return String(str ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

/* ضغط الصور في المتصفح قبل إرسالها */
async function compressImage(file) {
  const MAX_DIM = 1280;
  const LIMIT = 320 * 1024;
  try {
    if (!window.createImageBitmap) throw new Error('no-bitmap');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const hh = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hh;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, hh);
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.75));
    if (blob.size > LIMIT) blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.5));
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch {
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('تعذر قراءة الصورة'));
      fr.readAsDataURL(file);
    });
  }
}

/* --------------------------- نغمات وأصوات واتساب --------------------------- */

class WaAudioFx {
  constructor() {
    this.ctx = null;
    this.ringInterval = null;
    this.enabled = localStorage.getItem('wa_sounds') !== 'false';
  }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }
  playSend() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, this.ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.09);
    } catch { /* صامت */ }
  }
  playReceive() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.setValueAtTime(980, now + 0.07);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.16);
    } catch { /* صامت */ }
  }
  playCallRing() {
    if (!this.enabled) return;
    this.stopCallRing();
    const ringBurst = () => {
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.setValueAtTime(0.1, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.3);
        osc2.stop(now + 1.3);
      } catch { /* تجاهل */ }
    };
    ringBurst();
    this.ringInterval = setInterval(ringBurst, 3000);
  }
  stopCallRing() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }
  playEndCall() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.setValueAtTime(320, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.25);
    } catch { /* تجاهل */ }
  }
  playTone(freq = 880, dur = 0.15) {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + dur);
    } catch { /* تجاهل */ }
  }
}
const soundFx = new WaAudioFx();

/* رموز الدول لشاشة الدخول */
const COUNTRIES = [
  ['967', '+967 اليمن'], ['966', '+966 السعودية'], ['971', '+971 الإمارات'], ['968', '+968 عُمان'],
  ['974', '+974 قطر'], ['973', '+973 البحرين'], ['965', '+965 الكويت'], ['962', '+962 الأردن'],
  ['964', '+964 العراق'], ['970', '+970 فلسطين'], ['963', '+963 سوريا'], ['961', '+961 لبنان'],
  ['20', '+20 مصر'], ['249', '+249 السودان'], ['213', '+213 الجزائر'], ['212', '+212 المغرب'],
  ['216', '+216 تونس'], ['218', '+218 ليبيا'], ['90', '+90 تركيا'], ['1', '+1 أمريكا/كندا'],
  ['44', '+44 بريطانيا'], ['49', '+49 ألمانيا'], ['33', '+33 فرنسا'],
];

/* ---------------------------- حالة التطبيق ---------------------------- */

const S = {
  me: null,
  members: [],
  posts: [],
  messages: [],
  statuses: [],
  online: new Set(),
  circle: { name: 'ماسنجر لايت', total: 5 },
  tab: 'chatlist', // 'chatlist' | 'status' | 'feed' | 'members' | 'profile' | 'chat'
  unread: 0,
  typing: null, // {name, until}
  sock: null,
  headerEl: null,
  connEl: null,
  mainEl: null,
  navEl: null,
  fabEl: null,
  replyTo: null, // { id, authorName, text }
  chatBackground: null,
  menuOpen: false,
  starred: new Set(), // مجموعة معرفات الرسائل المميزة بنجمة
  pinnedMsg: null, // { id, authorName, text }
  chatFilter: 'all', // 'all' | 'unread' | 'starred' | 'groups' | 'online'
  fontSize: localStorage.getItem('wa_font_size') || 'medium',
  readReceipts: localStorage.getItem('wa_read_receipts') !== 'false',
  enterSend: localStorage.getItem('wa_enter_send') !== 'false',
  userBio: 'متوفر 🟢',
  appPin: null,
  activeCall: null,
};

/* ---------------------------- شاشة الدخول ---------------------------- */

async function renderLogin(root) {
  let circle = { name: 'ماسنجر لايت', members: 0, total: 5, joinCodeRequired: false };
  try { circle = await api('/circle'); } catch { /* لا يوجد اتصال */ }

  const country = h('select', { class: 'input code-select' },
    COUNTRIES.map(([code, label]) => h('option', { value: code, text: label })));
  country.value = '967';

  const phone = h('input', {
    class: 'input phone-input', type: 'tel', inputmode: 'tel', autocomplete: 'tel',
    placeholder: '7xxxxxxxx', dir: 'ltr',
  });

  const sendBtn = h('button', { class: 'btn primary block', text: 'التالي' });
  const joinCodeInput = h('input', { class: 'input', placeholder: 'رمز انضمام الدائرة', type: 'password' });

  const loginCard = h('div', { class: 'login-card' },
    h('div', { style: 'text-align:center;margin-bottom:20px' },
      h('div', { style: 'width:64px;height:64px;border-radius:50%;background:#25d366;color:#fff;font-size:36px;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(37,211,102,0.4);margin-bottom:10px' }, '💬'),
      h('h2', { style: 'margin:0;font-size:21px;font-weight:700;color:var(--text-main)', text: 'أدخل رقم هاتفك' }),
      h('p', { style: 'margin:6px 0 0;font-size:13.5px;color:var(--text-secondary)', text: 'سيرسل كود التحقق لإكمال الدخول إلى دائرتك.' })),
    h('div', { class: 'field-label', text: 'الدولة ورقم الهاتف' }),
    h('div', { class: 'phone-row' }, country, phone),
    circle.joinCodeRequired ? h('div', {}, h('div', { class: 'field-label', text: 'رمز الانضمام' }, joinCodeInput)) : null,
    h('div', { style: 'margin-top:18px' }, sendBtn),
    h('div', { style: 'text-align:center;margin-top:16px;font-size:12.5px;color:var(--text-muted)' },
      `الأعضاء المسجلون: ${circle.members} من ${circle.total}`)
  );

  sendBtn.onclick = async () => {
    const raw = toAsciiDigits(phone.value.trim()).replace(/[^0-9]/g, '');
    if (!raw) return toast('أدخل رقم هاتفك', 'error');
    const fullPhone = country.value + (raw.startsWith('0') ? raw.slice(1) : raw);
    sendBtn.disabled = true;
    try {
      const r = await api('/auth/request', {
        method: 'POST',
        body: { phone: fullPhone, joinCode: joinCodeInput?.value?.trim() },
      });
      renderVerify(root, fullPhone, r.code, r.isMember);
    } catch (err) {
      toast(err.message, 'error');
      sendBtn.disabled = false;
    }
  };

  root.replaceChildren(
    h('div', { class: 'login-wrap' },
      h('div', { class: 'login-header' },
        h('h1', { text: circle.name }),
        h('p', { text: 'تواصل فوري، مشفر وخفيف لدائرتك الخاصة' })),
      h('div', { class: 'login-body' }, loginCard))
  );
}

function renderVerify(root, fullPhone, sampleCode, isMember) {
  const codeInput = h('input', { class: 'input big', maxlength: '6', placeholder: '••••••', type: 'tel', dir: 'ltr' });
  const nameInput = isMember ? null : h('input', { class: 'input', placeholder: 'اسمك الظاهر (مثلاً: أحمد)', maxlength: '30' });
  const submitBtn = h('button', { class: 'btn primary block', text: 'تأكيد ودخول' });

  const card = h('div', { class: 'login-card' },
    h('div', { style: 'text-align:center;margin-bottom:16px' },
      h('h2', { style: 'margin:0;font-size:20px;font-weight:700', text: 'التحقق من الرقم' }),
      h('p', { style: 'margin:6px 0 0;font-size:13px;color:var(--text-secondary)', text: `تم إرسال كود التحقق إلى ${fmtPhone(fullPhone)}` })),
    sampleCode ? h('div', { class: 'code-box' },
      h('div', { style: 'font-size:12px;color:var(--text-secondary);margin-bottom:2px', text: 'كود التحقق الخاص بك:' }),
      h('div', { class: 'code-value', text: sampleCode })) : null,
    h('div', { class: 'field-label', text: 'أدخل كود الـ 6 أرقام' }),
    codeInput,
    nameInput ? h('div', {}, h('div', { class: 'field-label', text: 'اسمك' }), nameInput) : null,
    h('div', { style: 'margin-top:16px' }, submitBtn)
  );

  submitBtn.onclick = async () => {
    const code = toAsciiDigits(codeInput.value.trim());
    if (code.length < 4) return toast('أدخل كود التحقق', 'error');
    const name = nameInput ? nameInput.value.trim() : undefined;
    if (nameInput && (!name || name.length < 2)) return toast('أدخل اسمك', 'error');
    submitBtn.disabled = true;
    try {
      const r = await api('/auth/verify', { method: 'POST', body: { phone: fullPhone, code, name } });
      session.set(r.token);
      toast('تم تسجيل الدخول بنجاح ✓');
      boot(root);
    } catch (err) {
      toast(err.message, 'error');
      submitBtn.disabled = false;
    }
  };

  root.replaceChildren(
    h('div', { class: 'login-wrap' },
      h('div', { class: 'login-header' },
        h('h1', { text: 'ماسنجر لايت' }),
        h('p', { text: 'تواصل فوري، مشفر وخفيف لدائرتك الخاصة' })),
      h('div', { class: 'login-body' }, card))
  );
}

/* ------------------------------ إقلاع التطبيق ------------------------------ */

async function boot(root, retryCount = 0) {
  if (!session.token) {
    return renderLogin(root);
  }

  try {
    // تطبيق الوضع الداكن وتفضيلات الخط
    if (localStorage.getItem('wa_theme') === 'dark') document.body.classList.add('dark');
    const savedFont = localStorage.getItem('wa_font_size');
    if (savedFont === 'large') document.body.classList.add('font-large');
    else if (savedFont === 'small') document.body.classList.add('font-small');

    const st = await api('/state');
    if (!st || !st.me) {
      session.set('');
      return renderLogin(root);
    }

    S.me = st.me;
    S.members = st.members || [];
    S.posts = st.posts || [];
    S.messages = st.messages || [];
    S.statuses = st.statuses || [];
    S.online = new Set(st.online || []);
    S.circle = st.circle || { name: 'ماسنجر لايت', total: 5 };
    S.chatBackground = st.me?.chatBackground?.url || null;

    // استعادة الرسائل المميزة والمثبتة والبيو
    try {
      S.starred = new Set(JSON.parse(localStorage.getItem('wa_starred_' + S.me.id) || '[]'));
    } catch { S.starred = new Set(); }
    try {
      S.pinnedMsg = JSON.parse(localStorage.getItem('wa_pinned_msg') || 'null');
    } catch { S.pinnedMsg = null; }
    S.userBio = localStorage.getItem('wa_bio_' + S.me.id) || 'متوفر 🟢';
    S.appPin = localStorage.getItem('wa_pin_' + S.me.id) || null;

    setupKeyboardShortcuts();
    drawApp(root);

    S.sock = connect({ onEvent: onWsEvent, onConnectChange: (on) => {
      if (S.connEl) S.connEl.classList.toggle('hidden', on);
      if (on) syncState();
    }});
  } catch (err) {
    if (err.code === 'unauthorized' || err.status === 401) {
      session.set('');
      return renderLogin(root);
    }

    // محاولة إعادة اتصال تلقائية لمرة واحدة عند بدء التشغيل
    if (retryCount < 1) {
      setTimeout(() => boot(root, retryCount + 1), 1000);
      return;
    }

    root.replaceChildren(
      h('div', { class: 'login-wrap' },
        h('div', { class: 'login-header' },
          h('h1', { text: 'ماسنجر لايت' }),
          h('p', { text: 'تواصل فوري، مشفر وخفيف لدائرتك الخاصة' })),
        h('div', { class: 'login-body' },
          h('div', { class: 'login-card', style: 'text-align:center;padding:28px 20px' },
            h('div', { style: 'font-size:48px;margin-bottom:12px' }, '📶'),
            h('h2', { style: 'margin:0 0 8px;font-size:20px;font-weight:700;color:var(--text-main)', text: 'تعذر الاتصال بالخادم' }),
            h('p', { style: 'margin:0 0 20px;font-size:13.5px;color:var(--text-secondary);line-height:1.6', text: err.message || 'يرجى التحقق من اتصال الإنترنت أو خادم التطبيق.' }),
            h('button', {
              class: 'btn primary block',
              style: 'margin-bottom:12px;width:100%',
              text: 'إعادة المحاولة 🔄',
              onclick: () => { root.innerHTML = ''; boot(root); }
            }),
            h('button', {
              class: 'btn secondary block',
              style: 'width:100%',
              text: 'تسجيل الدخول من جديد 🚪',
              onclick: () => { session.set(''); renderLogin(root); }
            })
          )
        )
      )
    );
  }
}

/* --------------------------- رسم الهيكل الرئيسي --------------------------- */

function drawApp(root) {
  S.headerEl = h('header', { class: 'topbar', id: 'app-header' });
  S.connEl = h('div', { class: 'offline hidden', text: 'جاري إعادة الاتصال بـ واتساب...' });
  S.mainEl = h('main', { id: 'main' });
  S.navEl = h('nav', { class: 'bottomnav', id: 'app-nav' });

  root.replaceChildren(S.headerEl, S.connEl, S.mainEl, S.navEl);
  renderDefaultHeader();
  renderNav();
  switchTab('chatlist');
}

function renderDefaultHeader() {
  const isDark = document.body.classList.contains('dark');
  const menu = h('div', { class: 'wa-dropdown-menu hidden', id: 'wa-top-menu' },
    h('button', { class: 'wa-menu-item', onclick: () => { toggleDarkMode(); closeMenu(); } },
      h('span', { class: 'menu-icon', text: isDark ? '☀️' : '🌙' }),
      h('span', { text: isDark ? 'الوضع النهاري' : 'الوضع الليلي' })),
    h('button', { class: 'wa-menu-item', onclick: () => { openStarredMessages(); closeMenu(); } },
      h('span', { class: 'menu-icon', text: '⭐' }),
      h('span', { text: 'الرسائل المميزة بنجمة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { openMediaGallery(); closeMenu(); } },
      h('span', { class: 'menu-icon', text: '🖼️' }),
      h('span', { text: 'الوسائط والروابط المشتركة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { openShortcutsModal(); closeMenu(); } },
      h('span', { class: 'menu-icon', text: '⌨️' }),
      h('span', { text: 'اختصارات لوحة المفاتيح' })),
    h('button', { class: 'wa-menu-item', onclick: () => { $('#bg-file-input')?.click(); closeMenu(); } },
      h('span', { class: 'menu-icon', text: '🎨' }),
      h('span', { text: 'خلفية الشاشة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { toggleSounds(); closeMenu(); } },
      h('span', { class: 'menu-icon', text: soundFx.enabled ? '🔔' : '🔕' }),
      h('span', { text: soundFx.enabled ? 'كتم أصوات الرسائل' : 'تفعيل أصوات الرسائل' })),
    h('button', { class: 'wa-menu-item', onclick: () => { switchTab('members'); closeMenu(); } },
      h('span', { class: 'menu-icon', text: '👥' }),
      h('span', { text: 'معلومات الدائرة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { switchTab('profile'); closeMenu(); } },
      h('span', { class: 'menu-icon', text: '⚙️' }),
      h('span', { text: 'الإعدادات' })),
    h('button', { class: 'wa-menu-item', style: 'color:var(--wa-danger)', onclick: () => { logout(); closeMenu(); } },
      h('span', { class: 'menu-icon', text: '🚪' }),
      h('span', { text: 'تسجيل الخروج' }))
  );

  function closeMenu() {
    menu.classList.add('hidden');
    S.menuOpen = false;
  }
  function toggleMenu(e) {
    e.stopPropagation();
    S.menuOpen = !S.menuOpen;
    menu.classList.toggle('hidden', !S.menuOpen);
  }

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && S.menuOpen) closeMenu();
  });

  S.headerEl.replaceChildren(
    h('div', { class: 'brand' },
      h('div', { class: 'logo-wa', text: '💬' }),
      h('div', {},
        h('div', { class: 'app-title', text: S.circle.name }),
        h('div', { class: 'app-sub', id: 'app-sub', text: `${S.online.size} متصل الآن` }))),
    h('div', { class: 'topbar-actions' },
      h('button', { class: 'icon-btn', title: 'مكالمة صوتية للدائرة', onclick: () => startCall('circle', S.circle.name, false) }, '📞'),
      h('button', { class: 'icon-btn', title: 'الكاميرا', onclick: () => triggerCameraQuick() }, '📷'),
      h('button', { class: 'icon-btn', title: 'البحث الموحد (Ctrl+K)', onclick: () => openSearch() }, '🔍'),
      h('button', { class: 'icon-btn', title: 'الخيارات', onclick: toggleMenu }, '⋮'),
      menu)
  );
}

function renderChatHeader() {
  const onlineMembers = S.members.filter((m) => S.online.has(m.id));
  const onlineText = onlineMembers.length > 0
    ? `${onlineMembers.map((m) => m.name).slice(0, 2).join(', ')}${onlineMembers.length > 2 ? ` و +${onlineMembers.length - 2}` : ''} متصل`
    : `${S.members.length} أعضاء`;

  const chatMenu = h('div', { class: 'wa-dropdown-menu hidden', id: 'wa-chat-menu' },
    h('button', { class: 'wa-menu-item', onclick: () => { openStarredMessages(); closeChatMenu(); } },
      h('span', { class: 'menu-icon', text: '⭐' }),
      h('span', { text: 'الرسائل المميزة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { openMediaGallery(); closeChatMenu(); } },
      h('span', { class: 'menu-icon', text: '🖼️' }),
      h('span', { text: 'الوسائط والروابط' })),
    h('button', { class: 'wa-menu-item', onclick: () => { exportChatHistory('txt'); closeChatMenu(); } },
      h('span', { class: 'menu-icon', text: '📄' }),
      h('span', { text: 'تصدير سجل الدردشة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { $('#bg-file-input')?.click(); closeChatMenu(); } },
      h('span', { class: 'menu-icon', text: '🎨' }),
      h('span', { text: 'خلفية الشاشة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { switchTab('members'); closeChatMenu(); } },
      h('span', { class: 'menu-icon', text: '👥' }),
      h('span', { text: 'معلومات الدائرة' }))
  );

  let chatMenuOpen = false;
  function closeChatMenu() {
    chatMenu.classList.add('hidden');
    chatMenuOpen = false;
  }
  function toggleChatMenu(e) {
    e.stopPropagation();
    chatMenuOpen = !chatMenuOpen;
    chatMenu.classList.toggle('hidden', !chatMenuOpen);
  }
  document.addEventListener('click', (e) => {
    if (!chatMenu.contains(e.target) && chatMenuOpen) closeChatMenu();
  });

  S.headerEl.replaceChildren(
    h('div', { style: 'display:flex;align-items:center;gap:8px;flex:1;min-width:0' },
      h('button', { class: 'chat-head-back', onclick: () => switchTab('chatlist'), text: '→' }),
      h('div', { class: 'wa-conv-avatar' }, avatar(S.circle.name, 38)),
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'app-title', style: 'font-size:16px', text: S.circle.name }),
        h('div', { class: 'app-sub', id: 'chat-head-count', text: onlineText }))),
    h('div', { class: 'topbar-actions' },
      h('button', { class: 'icon-btn', title: 'مكالمة مرئية', onclick: () => startCall('circle', S.circle.name, true) }, '📹'),
      h('button', { class: 'icon-btn', title: 'مكالمة صوتية', onclick: () => startCall('circle', S.circle.name, false) }, '📞'),
      h('button', { class: 'icon-btn', title: 'البحث في المحادثة', onclick: () => openSearch() }, '🔍'),
      h('button', { class: 'icon-btn', title: 'خيارات المحادثة', onclick: toggleChatMenu }, '⋮'),
      chatMenu)
  );
}

function renderNav() {
  S.navEl.replaceChildren(
    navItem('chatlist', '💬', 'الدردشات'),
    navItem('status', '⭕', 'المستجدات'),
    navItem('feed', '📰', 'المنشورات'),
    navItem('members', '👥', 'المجموعة'),
    navItem('profile', '⚙️', 'الإعدادات')
  );
}

function navItem(id, icon, label) {
  const badge = h('span', { class: 'badge hidden', 'data-badge': id });
  return h('button', { class: 'navitem', 'data-tab': id, onclick: () => switchTab(id) },
    h('span', { class: 'nav-icon' }, icon, badge),
    h('span', { class: 'nav-label', text: label }));
}

function switchTab(tab) {
  S.tab = tab;
  if (tab === 'chat') { S.unread = 0; updateBadge(); }
  $$('.bottomnav .navitem').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const main = S.mainEl;

  if (tab === 'chatlist') {
    S.headerEl.style.display = '';
    renderDefaultHeader();
    main.style.display = '';
    S.navEl.style.display = '';
    renderChatList(main);
    renderFab();
  } else if (tab === 'chat') {
    S.headerEl.style.display = '';
    renderChatHeader();
    main.style.display = '';
    S.navEl.style.display = 'none';
    removeFab();
    renderChat(main);
  } else if (tab === 'status') {
    S.headerEl.style.display = '';
    renderDefaultHeader();
    main.style.display = '';
    S.navEl.style.display = '';
    removeFab();
    renderStatusScreen(main);
  } else if (tab === 'feed') {
    S.headerEl.style.display = '';
    renderDefaultHeader();
    main.style.display = '';
    S.navEl.style.display = '';
    removeFab();
    renderFeed(main);
  } else if (tab === 'members') {
    S.headerEl.style.display = '';
    renderDefaultHeader();
    main.style.display = '';
    S.navEl.style.display = '';
    removeFab();
    renderMembers(main);
  } else if (tab === 'profile') {
    S.headerEl.style.display = '';
    renderDefaultHeader();
    main.style.display = '';
    S.navEl.style.display = '';
    removeFab();
    renderProfile(main);
  }
}

function renderFab() {
  if (S.fabEl) S.fabEl.remove();
  if (S.tab === 'chatlist') {
    S.fabEl = h('button', { class: 'fab', onclick: () => switchTab('chat'), title: 'محادثة الدائرة' }, '💬');
    document.body.append(S.fabEl);
  }
}
function removeFab() {
  if (S.fabEl) { S.fabEl.remove(); S.fabEl = null; }
}

function updateBadge() {
  const badge = $$('.bottomnav .badge[data-badge="chatlist"]')[0];
  if (!badge) return;
  badge.classList.toggle('hidden', S.unread === 0);
  badge.textContent = S.unread > 9 ? '٩+' : String(S.unread);
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('wa_theme', isDark ? 'dark' : 'light');
  toast(isDark ? 'تم تفعيل الوضع الليلي 🌙' : 'تم تفعيل الوضع النهاري ☀️');
}

function triggerCameraQuick() {
  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const b64 = await compressImage(f);
      const choice = confirm('هل تريد إرسال الصورة في الدردشة؟ (إلغاء لنشرها كحالة مؤقتة)');
      if (choice) {
        await api('/messages', { method: 'POST', body: { photo: b64 } });
        switchTab('chat');
        toast('تم إرسال الصورة في الدردشة 📷');
      } else {
        await api('/status', { method: 'POST', body: { type: 'photo', media: b64, text: '' } });
        switchTab('status');
        toast('تم نشر الصورة كحالة جديدة ⭕');
      }
    } catch (err) { toast(err.message, 'error'); }
  };
  document.body.appendChild(fileInput);
  fileInput.click();
  setTimeout(() => fileInput.remove(), 1000);
}

function toggleSounds() {
  soundFx.enabled = !soundFx.enabled;
  localStorage.setItem('wa_sounds', String(soundFx.enabled));
  toast(soundFx.enabled ? 'تم تفعيل الأصوات 🔔' : 'تم كتم الأصوات 🔕');
}

function logout() {
  if (!confirm('هل تريد تسجيل الخروج من واتساب؟')) return;
  session.set('');
  if (S.sock) S.sock.close();
  location.reload();
}

/* ------------------------------- شريط المستجدات والحالات ------------------------------- */

function contactsStripWithStatus() {
  const strip = h('div', { class: 'contacts-strip' });
  
  // زر حالتي
  const myStatuses = S.statuses.filter((s) => s.author.id === S.me.id);
  const myHasStatus = myStatuses.length > 0;
  const myItem = h('div', { class: 'contact-item', onclick: () => myHasStatus ? viewMemberStatus(S.me.id) : openNewStatusModal() },
    h('div', { class: 'status-avatar-ring ' + (myHasStatus ? '' : 'none') },
      avatar(S.me.name, 48),
      h('span', { class: myHasStatus ? 'presence on' : 'status-add-badge', text: myHasStatus ? '' : '+' })),
    h('div', { class: 'contact-name', text: 'حالتي' }));
  strip.append(myItem);

  // أعضاء الدائرة
  const otherMembers = S.members.filter((m) => m.id !== S.me.id);
  for (const m of otherMembers) {
    const isOnline = S.online.has(m.id);
    const memberStatuses = S.statuses.filter((s) => s.author.id === m.id);
    const hasStatus = memberStatuses.length > 0;
    const hasUnseen = memberStatuses.some((s) => !(s.viewers || []).includes(S.me.id));

    const item = h('div', { class: 'contact-item', onclick: () => hasStatus ? viewMemberStatus(m.id) : switchTab('chat') },
      h('div', { class: 'status-avatar-ring ' + (hasStatus ? (hasUnseen ? '' : 'seen') : 'none') },
        avatar(m.name, 48),
        h('span', { class: 'presence ' + (isOnline ? 'on' : 'off') })),
      h('div', { class: 'contact-name', text: m.name }));
    strip.append(item);
  }
  return strip;
}

/* ---------------------------- قائمة المحادثات (Chats) ---------------------------- */

function renderChatList(main) {
  const onlineCount = S.online.size;
  const lastMsg = S.messages.length ? S.messages[S.messages.length - 1] : null;
  const lastTime = lastMsg ? formatChatTime(lastMsg.createdAt) : '';
  const lastText = lastMsg
    ? (lastMsg.author.id === S.me.id ? 'أنت: ' : '') + (lastMsg.text || (lastMsg.audio ? '🎙️ رسالة صوتية' : '📷 صورة'))
    : 'ابدأوا المحادثة 👋';

  const searchInput = h('input', {
    class: 'wa-search-input',
    placeholder: 'بحث في المحادثات...',
    type: 'search',
    oninput: () => filterChatList(searchInput.value.trim()),
  });

  const searchBar = h('div', { class: 'wa-search-bar' },
    h('div', { class: 'wa-search-input-wrap' },
      h('span', { class: 'wa-search-icon', text: '🔍' }),
      searchInput));

  // شريط فلترة المحادثات (Chat Filter Chips)
  const filters = [
    { id: 'all', label: 'الكل' },
    { id: 'unread', label: S.unread > 0 ? `غير مقروءة (${S.unread})` : 'غير مقروءة' },
    { id: 'starred', label: 'المميزة ⭐' },
    { id: 'groups', label: 'المجموعات' },
    { id: 'online', label: `متصل الآن (${onlineCount})` },
  ];

  const chipsBar = h('div', { class: 'chat-filter-chips' },
    ...filters.map((f) => {
      const chip = h('button', {
        class: 'filter-chip' + (S.chatFilter === f.id ? ' active' : ''),
        onclick: () => {
          S.chatFilter = f.id;
          renderChatList(S.mainEl);
        }
      }, f.label);
      return chip;
    })
  );

  // المحادثة العامة
  const groupConv = h('div', { class: 'wa-conversation', onclick: () => switchTab('chat') },
    h('div', { class: 'wa-conv-avatar' },
      avatar(S.circle.name, 50),
      h('span', { class: 'presence ' + (onlineCount > 0 ? 'on' : 'off') })),
    h('div', { class: 'wa-conv-info' },
      h('div', { class: 'wa-conv-top' },
        h('span', { class: 'wa-conv-name', text: S.circle.name }),
        h('span', { class: 'wa-conv-time' + (S.unread ? ' unread' : ''), text: lastTime })),
      h('div', { class: 'wa-conv-bottom' },
        h('span', { class: 'wa-conv-msg', text: lastText }),
        S.unread ? h('span', { class: 'wa-conv-unread', text: S.unread > 99 ? '٩٩+' : String(S.unread) }) : null)));

  // المحادثات مع كل عضو
  const otherMembers = S.members.filter((m) => m.id !== S.me.id);
  const memberRows = [];

  for (const m of otherMembers) {
    const online = S.online.has(m.id);
    const memberMsgs = S.messages.filter((msg) => msg.author.id === m.id || (msg.author.id === S.me.id && msg.replyTo?.authorName === m.name));
    const lastM = memberMsgs.length ? memberMsgs[memberMsgs.length - 1] : null;
    const lastMTime = lastM ? formatChatTime(lastM.createdAt) : '';
    const lastMText = lastM
      ? (lastM.author.id === S.me.id ? 'أنت: ' : '') + (lastM.text || (lastM.audio ? '🎙️ صوتية' : '📷 صورة'))
      : (online ? 'متصل الآن' : `آخر ظهور ${timeAgo(m.lastSeen)}`);

    const hasStarred = memberMsgs.some((msg) => S.starred.has(msg.id));

    // تطبيق الفلتر المحدد
    if (S.chatFilter === 'online' && !online) continue;
    if (S.chatFilter === 'unread' && S.unread === 0) continue;
    if (S.chatFilter === 'groups') continue; // في وضع المجموعات نظهر فقط المجموعة
    if (S.chatFilter === 'starred' && !hasStarred) continue;

    memberRows.push(h('div', { class: 'wa-conversation', onclick: () => switchTab('chat') },
      h('div', { class: 'wa-conv-avatar' },
        avatar(m.name, 50),
        h('span', { class: 'presence ' + (online ? 'on' : 'off') })),
      h('div', { class: 'wa-conv-info' },
        h('div', { class: 'wa-conv-top' },
          h('span', { class: 'wa-conv-name', text: m.name }),
          h('span', { class: 'wa-conv-time', text: lastMTime })),
        h('div', { class: 'wa-conv-bottom' },
          h('span', { class: 'wa-conv-msg', text: lastMText })))));
  }

  const showGroup = S.chatFilter !== 'online' || onlineCount > 0;
  const listItems = [];
  if (showGroup) listItems.push(groupConv);
  listItems.push(...memberRows);

  const listContainer = h('div', { class: 'wa-chat-list', id: 'chatlist-items' },
    listItems.length ? listItems : h('div', { class: 'card empty', text: 'لا توجد محادثات تطابق هذا التصنيف' })
  );

  main.replaceChildren(
    contactsStripWithStatus(),
    searchBar,
    chipsBar,
    listContainer
  );
}

function filterChatList(q) {
  const container = $('#chatlist-items');
  if (!container) return;
  if (!q) { renderChatList(S.mainEl); return; }

  const ql = q.toLowerCase();
  const matchedMsgs = S.messages.filter((m) => (m.text || '').toLowerCase().includes(ql));
  const matchedMembers = S.members.filter((m) => m.name.toLowerCase().includes(ql));

  const items = [];
  for (const m of matchedMembers) {
    items.push(h('div', { class: 'wa-conversation', onclick: () => switchTab('chat') },
      h('div', { class: 'wa-conv-avatar' }, avatar(m.name, 48)),
      h('div', { class: 'wa-conv-info' },
        h('div', { class: 'wa-conv-name', html: highlightMatch(m.name, q) }),
        h('div', { class: 'wa-conv-msg', text: fmtPhone(m.phone) }))));
  }
  for (const msg of matchedMsgs.slice(0, 10)) {
    items.push(h('div', { class: 'wa-conversation', onclick: () => switchTab('chat') },
      h('div', { class: 'wa-conv-avatar' }, avatar(msg.author.name, 44)),
      h('div', { class: 'wa-conv-info' },
        h('div', { class: 'wa-conv-top' },
          h('span', { class: 'wa-conv-name', text: msg.author.name }),
          h('span', { class: 'wa-conv-time', text: timeAgo(msg.createdAt) })),
        h('div', { class: 'wa-conv-msg', html: highlightMatch(msg.text, q) }))));
  }

  if (!items.length) {
    container.replaceChildren(h('div', { class: 'card empty', text: `لا توجد نتائج بحث لـ «${q}»` }));
  } else {
    container.replaceChildren(...items);
  }
}

/* ------------------------------- شاشة المستجدات / الحالات ------------------------------- */

function renderStatusScreen(main) {
  const myStatuses = S.statuses.filter((s) => s.author.id === S.me.id);
  const otherStatuses = S.statuses.filter((s) => s.author.id !== S.me.id);

  // تجميع حالات كل عضو
  const byMember = {};
  for (const s of otherStatuses) {
    if (!byMember[s.author.id]) byMember[s.author.id] = { author: s.author, items: [] };
    byMember[s.author.id].items.push(s);
  }

  const myItem = h('div', { class: 'status-my-item', onclick: () => myStatuses.length ? viewMemberStatus(S.me.id) : openNewStatusModal() },
    h('div', { class: 'status-avatar-ring ' + (myStatuses.length ? '' : 'none') },
      avatar(S.me.name, 52),
      h('span', { class: myStatuses.length ? 'presence on' : 'status-add-badge', text: myStatuses.length ? '' : '+' })),
    h('div', { class: 'status-info' },
      h('div', { class: 'status-title', text: 'حالتي' }),
      h('div', { class: 'status-sub', text: myStatuses.length ? `${myStatuses.length} مستجد • ${timeAgo(myStatuses[myStatuses.length-1].createdAt)}` : 'انقر لإضافة مستجد جديد' })),
    h('button', { class: 'icon-btn dark-text', onclick: (e) => { e.stopPropagation(); openNewStatusModal(); }, title: 'إضافة حالة' }, '📷'));

  const memberItems = Object.values(byMember).map(({ author, items }) => {
    const lastS = items[items.length - 1];
    const unseen = items.some((s) => !(s.viewers || []).includes(S.me.id));
    return h('div', { class: 'status-my-item', onclick: () => viewMemberStatus(author.id) },
      h('div', { class: 'status-avatar-ring ' + (unseen ? '' : 'seen') },
        avatar(author.name, 52)),
      h('div', { class: 'status-info' },
        h('div', { class: 'status-title', text: author.name }),
        h('div', { class: 'status-sub', text: `${items.length} حالة • ${timeAgo(lastS.createdAt)}` })));
  });

  main.replaceChildren(
    h('div', { class: 'status-screen-wrap' },
      myItem,
      h('div', { class: 'status-section-header', text: 'المستجدات الأخيرة' }),
      memberItems.length ? h('div', {}, ...memberItems) : h('div', { class: 'card empty', text: 'لا توجد حالات حديثة من أعضاء الدائرة' }))
  );
}

function openNewStatusModal() {
  let mode = 'text'; // 'text' | 'photo'
  let currentBg = '#008069';
  let photoData = null;

  const bgColors = ['#008069', '#128c7e', '#7b1fa2', '#c2185b', '#d32f2f', '#f57c00', '#1976d2', '#37474f'];
  const textInput = h('textarea', {
    placeholder: 'اكتب مستجداً...',
    maxlength: '400',
    style: 'width:100%;height:180px;background:transparent;border:0;color:#fff;font-size:24px;font-weight:700;text-align:center;resize:none;outline:none;line-height:1.4',
  });

  const photoInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const photoPreview = h('div', { class: 'hidden', style: 'text-align:center' });

  photoInput.addEventListener('change', async () => {
    const f = photoInput.files[0];
    if (!f) return;
    try {
      photoData = await compressImage(f);
      mode = 'photo';
      photoPreview.replaceChildren(h('img', { src: photoData, style: 'max-height:220px;border-radius:10px;margin:0 auto' }));
      photoPreview.classList.remove('hidden');
    } catch { toast('تعذر تحميل الصورة', 'error'); }
  });

  const modal = h('div', { class: 'status-viewer-modal', style: `background:${currentBg};transition:background 0.2s ease` },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px' },
      h('button', { class: 'icon-btn', text: '✕', onclick: () => modal.remove() }),
      h('div', { style: 'display:flex;gap:8px' },
        h('button', { class: 'icon-btn', title: 'تغيير اللون', onclick: () => {
          currentBg = bgColors[(bgColors.indexOf(currentBg) + 1) % bgColors.length];
          modal.style.background = currentBg;
        } }, '🎨'),
        h('button', { class: 'icon-btn', title: 'صورة', onclick: () => photoInput.click() }, '📷'))),
    h('div', { style: 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px' },
      textInput,
      photoPreview),
    h('div', { style: 'padding:16px;display:flex;justify-content:flex-end' },
      h('button', { class: 'btn primary', style: 'border-radius:50%;width:52px;height:52px;padding:0;font-size:22px', onclick: async () => {
        const text = textInput.value.trim();
        if (!text && !photoData) return toast('اكتب نصاً أو أرفق صورة', 'error');
        try {
          const r = await api('/statuses', { method: 'POST', body: { text, photo: photoData, bgColor: currentBg } });
          S.statuses.unshift(r.status);
          modal.remove();
          toast('تم نشر الحالة ✓');
          if (S.tab === 'status') renderStatusScreen(S.mainEl);
        } catch (err) { toast(err.message, 'error'); }
      } }, '➤')),
    photoInput
  );

  document.body.append(modal);
  setTimeout(() => textInput.focus(), 100);
}

function viewMemberStatus(memberId) {
  const memberStatuses = S.statuses.filter((s) => s.author.id === memberId);
  if (!memberStatuses.length) return;

  let index = 0;
  let timer = null;

  const modal = h('div', { class: 'status-viewer-modal' });
  const progContainer = h('div', { class: 'status-viewer-progress' });
  const content = h('div', { class: 'status-viewer-content' });
  const footer = h('div', { class: 'status-viewer-footer' });

  function showStatus(i) {
    if (i < 0) { index = 0; return; }
    if (i >= memberStatuses.length) { modal.remove(); return; }
    index = i;
    const item = memberStatuses[index];

    // علّم كمشاهد
    api(`/statuses/${item.id}/view`, { method: 'POST', body: {} }).catch(() => {});
    if (!item.viewers) item.viewers = [];
    if (!item.viewers.includes(S.me.id)) item.viewers.push(S.me.id);

    modal.style.background = item.bgColor || '#000000';

    // أشرطة التقدم
    progContainer.replaceChildren(...memberStatuses.map((_, idx) => {
      const fill = h('div', { class: 'status-prog-fill', style: `width:${idx < index ? '100%' : (idx === index ? '0%' : '0%')}` });
      return h('div', { class: 'status-prog-bar' }, fill);
    }));

    if (item.photo) {
      content.replaceChildren(
        h('img', { class: 'status-viewer-img', src: item.photo }),
        item.text ? h('div', { style: 'position:absolute;bottom:20px;background:rgba(0,0,0,0.6);padding:8px 16px;border-radius:18px;font-size:16px', text: item.text }) : null
      );
    } else {
      content.replaceChildren(h('div', { class: 'status-viewer-text', text: item.text }));
    }

    footer.textContent = `${item.author.name} • ${timeAgo(item.createdAt)}`;

    const currentFill = progContainer.children[index]?.firstChild;
    if (currentFill) {
      currentFill.style.transition = 'width 5s linear';
      setTimeout(() => { currentFill.style.width = '100%'; }, 20);
    }

    clearTimeout(timer);
    timer = setTimeout(() => showStatus(index + 1), 5000);
  }

  // الضغط للتنقل يميناً ويساراً
  modal.onclick = (e) => {
    const x = e.clientX;
    const w = window.innerWidth;
    if (x < w * 0.35) showStatus(index + 1); // RTL: يمين = التالي
    else if (x > w * 0.65) showStatus(index - 1);
  };

  const head = h('div', { class: 'status-viewer-head' },
    avatar(memberStatuses[0].author.name, 36),
    h('div', { style: 'flex:1' },
      h('div', { style: 'font-weight:700;font-size:15px', text: memberStatuses[0].author.name }),
      h('div', { style: 'font-size:11.5px;opacity:0.8', text: timeAgo(memberStatuses[0].createdAt) })),
    h('button', { class: 'icon-btn', text: '✕', onclick: (e) => { e.stopPropagation(); clearTimeout(timer); modal.remove(); } }));

  modal.replaceChildren(progContainer, head, content, footer);
  document.body.append(modal);
  showStatus(0);
}

/* ------------------------------- شاشة المحادثة (WhatsApp Chat) ------------------------------- */

function renderChat(main) {
  const list = h('div', { class: 'chat-list', id: 'chat-list' });
  let pendingPhoto = null;
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordStartTime = 0;
  let recordTimer = null;

  const replyBanner = h('div', { class: 'reply-preview-bar hidden', id: 'reply-banner' });
  const preview = h('div', { class: 'photo-preview small hidden' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      pendingPhoto = await compressImage(f);
      preview.replaceChildren(
        h('img', { src: pendingPhoto, alt: 'معاينة' }),
        h('button', { class: 'remove-photo', onclick: () => { pendingPhoto = null; preview.classList.add('hidden'); } }, '✕'));
      preview.classList.remove('hidden');
    } catch { toast('تعذر تحميل الصورة', 'error'); }
  });

  const input = h('input', { class: 'chat-input', maxlength: '1000', placeholder: 'اكتب رسالة...' });
  const actionBtn = h('button', { class: 'chat-action-btn', title: 'تسجيل صوتي' }, '🎙️');

  let typingSent = 0;
  input.addEventListener('input', () => {
    const val = input.value.trim();
    actionBtn.textContent = val ? '➤' : '🎙️';
    actionBtn.title = val ? 'إرسال' : 'تسجيل صوتي';

    const now = Date.now();
    if (now - typingSent > 2000) {
      typingSent = now;
      api('/typing', { method: 'POST', body: {} }).catch(() => {});
    }
  });

  /* إرسال رسالة نصية أو صورة */
  async function send() {
    const t = input.value.trim();
    if (!t && !pendingPhoto) return;
    const reply = S.replyTo;
    try {
      soundFx.playSend();
      const r = await api('/messages', {
        method: 'POST',
        body: { text: t, photo: pendingPhoto, replyTo: reply },
      });
      input.value = '';
      pendingPhoto = null;
      preview.classList.add('hidden');
      clearReply();
      actionBtn.textContent = '🎙️';
      mergeMessage(r.message);
    } catch (err) { toast(err.message, 'error'); }
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  /* تسجيل وإرسال رسالة صوتية */
  const recBar = h('div', { class: 'recording-bar hidden' });
  const recTimeLabel = h('span', { text: '0:00' });
  recBar.replaceChildren(
    h('div', { class: 'recording-timer' }, h('span', { class: 'recording-dot' }), recTimeLabel),
    h('button', { class: 'btn ghost small', style: 'color:var(--wa-danger)', onclick: cancelRecording, text: 'إلغاء' })
  );

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!isRecording) return; // تم الإلغاء
        const duration = Math.round((Date.now() - recordStartTime) / 1000);
        if (duration < 1) { toast('التسجيل قصير جداً'); return; }
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Audio = reader.result;
          try {
            soundFx.playSend();
            const r = await api('/messages', {
              method: 'POST',
              body: { audio: base64Audio, duration, replyTo: S.replyTo },
            });
            clearReply();
            mergeMessage(r.message);
          } catch (err) { toast(err.message, 'error'); }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.start();
      isRecording = true;
      recordStartTime = Date.now();
      recBar.classList.remove('hidden');
      inputPill.classList.add('hidden');
      actionBtn.classList.add('recording');
      actionBtn.textContent = '✓';

      clearInterval(recordTimer);
      recordTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - recordStartTime) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        recTimeLabel.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
      }, 500);
    } catch {
      toast('تعذر الوصول إلى الميكروفون', 'error');
    }
  }

  function stopAndSendRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
    clearInterval(recordTimer);
    recBar.classList.add('hidden');
    inputPill.classList.remove('hidden');
    actionBtn.classList.remove('recording');
    actionBtn.textContent = '🎙️';
  }

  function cancelRecording() {
    isRecording = false;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    clearInterval(recordTimer);
    recBar.classList.add('hidden');
    inputPill.classList.remove('hidden');
    actionBtn.classList.remove('recording');
    actionBtn.textContent = '🎙️';
    toast('تم إلغاء التسجيل');
  }

  actionBtn.onclick = () => {
    if (isRecording) {
      stopAndSendRecording();
    } else if (input.value.trim() || pendingPhoto) {
      send();
    } else {
      startRecording();
    }
  };

  /* قائمة المرفقات المنبثقة */
  let attachOpen = false;
  const attachPopup = h('div', { class: 'wa-attachment-popup hidden' },
    attachItem('gallery', '🖼️', 'المعرض', () => { fileInput.click(); toggleAttach(); }),
    attachItem('camera', '📷', 'الكاميرا', () => { fileInput.click(); toggleAttach(); }),
    attachItem('audio', '🎙️', 'تسجيل صوتي', () => { startRecording(); toggleAttach(); }),
    attachItem('location', '📍', 'الموقع', () => { shareLocation(); toggleAttach(); }),
    attachItem('poll', '📊', 'استطلاع', () => { toast('قريباً: استطلاعات الرأي في المجموعة'); toggleAttach(); })
  );

  function attachItem(type, icon, label, onClick) {
    return h('div', { class: 'wa-attach-item', onclick: onClick },
      h('div', { class: `wa-attach-circle ${type}`, text: icon }),
      h('span', { class: 'wa-attach-label', text: label }));
  }

  function toggleAttach() {
    attachOpen = !attachOpen;
    attachPopup.classList.toggle('hidden', !attachOpen);
  }

  function shareLocation() {
    if (!navigator.geolocation) return toast('الموقع غير مدعوم في هذا المتصفح', 'error');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      const locText = `📍 موقعي الحالي: https://maps.google.com/?q=${lat},${lng}`;
      try {
        const r = await api('/messages', { method: 'POST', body: { text: locText } });
        mergeMessage(r.message);
      } catch (err) { toast(err.message, 'error'); }
    }, () => toast('تعذر جلب الموقع الجغرافي', 'error'));
  }

  const inputPill = h('div', { class: 'chat-input-pill' },
    h('button', { class: 'icon-btn dark-text', style: 'font-size:20px;width:32px;height:32px', onclick: toggleAttach }, '📎'),
    input,
    h('button', { class: 'icon-btn dark-text', style: 'font-size:20px;width:32px;height:32px', onclick: () => fileInput.click() }, '📷')
  );

  const typingEl = h('div', { class: 'typing hidden', id: 'typing' });
  const bar = h('div', { class: 'chat-bar' },
    attachPopup,
    inputPill,
    recBar,
    actionBtn,
    fileInput
  );

  /* خلفية المحادثة */
  const bgFileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden', id: 'bg-file-input' });
  bgFileInput.addEventListener('change', async () => {
    const f = bgFileInput.files[0];
    bgFileInput.value = '';
    if (!f) return;
    try {
      const pendingBg = await compressImage(f);
      const r = await api('/chat-background', { method: 'PUT', body: { photo: pendingBg } });
      S.chatBackground = r.me?.chatBackground?.url || null;
      applyChatBg();
      toast('تم تغيير خلفية الدردشة ✓');
    } catch (err) { toast(err.message, 'error'); }
  });

  main.replaceChildren(
    h('div', { class: 'chat-wrap', id: 'chat-wrap' },
      list,
      typingEl,
      replyBanner,
      preview,
      bar,
      bgFileInput)
  );

  applyChatBg();
  drawChat(list);
  renderTyping();
  markMessagesRead();
}

function setReply(msg) {
  S.replyTo = { id: msg.id, authorName: msg.author.name, text: msg.text || (msg.audio ? '🎙️ رسالة صوتية' : '📷 صورة') };
  const banner = $('#reply-banner');
  if (banner) {
    banner.replaceChildren(
      h('div', { class: 'reply-preview-info' },
        h('div', { class: 'reply-preview-author', text: `الرد على ${msg.author.name}` }),
        h('div', { class: 'reply-preview-text', text: S.replyTo.text })),
      h('button', { class: 'icon-btn dark-text', text: '✕', onclick: clearReply })
    );
    banner.classList.remove('hidden');
  }
}

function clearReply() {
  S.replyTo = null;
  const banner = $('#reply-banner');
  if (banner) banner.classList.add('hidden');
}

function drawChat(container) {
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180;
  if (!S.messages.length) {
    container.replaceChildren(
      h('div', { class: 'chat-encrypted-badge', text: '🔒 الرسائل والوسائط في هذه الدائرة مشفرة تماماً ومحفوظة بينكم فقط.' }),
      h('div', { class: 'card empty', text: 'لا رسائل بعد 👋 اكتب أول رسالة لبدء المحادثة.' })
    );
    return;
  }

  const items = [];

  // شريط الرسالة المثبتة في أعلى الدردشة
  if (S.pinnedMsg) {
    const pinnedBar = h('div', {
      class: 'pinned-message-top-bar',
      style: 'background:var(--bg-card);border:1px solid var(--wa-green);border-radius:8px;padding:8px 12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;cursor:pointer;box-shadow:var(--shadow-sm)',
      onclick: () => {
        const targetEl = $(`#msg-bubble-${S.pinnedMsg.id}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.add('highlight-pulse');
          setTimeout(() => targetEl.classList.remove('highlight-pulse'), 2000);
        } else {
          toast('الرسالة المثبتة قديمة أو غير محملة');
        }
      }
    },
      h('div', { style: 'display:flex;align-items:center;gap:8px;overflow:hidden' },
        h('span', { style: 'font-size:18px' }, '📌'),
        h('div', { style: 'display:flex;flex-direction:column;overflow:hidden' },
          h('span', { style: 'font-size:11.5px;color:var(--wa-green);font-weight:700' }, `رسالة مثبتة • ${S.pinnedMsg.authorName}`),
          h('span', { style: 'font-size:13px;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, S.pinnedMsg.text))
      ),
      h('button', {
        class: 'icon-btn dark-text',
        style: 'font-size:14px;width:24px;height:24px',
        title: 'إلغاء التثبيت',
        onclick: (e) => {
          e.stopPropagation();
          S.pinnedMsg = null;
          localStorage.removeItem('wa_pinned_msg');
          toast('تم إلغاء تثبيت الرسالة');
          drawChat(container);
        }
      }, '✕')
    );
    items.push(pinnedBar);
  }

  items.push(h('div', { class: 'chat-encrypted-badge', text: '🔒 الرسائل والوسائط في هذه الدائرة مشفرة تماماً ومحفوظة بينكم فقط.' }));

  let lastDateStr = '';
  for (const m of S.messages) {
    const dStr = new Date(m.createdAt).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
    if (dStr !== lastDateStr) {
      items.push(h('div', { class: 'chat-date-separator', text: dStr }));
      lastDateStr = dStr;
    }
    items.push(chatBubble(m));
  }

  container.replaceChildren(...items);
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

function readTick(m) {
  if (m.author.id !== S.me.id) return null;
  const readBy = m.readBy || [m.author.id];
  const othersCount = S.members.filter((x) => x.id !== S.me.id).length;
  const readOthers = readBy.filter((id) => id !== S.me.id).length;
  if (readOthers === 0) return h('span', { class: 'read-tick tick-sent', title: 'تم الإرسال', text: '✓' });
  if (readOthers < othersCount) return h('span', { class: 'read-tick tick-delivered', title: 'تم التوصيل', text: '✓✓' });
  return h('span', { class: 'read-tick tick-read', title: 'مقروءة', text: '✓✓' });
}

  /* مشغل الملاحظات الصوتية (WhatsApp Voice Note Audio Player) مع التحكم بالسرعة */
function audioMessagePlayer(audio) {
  const player = h('div', { class: 'wa-audio-player' });
  const playBtn = h('button', { class: 'wa-audio-play-btn', text: '▶' });
  const durationLabel = h('span', { text: `${Math.floor(audio.duration / 60)}:${audio.duration % 60 < 10 ? '0' : ''}${audio.duration % 60}` });

  let speedRate = 1;
  const speedBtn = h('button', {
    class: 'voice-speed-pill',
    title: 'سرعة التشغيل',
    text: '1x',
    onclick: (e) => {
      e.stopPropagation();
      if (speedRate === 1) speedRate = 1.5;
      else if (speedRate === 1.5) speedRate = 2;
      else speedRate = 1;
      speedBtn.textContent = `${speedRate}x`;
      if (sound) sound.playbackRate = speedRate;
    }
  });

  const waveform = h('div', { class: 'wa-audio-waveform' });
  const barCount = 24;
  const bars = [];
  for (let i = 0; i < barCount; i++) {
    const height = Math.floor(Math.sin((i / barCount) * Math.PI) * 16 + 6);
    const bar = h('div', { class: 'wa-audio-bar', style: `height:${height}px` });
    bars.push(bar);
    waveform.append(bar);
  }

  let sound = null;
  let isPlaying = false;

  playBtn.onclick = () => {
    if (isPlaying) {
      if (sound) sound.pause();
      isPlaying = false;
      playBtn.textContent = '▶';
    } else {
      if (!sound) {
        sound = new Audio(audio.url);
        sound.playbackRate = speedRate;
        sound.ontimeupdate = () => {
          const ratio = sound.currentTime / (sound.duration || audio.duration);
          const playedIndex = Math.floor(ratio * barCount);
          bars.forEach((b, idx) => b.classList.toggle('played', idx <= playedIndex));
          const rem = Math.max(0, Math.floor((sound.duration || audio.duration) - sound.currentTime));
          durationLabel.textContent = `${Math.floor(rem / 60)}:${rem % 60 < 10 ? '0' : ''}${rem % 60}`;
        };
        sound.onended = () => {
          isPlaying = false;
          playBtn.textContent = '▶';
          bars.forEach((b) => b.classList.remove('played'));
          durationLabel.textContent = `${Math.floor(audio.duration / 60)}:${audio.duration % 60 < 10 ? '0' : ''}${audio.duration % 60}`;
        };
      }
      sound.play().then(() => {
        isPlaying = true;
        playBtn.textContent = '❚❚';
      }).catch(() => toast('تعذر تشغيل التسجيل الصوتي'));
    }
  };

  player.replaceChildren(
    h('div', { class: 'wa-audio-avatar' }, avatar('🎙️', 36)),
    playBtn,
    h('div', { class: 'wa-audio-body' },
      waveform,
      h('div', { class: 'wa-audio-meta' }, durationLabel, speedBtn, h('span', { text: 'صوتية' })))
  );
  return player;
}

function chatBubble(m) {
  const mine = m.author.id === S.me.id;
  const reactions = m.reactions || {};
  const activeEmojis = Object.keys(reactions);
  const isStarred = S.starred.has(m.id);
  const isPinned = S.pinnedMsg?.id === m.id;

  // شريط ردود الفعل المنبثق
  let popover = null;
  function showReactions(e) {
    e.stopPropagation();
    if (popover) { popover.remove(); popover = null; return; }
    popover = h('div', { class: 'reactions-popover' },
      ...['👍', '❤️', '😂', '😮', '😢', '🙏'].map((em) => h('button', {
        class: 'reaction-btn',
        text: em,
        onclick: async () => {
          try {
            await api(`/messages/${m.id}/react`, { method: 'POST', body: { emoji: em } });
          } catch (err) { toast(err.message, 'error'); }
          popover.remove();
          popover = null;
        }
      }))
    );
    bubbleWrap.append(popover);
    setTimeout(() => {
      document.addEventListener('click', function closeReaction() {
        if (popover) { popover.remove(); popover = null; }
        document.removeEventListener('click', closeReaction);
      });
    }, 20);
  }

  // قائمة الإجراءات السريعة على الرسالة
  let msgMenu = null;
  function showMessageMenu(e) {
    e.stopPropagation();
    if (msgMenu) { msgMenu.remove(); msgMenu = null; return; }

    msgMenu = h('div', { class: 'wa-dropdown-menu', style: 'position:absolute;top:28px;left:4px;z-index:90;min-width:160px;box-shadow:var(--shadow-lg)' },
      h('button', { class: 'wa-menu-item', onclick: () => { setReply(m); msgMenu.remove(); } },
        h('span', { class: 'menu-icon', text: '↩️' }),
        h('span', { text: 'رد على الرسالة' })),
      h('button', { class: 'wa-menu-item', onclick: () => { toggleStar(m.id); msgMenu.remove(); } },
        h('span', { class: 'menu-icon', text: isStarred ? '⭐' : '☆' }),
        h('span', { text: isStarred ? 'إزالة النجمة' : 'تمييز بنجمة' })),
      h('button', { class: 'wa-menu-item', onclick: () => { togglePin(m); msgMenu.remove(); } },
        h('span', { class: 'menu-icon', text: '📌' }),
        h('span', { text: isPinned ? 'إلغاء التثبيت' : 'تثبيت في الأعلى' })),
      m.text ? h('button', { class: 'wa-menu-item', onclick: () => { copyToClipboard(m.text); msgMenu.remove(); } },
        h('span', { class: 'menu-icon', text: '📋' }),
        h('span', { text: 'نسخ النص' })) : null,
      mine ? h('button', { class: 'wa-menu-item', style: 'color:var(--wa-danger)', onclick: () => { deleteMessage(m.id); msgMenu.remove(); } },
        h('span', { class: 'menu-icon', text: '🗑️' }),
        h('span', { text: 'حذف الرسالة' })) : null
    );

    bubbleWrap.append(msgMenu);
    setTimeout(() => {
      document.addEventListener('click', function closeMsgM() {
        if (msgMenu) { msgMenu.remove(); msgMenu = null; }
        document.removeEventListener('click', closeMsgM);
      });
    }, 20);
  }

  // كبسولات التفاعلات الموجودة
  const reactionPills = activeEmojis.length ? h('div', { class: 'bubble-reactions', onclick: showReactions },
    ...activeEmojis.map((em) => h('span', { text: `${em} ${reactions[em].length > 1 ? reactions[em].length : ''}` }))) : null;

  // اقتباس الرد إن وجد
  const quoteBox = m.replyTo ? h('div', { class: 'quote-reply-box' },
    h('div', { class: 'quote-reply-author', text: m.replyTo.authorName }),
    h('div', { class: 'quote-reply-text', text: m.replyTo.text })) : null;

  const bubbleWrap = h('div', { class: 'chat-bubble ' + (mine ? 'me' : 'them') + (isPinned ? ' is-pinned' : ''), id: `msg-bubble-${m.id}` },
    mine ? null : h('div', { class: 'bubble-author', text: m.author.name }),
    quoteBox,
    m.text ? h('div', { class: 'bubble-text', text: m.text }) : null,
    m.photo ? h('img', { class: 'bubble-photo', src: m.photo, alt: 'صورة', loading: 'lazy', onclick: () => openPhotoLightbox(m.photo) }) : null,
    m.audio ? audioMessagePlayer(m.audio) : null,
    h('div', { class: 'bubble-footer' },
      isStarred ? h('span', { class: 'bubble-star-icon', title: 'مميزة بنجمة' }, '⭐') : null,
      isPinned ? h('span', { title: 'رسالة مثبتة', style: 'font-size:11px' }, '📌') : null,
      h('span', { class: 'bubble-time', text: timeAgo(m.createdAt) }),
      readTick(m)),
    h('div', { style: 'position:absolute;top:4px;left:4px;display:flex;gap:2px' },
      h('div', { class: 'bubble-actions-trigger', onclick: showReactions, title: 'تفاعل' }, '😊'),
      h('div', { class: 'bubble-actions-trigger', onclick: showMessageMenu, title: 'خيارات الرسالة' }, '⋮')
    ),
    reactionPills
  );

  const row = h('div', { class: 'bubble-row ' + (mine ? 'mine' : 'theirs') },
    mine ? null : avatar(m.author.name, 30),
    bubbleWrap
  );

  // النقر المزدوج للرد السريع
  bubbleWrap.addEventListener('dblclick', () => setReply(m));

  return row;
}

function renderTyping() {
  const el = $('#typing');
  if (!el) return;
  const t = S.typing;
  if (t && Date.now() < t.until) {
    el.classList.remove('hidden');
    el.replaceChildren(
      h('span', { class: 'typing-dots' }, h('span'), h('span'), h('span')),
      ` ${t.name} يكتب الآن...`);
    setTimeout(renderTyping, t.until - Date.now() + 100);
  } else {
    el.classList.add('hidden');
  }
}

async function markMessagesRead() {
  const unreadMsgs = S.messages.filter((m) => m.author.id !== S.me.id && !(m.readBy || []).includes(S.me.id));
  for (const m of unreadMsgs) {
    api(`/messages/${m.id}/read`, { method: 'POST', body: {} }).catch(() => {});
  }
}

function applyChatBg() {
  const wrap = $('#chat-wrap');
  if (!wrap) return;
  if (S.chatBackground) {
    wrap.style.backgroundImage = `url(${S.chatBackground})`;
    wrap.classList.add('has-bg');
  } else {
    wrap.style.backgroundImage = '';
    wrap.classList.remove('has-bg');
  }
}

/* ------------------------------- المنشورات العامة للمجموعة (Community Feed) ------------------------------- */

let feedState = {
  searchQuery: '',
  selectedMood: '',
};

function renderFeed(main) {
  const frag = document.createDocumentFragment();

  // 1. شريط نشاط الأعضاء المتصلين
  frag.appendChild(contactsStripWithStatus());

  const feedContainer = h('div', { class: 'community-feed-wrap' });

  // 2. شريط البحث في المنشورات
  const searchInput = h('input', {
    class: 'feed-search-input',
    type: 'text',
    placeholder: '🔍 بحث في المنشورات وأسماء الأعضاء...',
    value: feedState.searchQuery,
  });
  searchInput.addEventListener('input', () => {
    feedState.searchQuery = searchInput.value.toLowerCase().trim();
    const list = $('#community-posts-list');
    if (list) drawPosts(list);
  });

  const searchCard = h('div', { class: 'feed-search-box' }, searchInput);
  feedContainer.appendChild(searchCard);

  // 3. بطاقة إنشاء منشور جديد
  feedContainer.appendChild(renderCommunityComposer());

  // 4. قائمة المنشورات
  const list = h('div', { id: 'community-posts-list', class: 'posts-list' });
  drawPosts(list);
  feedContainer.appendChild(list);

  frag.appendChild(feedContainer);
  main.replaceChildren(frag);
}

function renderCommunityComposer() {
  let pendingPhoto = null;

  const authorAvatarEl = avatar(S.me.name, 40);
  const text = h('textarea', {
    class: 'composer-textarea',
    rows: '3',
    maxlength: '2000',
    placeholder: `اكتب منشوراً يظهر لجميع أعضاء التطبيق يا ${S.me.name}...`,
  });

  const photoPreview = h('div', { class: 'photo-preview hidden' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      pendingPhoto = await compressImage(f);
      photoPreview.replaceChildren(
        h('img', { src: pendingPhoto, alt: 'معاينة الصورة' }),
        h('button', { class: 'remove-photo', title: 'إزالة الصورة', onclick: () => { pendingPhoto = null; photoPreview.classList.add('hidden'); } }, '✕')
      );
      photoPreview.classList.remove('hidden');
    } catch { toast('تعذر تحميل الصورة', 'error'); }
  });

  const moodTag = h('span', { class: 'composer-mood-badge hidden' });

  const moodModal = () => {
    const moods = [
      { label: 'سعيد', emoji: '😊' },
      { label: 'متحمس', emoji: '🔥' },
      { label: 'فخور', emoji: '🌟' },
      { label: 'نشيط', emoji: '💪' },
      { label: 'شاكر وممتن', emoji: '🙏' },
      { label: 'يحتفل', emoji: '🎉' },
      { label: 'هادئ ومسترخي', emoji: '☕' },
      { label: 'مشغول بالعمل', emoji: '💼' },
    ];
    const modal = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === modal) modal.remove(); } },
      h('div', { class: 'modal-box', style: 'max-width:340px' },
        h('h3', { style: 'margin-bottom:12px;font-size:16px', text: 'كيف تشعر أو ما هو نشاطك اليوم؟' }),
        h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' },
          ...moods.map((m) => h('button', {
            class: 'btn ghost small',
            style: 'text-align:right;justify-content:flex-start;gap:6px',
            onclick: () => {
              feedState.selectedMood = `${m.emoji} ${m.label}`;
              moodTag.textContent = `— يشعر بـ ${feedState.selectedMood}`;
              moodTag.classList.remove('hidden');
              modal.remove();
              toast(`تم اختيار الشعور: ${m.label} ${m.emoji}`);
            }
          }, `${m.emoji} ${m.label}`))),
        h('div', { style: 'display:flex;gap:8px;margin-top:12px' },
          h('button', { class: 'btn ghost small', style: 'flex:1', onclick: () => {
            feedState.selectedMood = '';
            moodTag.classList.add('hidden');
            modal.remove();
          }, text: 'إزالة الشعور' }),
          h('button', { class: 'btn secondary small', style: 'flex:1', onclick: () => modal.remove(), text: 'إلغاء' }))
      )
    );
    document.body.appendChild(modal);
  };

  const submitBtn = h('button', { class: 'btn primary publish-btn', text: 'نشر للجميع' });
  submitBtn.onclick = async () => {
    let t = text.value.trim();
    if (feedState.selectedMood) {
      t = (t ? t + '\n\n' : '') + `— يشعر بـ ${feedState.selectedMood}`;
    }
    if (!t && !pendingPhoto) {
      toast('اكتب شيئاً أو أرفق صورة لنشر المنشور', 'error');
      return;
    }
    submitBtn.disabled = true;
    try {
      const r = await api('/posts', { method: 'POST', body: { text: t, photo: pendingPhoto } });
      text.value = '';
      pendingPhoto = null;
      feedState.selectedMood = '';
      moodTag.classList.add('hidden');
      photoPreview.classList.add('hidden');
      mergePost(r.post);
      toast('تم نشر المنشور لجميع الأعضاء بنجاح! 📢');
      const list = $('#community-posts-list');
      if (list) drawPosts(list);
    } catch (err) { toast(err.message, 'error'); }
    finally { submitBtn.disabled = false; }
  };

  const composerActions = h('div', { class: 'composer-actions-bar' },
    h('div', { class: 'composer-tools' },
      h('button', { class: 'tool-chip', onclick: () => fileInput.click() },
        h('span', { text: '🖼️ صورة' })),
      h('button', { class: 'tool-chip', onclick: moodModal },
        h('span', { text: '😃 شعور / نشاط' })),
      moodTag
    ),
    submitBtn
  );

  return h('div', { class: 'community-composer-card' },
    h('div', { class: 'composer-top-row' },
      authorAvatarEl,
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'composer-author-name', text: S.me.name }),
        h('div', { class: 'composer-scope-tag', text: '🌐 منشور عام لجميع مستخدمي التطبيق' }))
    ),
    text,
    photoPreview,
    composerActions,
    fileInput
  );
}

function drawPosts(container) {
  let posts = S.posts;
  if (feedState.searchQuery) {
    posts = posts.filter((p) =>
      p.text.toLowerCase().includes(feedState.searchQuery) ||
      p.author.name.toLowerCase().includes(feedState.searchQuery)
    );
  }

  if (!posts.length) {
    container.replaceChildren(
      h('div', { class: 'feed-empty-state' },
        h('div', { class: 'feed-empty-icon', text: '📰' }),
        h('div', { class: 'feed-empty-title', text: feedState.searchQuery ? 'لم يتم العثور على نتائج بحث' : 'لا توجد منشورات حتى الآن' }),
        h('p', { class: 'feed-empty-desc', text: feedState.searchQuery ? 'جرب البحث بكلمات أخرى' : 'كن أول من يشارك منشوراً أو صورة ليراها جميع أعضاء التطبيق!' }))
    );
    return;
  }

  container.replaceChildren(...posts.map((p) => communityPostCard(p)));
}

function communityPostCard(p) {
  const mine = p.author.id === S.me.id;
  const isOnline = S.online.has(p.author.id);
  const liked = p.likes.includes(S.me.id);

  let commentsOpen = false;
  const commentBody = h('div', { class: 'post-comments-container hidden' });
  const commentInput = h('input', { class: 'post-comment-input', maxlength: '500', placeholder: 'اكتب تعليقاً على هذا المنشور...' });

  const sendComment = async () => {
    const t = commentInput.value.trim();
    if (!t) return;
    try {
      await api(`/posts/${p.id}/comments`, { method: 'POST', body: { text: t } });
      commentInput.value = '';
    } catch (err) { toast(err.message, 'error'); }
  };
  commentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendComment(); });

  function redrawComments() {
    commentBody.replaceChildren(
      h('div', { class: 'comments-list' },
        ...p.comments.map((c) =>
          h('div', { class: 'comment-row' },
            avatar(c.author.name, 32),
            h('div', { class: 'comment-bubble' },
              h('div', { class: 'comment-bubble-head' },
                h('b', { text: c.author.id === S.me.id ? `${c.author.name} (أنت)` : c.author.name }),
                h('span', { class: 'comment-time', text: timeAgo(c.createdAt) })),
              h('div', { class: 'comment-bubble-text', text: c.text }))
          ))),
      h('div', { class: 'comment-composer-inline' },
        avatar(S.me.name, 30),
        commentInput,
        h('button', { class: 'btn primary small send-comment-btn', onclick: sendComment, text: 'إرسال' }))
    );
  }
  redrawComments();

  const likeBtn = h('button', {
    class: 'post-action-btn' + (liked ? ' active-like' : ''),
    onclick: async (e) => {
      e.stopPropagation();
      try {
        await api(`/posts/${p.id}/like`, { method: 'POST' });
      } catch (err) { toast(err.message, 'error'); }
    },
  },
    h('span', { class: 'action-icon', text: liked ? '❤️' : '🤍' }),
    h('span', { text: liked ? 'أعجبني' : 'إعجاب' }),
    p.likes.length > 0 ? h('span', { class: 'likes-pill', text: String(p.likes.length) }) : null
  );

  const commentBtn = h('button', {
    class: 'post-action-btn',
    onclick: () => {
      commentsOpen = !commentsOpen;
      commentBody.classList.toggle('hidden', !commentsOpen);
      if (commentsOpen) commentInput.focus();
    }
  },
    h('span', { class: 'action-icon', text: '💬' }),
    h('span', { text: 'التعليقات' }),
    p.comments.length > 0 ? h('span', { class: 'comments-pill', text: String(p.comments.length) }) : null
  );

  const deleteBtn = mine ? h('button', {
    class: 'post-delete-btn',
    title: 'حذف منشوري',
    onclick: async () => {
      if (!confirm('هل أنت متأكد من حذف هذا المنشور؟')) return;
      try {
        await api(`/posts/${p.id}`, { method: 'DELETE' });
        toast('تم حذف المنشور بنجاح');
      } catch (err) { toast(err.message, 'error'); }
    }
  }, '🗑️') : null;

  return h('div', { class: 'community-post-card' },
    h('div', { class: 'post-header-row' },
      h('div', { style: 'position:relative' },
        avatar(p.author.name, 42),
        h('span', { class: 'presence ' + (isOnline ? 'on' : 'off') })),
      h('div', { class: 'post-author-meta' },
        h('div', { class: 'author-name-line' },
          h('b', { text: mine ? `${p.author.name} (أنت)` : p.author.name }),
          mine ? h('span', { class: 'author-badge-mine', text: 'كاتب المنشور' }) : null),
        h('div', { class: 'post-timestamp-line' },
          h('span', { text: timeAgo(p.createdAt) }),
          h('span', { text: ' • 🌐 مرئي للجميع' }))),
      deleteBtn
    ),
    p.text ? h('div', { class: 'community-post-text', text: p.text }) : null,
    p.photo ? h('div', { class: 'community-post-photo-wrap' },
      h('img', {
        class: 'community-post-photo',
        src: p.photo,
        alt: 'صورة المنشور',
        loading: 'lazy',
        onclick: () => {
          const imgModal = h('div', { class: 'modal-overlay', onclick: () => imgModal.remove() },
            h('img', { src: p.photo, style: 'max-width:92vw;max-height:88vh;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5)' }));
          document.body.appendChild(imgModal);
        }
      })) : null,
    h('div', { class: 'post-footer-actions' }, likeBtn, commentBtn),
    commentBody
  );
}

/* ------------------------------- الأعضاء ------------------------------- */

function renderMembers(main) {
  const seatsLeftCount = Math.max(0, S.circle.total - S.members.length);
  const rows = h('div', { id: 'member-rows' });

  main.replaceChildren(
    contactsStripWithStatus(),
    h('div', { class: 'members-wrap', style: 'padding:12px 14px' },
      h('div', { class: 'card circle-card', style: 'border-radius:10px;text-align:center;padding:18px;background:var(--bg-card);box-shadow:var(--shadow-sm);margin-bottom:12px' },
        h('div', { style: 'font-weight:700;font-size:16px', text: `مجموعة: ${S.circle.name}` }),
        h('div', { style: 'font-size:36px;font-weight:900;color:var(--wa-green);margin:6px 0' }, `${S.members.length} / ${S.circle.total}`),
        h('p', { class: 'hint', text: seatsLeftCount > 0
          ? `مقاعد متاحة للانضمام: ${seatsLeftCount} — يظهر اسم ورقم كل من يسجل هنا تلقائياً.`
          : 'الدائرة مكتملة — لا يمكن لأحد جديد التسجيل.' })),

      h('div', { class: 'card', style: 'background:var(--bg-card);border-radius:10px;padding:12px;box-shadow:var(--shadow-sm)' },
        h('div', { class: 'section-title', style: 'font-weight:700;color:var(--text-secondary);margin-bottom:8px', text: 'أعضاء الدائرة' }),
        rows))
  );

  drawMemberRows(rows);
}

function drawMemberRows(container) {
  container.replaceChildren(...S.members.map((m) => {
    const isMe = m.id === S.me.id;
    const online = S.online.has(m.id);
    return h('div', { class: 'member-row' },
      h('span', { class: 'avatar-wrap', onclick: () => switchTab('chat') },
        avatar(m.name, 44),
        h('span', { class: 'presence ' + (online ? 'on' : 'off') })),
      h('div', { class: 'member-info', onclick: () => switchTab('chat') },
        h('div', { class: 'member-name' },
          h('b', { text: isMe ? 'أنت' : m.name }),
          isMe ? h('span', { class: 'you-tag', text: 'أنت' }) : null),
        h('div', { class: 'member-phone', dir: 'ltr', text: fmtPhone(m.phone) }),
        h('div', { class: 'member-sub', style: online ? 'color:var(--wa-green)' : '',
          text: online ? '🟢 متصل الآن' : `آخر ظهور ${timeAgo(m.lastSeen)}` })),
      !isMe ? h('div', { style: 'display:flex;align-items:center;gap:6px;margin-right:auto' },
        h('button', {
          class: 'icon-btn',
          title: `مكالمة صوتية مع ${m.name}`,
          onclick: (e) => { e.stopPropagation(); startCall(m.id, m.name, false); }
        }, '📞'),
        h('button', {
          class: 'icon-btn',
          title: `مكالمة فيديو مع ${m.name}`,
          onclick: (e) => { e.stopPropagation(); startCall(m.id, m.name, true); }
        }, '📹')
      ) : h('div', { class: 'member-since', text: new Date(m.createdAt).toLocaleDateString('ar') })
    );
  }));
}

/* ------------------------------- الإعدادات الشاملة والبروفايل (Settings Hub) ------------------------------- */

function renderProfile(main) {
  const online = S.online.has(S.me.id);
  const isDark = document.body.classList.contains('dark');

  // تعديل الاسم
  const nameInput = h('input', { class: 'input', maxlength: '30', value: S.me.name, placeholder: 'اسمك المستعار' });
  const saveNameBtn = h('button', {
    class: 'btn primary small',
    text: 'حفظ الاسم',
    onclick: async () => {
      const v = nameInput.value.trim();
      if (v.length < 2) return toast('الاسم قصير جداً', 'error');
      try {
        await api('/me', { method: 'PUT', body: { name: v } });
        S.me.name = v;
        toast('تم تحديث الاسم بنجاح ✓');
        renderProfile(main);
      } catch (err) { toast(err.message, 'error'); }
    },
  });

  // تعديل الحالة الشخصية (Bio)
  const bioInput = h('input', { class: 'input', maxlength: '60', value: S.userBio, placeholder: 'اكتب حالتك أو اختر حالة جاهزة...' });
  const bioPresets = ['متوفر 🟢', 'مشغول 💼', 'في اجتماع 📅', 'في النادي الرياضي 💪', 'نائم 😴', 'في العمل 💻', 'أحب واتساب ❤️'];
  const bioChips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' },
    ...bioPresets.map((b) => h('button', {
      class: 'filter-chip small' + (S.userBio === b ? ' active' : ''),
      onclick: () => {
        bioInput.value = b;
        S.userBio = b;
        localStorage.setItem('wa_bio_' + S.me.id, b);
        toast(`تم تعيين الحالة: ${b}`);
        renderProfile(main);
      }
    }, b))
  );

  const saveBioBtn = h('button', {
    class: 'btn secondary small',
    text: 'حفظ الحالة',
    onclick: () => {
      const v = bioInput.value.trim() || 'متوفر 🟢';
      S.userBio = v;
      localStorage.setItem('wa_bio_' + S.me.id, v);
      toast('تم حفظ الحالة الشخصية ✓');
      renderProfile(main);
    }
  });

  // ألوان خلفيات الدردشة الجاهزة
  const presetWallpapers = [
    { name: 'الافتراضية', color: 'var(--wa-chat-bg)' },
    { name: 'كلاسيكي فاتح', color: '#efeae2' },
    { name: 'أخضر نعناعي', color: '#dcf8c6' },
    { name: 'أزرق هادئ', color: '#e1f5fe' },
    { name: 'وردي لطيف', color: '#fce4ec' },
    { name: 'رمادي ليلي', color: '#111b21' },
    { name: 'كحلي داكن', color: '#0b141a' },
    { name: 'عنابي فاخر', color: '#2d132c' },
  ];

  const wallpaperPalette = h('div', { class: 'wallpaper-swatches-grid', style: 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0' },
    ...presetWallpapers.map((w) => h('button', {
      class: 'wallpaper-swatch',
      title: w.name,
      style: `width:36px;height:36px;border-radius:50%;background:${w.color};border:2px solid var(--border-subtle);cursor:pointer;transition:transform 0.15s`,
      onclick: () => {
        const wrap = $('#chat-wrap');
        if (wrap) {
          wrap.style.backgroundImage = 'none';
          wrap.style.backgroundColor = w.color;
        }
        localStorage.setItem('wa_preset_bg', w.color);
        toast(`تم تطبيق خلفية: ${w.name} 🎨`);
      }
    }))
  );

  // حجم الخط
  const fontSizes = [
    { id: 'small', label: 'صغير' },
    { id: 'medium', label: 'متوسط (افتراضي)' },
    { id: 'large', label: 'كبير' },
  ];
  const fontSelector = h('div', { style: 'display:flex;gap:8px;margin-top:6px' },
    ...fontSizes.map((f) => h('button', {
      class: 'filter-chip' + (S.fontSize === f.id ? ' active' : ''),
      onclick: () => {
        S.fontSize = f.id;
        localStorage.setItem('wa_font_size', f.id);
        document.body.classList.toggle('font-large', f.id === 'large');
        document.body.classList.toggle('font-small', f.id === 'small');
        toast(`تم تعيين حجم الخط: ${f.label}`);
        renderProfile(main);
      }
    }, f.label))
  );

  // قفل التطبيق برمز PIN
  const pinStatusText = S.appPin ? '🟢 القفل مفعّل (محمي برمز PIN)' : '⚪ القفل غير مفعّل';
  const pinLockBtn = h('button', {
    class: 'btn secondary block',
    onclick: () => {
      if (S.appPin) {
        const inputCode = prompt('أدخل رمز PIN الحالي لإلغاء القفل:');
        if (inputCode === S.appPin) {
          S.appPin = null;
          localStorage.removeItem('wa_pin_' + S.me.id);
          toast('تم إلغاء قفل التطبيق بنجاح');
          renderProfile(main);
        } else if (inputCode) {
          toast('رمز PIN غير صحيح', 'error');
        }
      } else {
        const newPin = prompt('أدخل رمز PIN جديد مكون من 4 أرقام:');
        if (newPin && newPin.trim().length >= 4) {
          S.appPin = newPin.trim();
          localStorage.setItem('wa_pin_' + S.me.id, S.appPin);
          toast('تم تفعيل قفل التطبيق برمز PIN بنجاح 🔒');
          renderProfile(main);
        } else if (newPin) {
          toast('يجب أن يتكون الرمز من 4 أرقام على الأقل', 'error');
        }
      }
    },
    text: S.appPin ? '🔓 إلغاء تفعيل قفل التطبيق' : '🔒 تفعيل قفل التطبيق برمز PIN'
  });

  const testToneBtn = h('button', {
    class: 'btn ghost small',
    onclick: () => { soundFx.playReceive(); soundFx.playSend(); toast('تم تشغيل نغمات واتساب التجريبية 🎵'); },
    text: '🎵 اختبار النغمة'
  });

  main.replaceChildren(
    // 1. بطاقة الملف الشخصي العلوية
    h('div', { class: 'profile-card' },
      h('div', { class: 'profile-avatar' },
        avatar(S.me.name, 80),
        h('span', { class: 'presence ' + (online ? 'on' : 'off') })),
      h('div', { class: 'profile-name', text: S.me.name }),
      h('div', { class: 'profile-phone', dir: 'ltr', text: fmtPhone(S.me.phone) }),
      h('div', { style: 'margin-top:6px;font-size:13.5px;color:var(--text-secondary);background:var(--bg-subtle);padding:4px 12px;border-radius:12px;display:inline-block' },
        `الحالة: ${S.userBio}`)),

    // 2. بطاقة تعديل الاسم والحالة
    h('div', { class: 'card', style: 'margin:12px;border-radius:10px;background:var(--bg-card);padding:14px' },
      h('div', { class: 'section-title', style: 'font-weight:700;margin-bottom:8px;color:var(--wa-green)', text: '👤 الملف الشخصي والحساب' }),
      h('div', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:4px', text: 'الاسم المعروض في المحادثات:' }),
      h('div', { style: 'display:flex;gap:8px;margin-bottom:14px' }, nameInput, saveNameBtn),
      h('div', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:4px', text: 'الأخبار / الحالة (Bio):' }),
      bioInput,
      bioChips,
      h('div', { style: 'margin-top:8px;display:flex;justify-content:flex-end' }, saveBioBtn)
    ),

    // 3. الخصوصية والأمان
    h('div', { class: 'card', style: 'margin:12px;border-radius:10px;background:var(--bg-card);padding:14px' },
      h('div', { class: 'section-title', style: 'font-weight:700;margin-bottom:8px;color:var(--wa-green)', text: '🔒 الخصوصية والأمان' }),
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle)' },
        h('div', {},
          h('div', { style: 'font-weight:600;font-size:14px', text: 'مؤشرات قراءة الرسائل (العلامات الزرقاء)' }),
          h('div', { style: 'font-size:12px;color:var(--text-secondary)', text: 'إظهار علامات ✓✓ الزرقاء عند قراءة الرسائل' })),
        h('input', {
          type: 'checkbox',
          style: 'width:20px;height:20px;accent-color:var(--wa-green);cursor:pointer',
          checked: S.readReceipts,
          onchange: (e) => {
            S.readReceipts = e.target.checked;
            localStorage.setItem('wa_read_receipts', String(S.readReceipts));
            toast(S.readReceipts ? 'تم تفعيل مؤشرات القراءة ✓✓' : 'تم إخفاء مؤشرات القراءة');
          }
        })
      ),
      h('div', { style: 'margin-top:12px' },
        h('div', { style: 'font-size:12.5px;color:var(--text-secondary);margin-bottom:6px', text: pinStatusText }),
        pinLockBtn),
      h('div', { style: 'margin-top:10px;font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px' },
        h('span', { text: '🛡️' }),
        h('span', { text: 'جميع رسائل ومكالمات هذه الدائرة مشفرة تماماً بين الأعضاء المصرح لهم فقط.' }))
    ),

    // 4. الدردشات والمظهر
    h('div', { class: 'card', style: 'margin:12px;border-radius:10px;background:var(--bg-card);padding:14px' },
      h('div', { class: 'section-title', style: 'font-weight:700;margin-bottom:8px;color:var(--wa-green)', text: '💬 الدردشات والمظهر' }),
      h('button', {
        class: 'btn ghost block',
        style: 'text-align:right;justify-content:flex-start;gap:8px',
        onclick: toggleDarkMode,
        text: isDark ? '☀️ التبديل إلى الوضع النهاري الفاتح' : '🌙 التبديل إلى الوضع الليلي الداكن'
      }),
      h('div', { style: 'margin-top:12px' },
        h('div', { style: 'font-size:13px;color:var(--text-secondary)', text: 'حجم خط الرسائل والنصوص:' }),
        fontSelector),
      h('div', { style: 'margin-top:14px' },
        h('div', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:4px', text: 'خلفيات المحادثة السريعة:' }),
        wallpaperPalette,
        h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
          h('button', { class: 'btn secondary small block', onclick: () => $('#bg-file-input')?.click(), text: '🖼️ رفع صورة مخصصة من جهازك' }),
          h('button', { class: 'btn ghost small', onclick: () => { S.chatBackground = null; applyChatBg(); toast('تمت استعادة الخلفية الافتراضية'); }, text: 'استعادة الافتراضية' }))
      ),
      h('div', { style: 'margin-top:14px;border-top:1px solid var(--border-subtle);padding-top:10px' },
        h('div', { style: 'font-weight:600;font-size:13.5px;margin-bottom:6px', text: '📄 النسخ الاحتياطي وتصدير الدردشة' }),
        h('div', { style: 'display:flex;gap:8px' },
          h('button', { class: 'btn ghost small', style: 'flex:1', onclick: () => exportChatHistory('txt'), text: 'تصدير كمستند نصي (.txt)' }),
          h('button', { class: 'btn ghost small', style: 'flex:1', onclick: () => exportChatHistory('json'), text: 'تصدير كبيانات (.json)' })))
    ),

    // 5. الإشعارات والأصوات
    h('div', { class: 'card', style: 'margin:12px;border-radius:10px;background:var(--bg-card);padding:14px' },
      h('div', { class: 'section-title', style: 'font-weight:700;margin-bottom:8px;color:var(--wa-green)', text: '🔔 الإشعارات والأصوات' }),
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' },
        h('div', { style: 'font-weight:600;font-size:14px', text: soundFx.enabled ? 'أصوات الرسائل مفعلة 🔔' : 'أصوات الرسائل مكتومة 🔕' }),
        h('div', { style: 'display:flex;gap:6px' },
          testToneBtn,
          h('button', { class: 'btn primary small', onclick: () => { toggleSounds(); renderProfile(main); }, text: soundFx.enabled ? 'كتم' : 'تفعيل' }))
      ),
      h('button', {
        class: 'btn ghost block small',
        style: 'text-align:right;justify-content:flex-start;margin-top:8px',
        onclick: () => {
          if ('Notification' in window) {
            Notification.requestPermission().then((p) => toast(p === 'granted' ? 'تم منح إذن الإشعارات ✓' : 'تم رفض الإذن', p === 'granted' ? 'info' : 'error'));
          } else toast('الإشعارات غير مدعومة في هذا المتصفح');
        },
        text: '📱 طلب إذن إشعارات سطح المكتب والهاتف'
      })
    ),

    // 6. التخزين والوسائط والمكتبة
    h('div', { class: 'card', style: 'margin:12px;border-radius:10px;background:var(--bg-card);padding:14px' },
      h('div', { class: 'section-title', style: 'font-weight:700;margin-bottom:8px;color:var(--wa-green)', text: '💾 التخزين والوسائط' }),
      h('div', { style: 'display:flex;gap:8px;margin-bottom:10px' },
        h('button', { class: 'btn secondary block', style: 'flex:1', onclick: openMediaGallery, text: '🖼️ معرض وسائط الدائرة' }),
        h('button', { class: 'btn ghost block', style: 'flex:1', onclick: openStarredMessages, text: '⭐ الرسائل المميزة' })),
      h('div', { style: 'font-size:12.5px;color:var(--text-secondary);margin-bottom:8px', text: `إجمالي الرسائل المحفوظة: ${S.messages.length} • المنشورات: ${S.posts.length} • الحالات: ${S.statuses.length}` }),
      h('button', {
        class: 'btn ghost small block',
        onclick: () => {
          localStorage.removeItem('wa_cache');
          toast('تم مسح الذاكرة المؤقتة بنجاح ✓');
        },
        text: '🧹 مسح الذاكرة المؤقتة المحلية (Clear Cache)'
      })
    ),

    // 7. دليل الاختصارات والمساعدة
    h('div', { class: 'card', style: 'margin:12px;border-radius:10px;background:var(--bg-card);padding:14px' },
      h('div', { class: 'section-title', style: 'font-weight:700;margin-bottom:8px;color:var(--wa-green)', text: '⌨️ الاختصارات والمساعدة' }),
      h('button', { class: 'btn ghost block', style: 'text-align:right;justify-content:flex-start;gap:8px', onclick: openShortcutsModal, text: '⌨️ عرض دليل اختصارات لوحة المفاتيح' }),
      h('div', { style: 'margin-top:10px;font-size:12px;color:var(--text-muted);text-align:center' },
        `واتساب الدائرة الخاصة • الإصدار 2.5 الفاخر • متصل بخادم فوري مشفر`)
    ),

    // 8. إدارة الحساب
    h('div', { class: 'card', style: 'margin:12px;border-radius:10px;background:var(--bg-card);padding:14px' },
      h('div', { class: 'section-title', style: 'font-weight:700;margin-bottom:8px;color:var(--wa-danger)', text: '🚪 إدارة الحساب والخروج' }),
      h('div', { style: 'display:flex;gap:8px' },
        h('button', { class: 'btn secondary small block', style: 'color:var(--wa-danger)', onclick: logout, text: 'تسجيل الخروج' }),
        h('button', { class: 'btn leave-btn small block', style: 'color:var(--wa-danger);border:1px solid var(--wa-danger)', onclick: leaveCircle, text: 'مغادرة الدائرة نهائياً' }))
    )
  );
}

/* ------------------------------- إدارة الرسائل المميزة بنجمة (Starred Messages) ------------------------------- */

function toggleStar(msgId) {
  if (S.starred.has(msgId)) {
    S.starred.delete(msgId);
    toast('تمت إزالة النجمة من الرسالة');
  } else {
    S.starred.add(msgId);
    toast('تم تمييز الرسالة بنجمة ⭐');
  }
  localStorage.setItem('wa_starred_' + S.me.id, JSON.stringify(Array.from(S.starred)));
  refreshChatList();
}

function openStarredMessages() {
  const starredMsgs = S.messages.filter((m) => S.starred.has(m.id));
  const listEl = h('div', { class: 'starred-list-drawer' });

  const modal = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === modal) modal.remove(); } },
    h('div', { class: 'modal-box', style: 'max-width:520px;max-height:85vh;display:flex;flex-direction:column' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid var(--border-subtle)' },
        h('h3', { style: 'margin:0;font-size:17px;font-weight:700;display:flex;align-items:center;gap:6px', text: '⭐ الرسائل المميزة بنجمة' }),
        h('button', { class: 'icon-btn dark-text', onclick: () => modal.remove(), text: '✕' })
      ),
      listEl
    )
  );

  function drawStarredList() {
    if (!starredMsgs.length) {
      listEl.replaceChildren(
        h('div', { class: 'feed-empty-state', style: 'padding:30px 10px' },
          h('div', { class: 'feed-empty-icon', text: '⭐' }),
          h('div', { class: 'feed-empty-title', text: 'لا توجد رسائل مميزة بنجمة' }),
          h('p', { class: 'feed-empty-desc', text: 'انقر على ⋮ بجانب أي رسالة واختر "تمييز بنجمة" للرجوع إليها هنا لاحقاً.' }))
      );
      return;
    }

    listEl.replaceChildren(...starredMsgs.map((m) =>
      h('div', { class: 'starred-msg-card', style: 'border:1px solid var(--border-subtle);border-radius:10px;padding:12px;margin:8px 0;background:var(--bg-subtle)' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' },
          h('b', { style: 'font-size:13.5px;color:var(--wa-green)', text: m.author.id === S.me.id ? 'أنت' : m.author.name }),
          h('span', { style: 'font-size:11.5px;color:var(--text-muted)', text: timeAgo(m.createdAt) })),
        m.text ? h('div', { style: 'font-size:14px;color:var(--text-main);margin-bottom:6px;line-height:1.5', text: m.text }) : null,
        m.photo ? h('img', { src: m.photo, alt: 'صورة مميزة', style: 'max-height:140px;border-radius:8px;margin-bottom:6px;cursor:pointer', onclick: () => openPhotoLightbox(m.photo) }) : null,
        m.audio ? h('div', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:6px', text: '🎙️ رسالة صوتية' }) : null,
        h('div', { style: 'display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--border-subtle);padding-top:6px' },
          m.text ? h('button', { class: 'btn ghost small', onclick: () => copyToClipboard(m.text), text: '📋 نسخ' }) : null,
          h('button', { class: 'btn ghost small', onclick: () => { toggleStar(m.id); modal.remove(); openStarredMessages(); }, text: 'إزالة النجمة ✕' }),
          h('button', { class: 'btn primary small', onclick: () => { modal.remove(); switchTab('chat'); }, text: 'فتح الدردشة 💬' }))
      )
    ));
  }

  drawStarredList();
  document.body.appendChild(modal);
}

/* ------------------------------- إدارة تثبيت الرسائل (Pinned Messages) ------------------------------- */

function togglePin(msg) {
  if (S.pinnedMsg?.id === msg.id) {
    S.pinnedMsg = null;
    localStorage.removeItem('wa_pinned_msg');
    toast('تم إلغاء تثبيت الرسالة');
  } else {
    S.pinnedMsg = {
      id: msg.id,
      authorName: msg.author.name,
      text: msg.text || (msg.audio ? '🎙️ رسالة صوتية' : '📷 صورة'),
    };
    localStorage.setItem('wa_pinned_msg', JSON.stringify(S.pinnedMsg));
    toast('تم تثبيت الرسالة في أعلى المحادثة 📌');
  }
  refreshChatList();
}

/* ------------------------------- معرض وسائط وروابط الدائرة (Media Gallery) ------------------------------- */

function openMediaGallery() {
  let activeTab = 'photos'; // 'photos' | 'audio' | 'links'
  const photos = S.messages.filter((m) => m.photo).map((m) => ({ url: m.photo, time: m.createdAt, author: m.author.name }));
  const audios = S.messages.filter((m) => m.audio).map((m) => ({ audio: m.audio, time: m.createdAt, author: m.author.name }));
  const links = [];
  for (const m of S.messages) {
    if (m.text && (m.text.includes('http://') || m.text.includes('https://') || m.text.includes('📍'))) {
      links.push({ text: m.text, time: m.createdAt, author: m.author.name });
    }
  }

  const contentContainer = h('div', { class: 'media-gallery-content', style: 'padding:12px 0;max-height:60vh;overflow-y:auto' });

  const tabsHeader = h('div', { style: 'display:flex;gap:8px;border-bottom:1px solid var(--border-subtle);padding-bottom:8px' },
    h('button', { class: 'filter-chip active', onclick: (e) => switchGalleryTab('photos', e.target) }, `🖼️ الصور (${photos.length})`),
    h('button', { class: 'filter-chip', onclick: (e) => switchGalleryTab('audio', e.target) }, `🎙️ الصوتيات (${audios.length})`),
    h('button', { class: 'filter-chip', onclick: (e) => switchGalleryTab('links', e.target) }, `🔗 الروابط والمواقع (${links.length})`)
  );

  function switchGalleryTab(tab, btn) {
    activeTab = tab;
    tabsHeader.querySelectorAll('.filter-chip').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    drawGalleryContent();
  }

  function drawGalleryContent() {
    if (activeTab === 'photos') {
      if (!photos.length) {
        contentContainer.replaceChildren(h('div', { class: 'card empty', text: 'لا توجد صور مشتركة في المحادثة حتى الآن.' }));
        return;
      }
      contentContainer.replaceChildren(
        h('div', { style: 'display:grid;grid-template-columns:repeat(3, 1fr);gap:8px' },
          ...photos.map((p) => h('img', {
            src: p.url,
            style: 'width:100%;height:100px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border-subtle)',
            title: `${p.author} • ${timeAgo(p.time)}`,
            onclick: () => openPhotoLightbox(p.url)
          }))
        )
      );
    } else if (activeTab === 'audio') {
      if (!audios.length) {
        contentContainer.replaceChildren(h('div', { class: 'card empty', text: 'لا توجد تسجيلات صوتية مشتركة بعد.' }));
        return;
      }
      contentContainer.replaceChildren(
        ...audios.map((a) => h('div', { style: 'margin-bottom:8px;padding:8px;background:var(--bg-subtle);border-radius:8px' },
          h('div', { style: 'font-size:12px;color:var(--text-secondary);margin-bottom:4px', text: `${a.author} • ${timeAgo(a.time)}` }),
          audioMessagePlayer(a.audio)))
      );
    } else if (activeTab === 'links') {
      if (!links.length) {
        contentContainer.replaceChildren(h('div', { class: 'card empty', text: 'لا توجد روابط أو مواقع جغرافية مشتركة بعد.' }));
        return;
      }
      contentContainer.replaceChildren(
        ...links.map((l) => h('div', { style: 'padding:10px;background:var(--bg-subtle);border-radius:8px;margin-bottom:8px' },
          h('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: `${l.author} • ${timeAgo(l.time)}` }),
          h('div', { style: 'font-size:14px;color:var(--text-main);margin-top:4px;word-break:break-all', text: l.text })))
      );
    }
  }

  drawGalleryContent();

  const modal = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === modal) modal.remove(); } },
    h('div', { class: 'modal-box', style: 'max-width:540px;max-height:85vh;display:flex;flex-direction:column' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding-bottom:10px' },
        h('h3', { style: 'margin:0;font-size:17px;font-weight:700', text: '🖼️ وسائط وروابط ومستندات الدائرة' }),
        h('button', { class: 'icon-btn dark-text', onclick: () => modal.remove(), text: '✕' })
      ),
      tabsHeader,
      contentContainer
    )
  );

  document.body.appendChild(modal);
}

/* ------------------------------- محرك المكالمات الصوتية والمرئية الحقيقي (Real WebRTC Calling Engine) ------------------------------- */

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
  ]
};

let activeCall = null;
let incomingCallPrompt = null;
let pendingOffer = null;

async function startCall(targetId, targetName, isVideo = false) {
  // إذا لم يتم تحديد الاسم أو تم تمرير اسم الدائرة
  if (typeof targetName === 'boolean') {
    isVideo = targetName;
    targetName = S.circle.name;
    targetId = 'circle';
  } else if (!targetName && targetId) {
    const mem = S.members.find((m) => m.id === targetId);
    targetName = mem ? mem.name : S.circle.name;
  } else if (!targetId) {
    targetId = 'circle';
    targetName = S.circle.name;
  }

  if (activeCall) {
    toast('أنت بالفعل داخل مكالمة نشطة', 'error');
    return;
  }

  let localStream = null;
  try {
    const constraints = {
      audio: true,
      video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error('getUserMedia error:', err);
    toast(isVideo ? 'تعذر تشغيل الكاميرا أو الميكروفون (تحقق من الأذونات)' : 'تعذر تشغيل الميكروفون (تحقق من الأذونات)', 'error');
    return;
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  activeCall = {
    pc,
    localStream,
    remoteStream: new MediaStream(),
    peerId: targetId,
    peerName: targetName,
    isVideo,
    isCaller: true,
    isMuted: false,
    isCamOff: false,
    isScreenSharing: false,
    screenStream: null,
    facingMode: 'user',
    seconds: 0,
    timer: null,
    status: 'جاري الاتصال والطلب... 🔔',
    ui: null,
  };

  soundFx.playCallRing();
  createCallUI();

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      activeCall.remoteStream = event.streams[0];
      if (activeCall.ui?.remoteVideo) {
        activeCall.ui.remoteVideo.srcObject = event.streams[0];
      }
      if (activeCall.ui?.remoteAudio) {
        activeCall.ui.remoteAudio.srcObject = event.streams[0];
      }
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      S.sock?.send({
        type: 'webrtc_ice',
        to: targetId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      soundFx.stopCallRing();
      updateCallStatus('متصل الآن 🟢');
      startCallTimer();
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      endActiveCall(false);
      toast('انقطع اتصال المكالمة');
    }
  };

  // إرسال طلب المكالمة وبدء عرض SDP
  try {
    S.sock?.send({
      type: 'call_invite',
      to: targetId,
      isVideo,
      fromName: S.me.name
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    S.sock?.send({
      type: 'webrtc_offer',
      to: targetId,
      sdp: offer,
      isVideo
    });
  } catch (err) {
    console.error('Call offer error:', err);
    endActiveCall(false);
    toast('تعذر إنشاء عرض المكالمة', 'error');
  }
}

function handleIncomingCallInvite(ev) {
  if (activeCall) {
    S.sock?.send({ type: 'call_reject', to: ev.from, reason: 'busy' });
    return;
  }

  if (incomingCallPrompt) incomingCallPrompt.remove();
  soundFx.playCallRing();

  const isVideo = !!ev.isVideo;
  const callerName = ev.fromName || 'أحد أعضاء الدائرة';

  const modal = h('div', { class: 'incoming-call-dialog' },
    h('div', { class: 'incoming-call-header' },
      avatar(callerName, 54),
      h('div', { style: 'flex:1' },
        h('div', { style: 'font-weight:700;font-size:17px;color:#fff', text: callerName }),
        h('div', { style: 'font-size:13px;color:#00a884;margin-top:2px', text: isVideo ? '📹 مكالمة فيديو واردة عبر واتساب...' : '📞 مكالمة صوتية واردة عبر واتساب...' }))
    ),
    h('div', { class: 'incoming-call-actions' },
      h('button', {
        class: 'btn-accept-call',
        onclick: () => {
          modal.remove();
          incomingCallPrompt = null;
          soundFx.stopCallRing();
          acceptIncomingCall(ev);
        }
      }, isVideo ? '📹 رد بالفيديو' : '📞 قبول المكالمة'),
      h('button', {
        class: 'btn-decline-call',
        onclick: () => {
          modal.remove();
          incomingCallPrompt = null;
          soundFx.stopCallRing();
          rejectIncomingCall(ev, 'declined');
        }
      }, '❌ رفض')
    )
  );

  incomingCallPrompt = modal;
  document.body.appendChild(modal);

  // إغلاق تلقائي إذا لم يتم الرد خلال 40 ثانية
  setTimeout(() => {
    if (incomingCallPrompt === modal) {
      modal.remove();
      incomingCallPrompt = null;
      soundFx.stopCallRing();
      rejectIncomingCall(ev, 'timeout');
    }
  }, 40000);
}

async function acceptIncomingCall(ev) {
  const isVideo = !!ev.isVideo;
  let localStream = null;
  try {
    const constraints = {
      audio: true,
      video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
    };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error('getUserMedia error:', err);
    toast(isVideo ? 'تعذر فتح الكاميرا أو الميكروفون' : 'تعذر فتح الميكروفون', 'error');
    rejectIncomingCall(ev, 'media_error');
    return;
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  activeCall = {
    pc,
    localStream,
    remoteStream: new MediaStream(),
    peerId: ev.from,
    peerName: ev.fromName || 'عضو الدائرة',
    isVideo,
    isCaller: false,
    isMuted: false,
    isCamOff: false,
    isScreenSharing: false,
    screenStream: null,
    facingMode: 'user',
    seconds: 0,
    timer: null,
    status: 'جاري الربط... 🟢',
    ui: null,
  };

  createCallUI();

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      activeCall.remoteStream = event.streams[0];
      if (activeCall.ui?.remoteVideo) {
        activeCall.ui.remoteVideo.srcObject = event.streams[0];
      }
      if (activeCall.ui?.remoteAudio) {
        activeCall.ui.remoteAudio.srcObject = event.streams[0];
      }
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      S.sock?.send({
        type: 'webrtc_ice',
        to: ev.from,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      soundFx.stopCallRing();
      updateCallStatus('متصل الآن 🟢');
      startCallTimer();
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      endActiveCall(false);
      toast('انقطع اتصال المكالمة');
    }
  };

  S.sock?.send({
    type: 'call_accept',
    to: ev.from,
    isVideo
  });

  if (pendingOffer && pendingOffer.from === ev.from) {
    handleWebRtcOffer(pendingOffer);
    pendingOffer = null;
  }
}

function rejectIncomingCall(ev, reason = 'declined') {
  S.sock?.send({
    type: 'call_reject',
    to: ev.from,
    reason
  });
}

async function handleWebRtcOffer(ev) {
  if (!activeCall || !activeCall.pc) {
    pendingOffer = ev;
    return;
  }
  try {
    await activeCall.pc.setRemoteDescription(new RTCSessionDescription(ev.sdp));
    const answer = await activeCall.pc.createAnswer();
    await activeCall.pc.setLocalDescription(answer);

    S.sock?.send({
      type: 'webrtc_answer',
      to: ev.from,
      sdp: answer
    });

    updateCallStatus('متصل الآن 🟢');
    startCallTimer();
  } catch (err) {
    console.error('handleWebRtcOffer error:', err);
  }
}

async function handleWebRtcAnswer(ev) {
  if (!activeCall || !activeCall.pc) return;
  try {
    soundFx.stopCallRing();
    await activeCall.pc.setRemoteDescription(new RTCSessionDescription(ev.sdp));
    updateCallStatus('متصل الآن 🟢');
    startCallTimer();
  } catch (err) {
    console.error('handleWebRtcAnswer error:', err);
  }
}

async function handleWebRtcIce(ev) {
  if (!activeCall || !activeCall.pc || !ev.candidate) return;
  try {
    await activeCall.pc.addIceCandidate(new RTCIceCandidate(ev.candidate));
  } catch (err) {
    console.error('handleWebRtcIce error:', err);
  }
}

function handleCallAccept(ev) {
  soundFx.stopCallRing();
  updateCallStatus('متصل الآن 🟢');
  startCallTimer();
}

function handleCallReject(ev) {
  soundFx.stopCallRing();
  const name = ev.fromName || 'الطرف الآخر';
  toast(ev.reason === 'busy' ? `${name} مشغول في مكالمة أخرى` : `تم رفض المكالمة من قبل ${name}`, 'error');
  endActiveCall(false);
}

function handleCallHangup(ev) {
  soundFx.stopCallRing();
  toast('تم إنهاء المكالمة من الطرف الآخر');
  endActiveCall(false);
}

function startCallTimer() {
  if (!activeCall || activeCall.timer) return;
  activeCall.seconds = 0;
  if (activeCall.ui?.durationEl) activeCall.ui.durationEl.textContent = '00:00';
  activeCall.timer = setInterval(() => {
    if (!activeCall) return;
    activeCall.seconds++;
    const m = Math.floor(activeCall.seconds / 60);
    const s = activeCall.seconds % 60;
    if (activeCall.ui?.durationEl) {
      activeCall.ui.durationEl.textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }, 1000);
}

function updateCallStatus(text) {
  if (activeCall && activeCall.ui?.statusEl) {
    activeCall.status = text;
    activeCall.ui.statusEl.textContent = text;
  }
}

function createCallUI() {
  if (!activeCall) return;
  if (activeCall.ui?.overlay) activeCall.ui.overlay.remove();

  const durationEl = h('div', { class: 'webrtc-call-duration', text: '00:00' });
  const statusEl = h('div', { class: 'webrtc-call-status-badge', text: activeCall.status });

  // عناصر الوسائط
  const remoteVideo = h('video', {
    class: 'webrtc-remote-video',
    autoplay: true,
    playsinline: true,
  });
  if (activeCall.remoteStream) remoteVideo.srcObject = activeCall.remoteStream;

  const localVideoPip = h('video', {
    class: 'webrtc-local-video-pip',
    autoplay: true,
    playsinline: true,
    muted: true,
  });
  if (activeCall.localStream && activeCall.isVideo) {
    localVideoPip.srcObject = activeCall.localStream;
  } else {
    localVideoPip.style.display = 'none';
  }

  const remoteAudio = h('audio', { autoplay: true });
  if (activeCall.remoteStream) remoteAudio.srcObject = activeCall.remoteStream;

  // أزرار التحكم
  const muteBtn = h('button', {
    class: 'webrtc-btn' + (activeCall.isMuted ? ' active-off' : ''),
    title: 'كتم الميكروفون',
    onclick: () => toggleCallMute()
  }, activeCall.isMuted ? '🔇' : '🎙️');

  const camBtn = activeCall.isVideo ? h('button', {
    class: 'webrtc-btn' + (activeCall.isCamOff ? ' active-off' : ''),
    title: 'إيقاف/تشغيل الكاميرا',
    onclick: () => toggleCallCamera()
  }, activeCall.isCamOff ? '🚫' : '📹') : null;

  const flipCamBtn = activeCall.isVideo ? h('button', {
    class: 'webrtc-btn',
    title: 'تبديل الكاميرا (أمامية/خلفية)',
    onclick: () => switchCameraFacing()
  }, '🔄') : null;

  const screenShareBtn = h('button', {
    class: 'webrtc-btn' + (activeCall.isScreenSharing ? ' active-off' : ''),
    title: 'مشاركة الشاشة',
    onclick: () => toggleCallScreenShare()
  }, '🖥️');

  const endBtn = h('button', {
    class: 'webrtc-btn btn-end-call',
    title: 'إنهاء المكالمة',
    onclick: () => endActiveCall(true)
  }, '📞');

  const overlay = h('div', { class: 'webrtc-call-overlay' },
    // طبقة الفيديو
    h('div', { class: 'webrtc-video-container' },
      remoteVideo,
      localVideoPip,
      remoteAudio
    ),

    // الجزء العلوي
    h('div', { class: 'webrtc-call-top' },
      h('div', { class: 'webrtc-call-encrypted-tag' }, '🔒 تشفير تام بين الطرفين WebRTC'),
      h('div', { class: 'webrtc-call-peer-name', text: activeCall.peerName }),
      statusEl,
      durationEl
    ),

    // الجزء الأوسط (رمز تعبيري متوهج وموجات في حالة المكالمة الصوتية أو إيقاف الفيديو)
    h('div', { class: 'webrtc-audio-visual-center' },
      !activeCall.isVideo ? h('div', { class: 'webrtc-avatar-pulse-wrap' },
        h('div', { class: 'webrtc-pulse-circle' }),
        h('div', { class: 'webrtc-pulse-circle c2' }),
        h('div', { class: 'webrtc-pulse-circle c3' }),
        avatar(activeCall.peerName, 100)
      ) : null
    ),

    // شريط الأزرار السفلي
    h('div', { class: 'webrtc-call-bottom-bar' },
      muteBtn,
      camBtn,
      flipCamBtn,
      screenShareBtn,
      endBtn
    )
  );

  activeCall.ui = {
    overlay,
    durationEl,
    statusEl,
    remoteVideo,
    localVideoPip,
    remoteAudio,
    muteBtn,
    camBtn,
    flipCamBtn,
    screenShareBtn,
  };

  document.body.appendChild(overlay);
}

function toggleCallMute() {
  if (!activeCall || !activeCall.localStream) return;
  activeCall.isMuted = !activeCall.isMuted;
  activeCall.localStream.getAudioTracks().forEach((t) => {
    t.enabled = !activeCall.isMuted;
  });
  if (activeCall.ui?.muteBtn) {
    activeCall.ui.muteBtn.classList.toggle('active-off', activeCall.isMuted);
    activeCall.ui.muteBtn.textContent = activeCall.isMuted ? '🔇' : '🎙️';
  }
  toast(activeCall.isMuted ? 'تم كتم الميكروفون 🔇' : 'تم تفعيل الميكروفون 🎙️');
}

function toggleCallCamera() {
  if (!activeCall || !activeCall.localStream) return;
  activeCall.isCamOff = !activeCall.isCamOff;
  activeCall.localStream.getVideoTracks().forEach((t) => {
    t.enabled = !activeCall.isCamOff;
  });
  if (activeCall.ui?.camBtn) {
    activeCall.ui.camBtn.classList.toggle('active-off', activeCall.isCamOff);
    activeCall.ui.camBtn.textContent = activeCall.isCamOff ? '🚫' : '📹';
  }
  if (activeCall.ui?.localVideoPip) {
    activeCall.ui.localVideoPip.style.opacity = activeCall.isCamOff ? '0' : '1';
  }
  toast(activeCall.isCamOff ? 'تم إيقاف الكاميرا 🚫' : 'تم تفعيل الكاميرا 📹');
}

async function switchCameraFacing() {
  if (!activeCall || !activeCall.localStream || !activeCall.isVideo) return;
  try {
    activeCall.facingMode = activeCall.facingMode === 'user' ? 'environment' : 'user';
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: activeCall.facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const newTrack = newStream.getVideoTracks()[0];
    const oldTrack = activeCall.localStream.getVideoTracks()[0];
    if (oldTrack) {
      oldTrack.stop();
      activeCall.localStream.removeTrack(oldTrack);
    }
    activeCall.localStream.addTrack(newTrack);

    // استبدال المسار في اتصال WebRTC
    const sender = activeCall.pc?.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
      sender.replaceTrack(newTrack);
    }
    if (activeCall.ui?.localVideoPip) {
      activeCall.ui.localVideoPip.srcObject = activeCall.localStream;
    }
    toast('تم تبديل اتجاه الكاميرا 🔄');
  } catch (err) {
    console.error('switchCameraFacing error:', err);
    toast('تعذر تبديل الكاميرا', 'error');
  }
}

async function toggleCallScreenShare() {
  if (!activeCall) return;
  if (!activeCall.isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      activeCall.screenStream = screenStream;
      activeCall.isScreenSharing = true;

      const screenTrack = screenStream.getVideoTracks()[0];
      screenTrack.onended = () => {
        if (activeCall?.isScreenSharing) toggleCallScreenShare();
      };

      const sender = activeCall.pc?.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(screenTrack);
      }
      if (activeCall.ui?.localVideoPip) {
        activeCall.ui.localVideoPip.srcObject = screenStream;
        activeCall.ui.localVideoPip.style.display = 'block';
      }
      if (activeCall.ui?.screenShareBtn) {
        activeCall.ui.screenShareBtn.classList.add('active-off');
      }
      toast('تم بدء مشاركة الشاشة 🖥️');
    } catch (err) {
      console.error('Screen share error:', err);
    }
  } else {
    // إيقاف مشاركة الشاشة واستعادة الكاميرا
    activeCall.isScreenSharing = false;
    if (activeCall.screenStream) {
      activeCall.screenStream.getTracks().forEach((t) => t.stop());
      activeCall.screenStream = null;
    }
    const camTrack = activeCall.localStream?.getVideoTracks()[0];
    const sender = activeCall.pc?.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender && camTrack) {
      sender.replaceTrack(camTrack);
    }
    if (activeCall.ui?.localVideoPip && activeCall.localStream) {
      activeCall.ui.localVideoPip.srcObject = activeCall.localStream;
      activeCall.ui.localVideoPip.style.display = activeCall.isVideo ? 'block' : 'none';
    }
    if (activeCall.ui?.screenShareBtn) {
      activeCall.ui.screenShareBtn.classList.remove('active-off');
    }
    toast('تم إيقاف مشاركة الشاشة');
  }
}

function endActiveCall(notifyPeer = true) {
  soundFx.stopCallRing();
  soundFx.playEndCall();

  if (activeCall) {
    if (notifyPeer && activeCall.peerId) {
      S.sock?.send({
        type: 'call_hangup',
        to: activeCall.peerId
      });
    }

    if (activeCall.timer) {
      clearInterval(activeCall.timer);
      activeCall.timer = null;
    }

    if (activeCall.localStream) {
      activeCall.localStream.getTracks().forEach((t) => t.stop());
    }

    if (activeCall.screenStream) {
      activeCall.screenStream.getTracks().forEach((t) => t.stop());
    }

    if (activeCall.pc) {
      activeCall.pc.close();
    }

    if (activeCall.ui?.overlay) {
      activeCall.ui.overlay.remove();
    }

    activeCall = null;
  }
}


/* ------------------------------- دليل اختصارات لوحة المفاتيح (Shortcuts Guide) ------------------------------- */

function openShortcutsModal() {
  const shortcutSections = [
    {
      title: '🚀 التنقل الأساسي',
      items: [
        { key: 'Alt + 1', desc: 'الانتقال إلى تبويب الدردشات 💬' },
        { key: 'Alt + 2', desc: 'الانتقال إلى تبويب المستجدات والحالات ⭕' },
        { key: 'Alt + 3', desc: 'الانتقال إلى المنشورات العامة 📰' },
        { key: 'Alt + 4', desc: 'الانتقال إلى قائمة المجموعة 👥' },
        { key: 'Alt + 5', desc: 'الانتقال إلى الإعدادات ⚙️' },
      ]
    },
    {
      title: '💬 المحادثة والرسائل',
      items: [
        { key: 'Enter', desc: 'إرسال الرسالة الحالية فوراً' },
        { key: 'Ctrl + K  أو  Ctrl + F', desc: 'فتح البحث الموحد في الرسائل والمنشورات' },
        { key: 'Ctrl + B', desc: 'عرض الرسائل المميزة بنجمة ⭐' },
        { key: 'Ctrl + N', desc: 'إنشاء ونشر حالة جديدة ⭕' },
        { key: 'النقر المزدوج على رسالة', desc: 'اقتباس الرسالة والرد السريع عليها ↩️' },
      ]
    },
    {
      title: '🎨 التخصيص والمظهر',
      items: [
        { key: 'Ctrl + D', desc: 'التبديل بين الوضع الليلي والنهاري 🌙/☀️' },
        { key: 'Ctrl + M', desc: 'تفعيل أو كتم أصوات واتساب 🔔/🔕' },
        { key: 'Escape', desc: 'إغلاق أي نافذة منبثقة أو قائمة مفتوحة' },
        { key: 'Ctrl + /  أو  ?', desc: 'فتح دليل الاختصارات هذا في أي وقت ⌨️' },
      ]
    }
  ];

  const modal = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === modal) modal.remove(); } },
    h('div', { class: 'modal-box', style: 'max-width:540px;max-height:85vh;display:flex;flex-direction:column' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid var(--border-subtle)' },
        h('h3', { style: 'margin:0;font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px', text: '⌨️ اختصارات لوحة المفاتيح في واتساب' }),
        h('button', { class: 'icon-btn dark-text', onclick: () => modal.remove(), text: '✕' })
      ),
      h('div', { style: 'overflow-y:auto;padding:10px 0' },
        ...shortcutSections.map((sec) => h('div', { style: 'margin-bottom:16px' },
          h('div', { style: 'font-weight:700;font-size:14px;color:var(--wa-green);margin-bottom:8px', text: sec.title }),
          h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
            ...sec.items.map((item) => h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--bg-subtle);border-radius:6px' },
              h('span', { style: 'font-size:13.5px;color:var(--text-main)', text: item.desc }),
              h('kbd', { class: 'kbd-chip', text: item.key })
            ))
          )
        ))
      ),
      h('div', { style: 'text-align:center;padding-top:10px;border-top:1px solid var(--border-subtle);font-size:12px;color:var(--text-muted)' },
        'يمكنك استخدام هذه الاختصارات في أي وقت أثناء تصفح التطبيق للوصول السريع.')
    )
  );

  document.body.appendChild(modal);
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // تجاهل عند الكتابة في الحقول إلا لبعض الأوامر الخاصة
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-overlay');
      if (openModal) openModal.remove();
      const openSearchEl = document.querySelector('.search-overlay');
      if (openSearchEl) openSearchEl.remove();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
      e.preventDefault();
      openSearch();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      openShortcutsModal();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      openStarredMessages();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      toggleDarkMode();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault();
      toggleSounds();
      return;
    }

    if (e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
      e.preventDefault();
      const tabMap = { '1': 'chatlist', '2': 'status', '3': 'feed', '4': 'members', '5': 'profile' };
      switchTab(tabMap[e.key]);
      return;
    }
  });
}

/* ------------------------------- تصدير سجل الدردشة (Export Chat) ------------------------------- */

function exportChatHistory(format = 'txt') {
  if (!S.messages.length) return toast('لا توجد رسائل لتصديرها', 'error');

  let content = '';
  let filename = `whatsapp_chat_${S.circle.name}_${new Date().toISOString().slice(0, 10)}`;
  let mimeType = 'text/plain;charset=utf-8';

  if (format === 'json') {
    content = JSON.stringify(S.messages, null, 2);
    filename += '.json';
    mimeType = 'application/json;charset=utf-8';
  } else {
    filename += '.txt';
    const lines = [
      `=== سجل دردشة واتساب: ${S.circle.name} ===`,
      `تاريخ التصدير: ${new Date().toLocaleString('ar')}`,
      `إجمالي الرسائل: ${S.messages.length}`,
      '--------------------------------------------------',
      ''
    ];
    for (const m of S.messages) {
      const time = new Date(m.createdAt).toLocaleString('ar');
      const author = m.author.name;
      const text = m.text || (m.photo ? '[📷 صورة مرفقة]' : '[🎙️ رسالة صوتية]');
      lines.push(`[${time}] ${author}: ${text}`);
    }
    content = lines.join('\n');
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`تم تصدير سجل الدردشة بنجاح (${filename}) 📄`);
}

function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('تم نسخ النص إلى الحافظة 📋')).catch(() => {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('تم نسخ النص إلى الحافظة 📋');
  }
}

function openPhotoLightbox(src) {
  const modal = h('div', {
    class: 'modal-overlay lightbox-overlay',
    style: 'background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;z-index:9999',
    onclick: (e) => { if (e.target === modal) modal.remove(); }
  },
    h('img', { src, style: 'max-width:92vw;max-height:88vh;border-radius:8px;object-fit:contain;box-shadow:0 8px 32px rgba(0,0,0,0.8)' }),
    h('div', { style: 'position:absolute;top:20px;right:20px;display:flex;gap:12px' },
      h('a', { href: src, download: 'whatsapp_image.jpg', class: 'btn secondary small', text: '⬇️ تحميل' }),
      h('button', { class: 'icon-btn', style: 'color:#fff;font-size:24px', onclick: () => modal.remove(), text: '✕' }))
  );
  document.body.appendChild(modal);
}

async function deleteMessage(msgId) {
  if (!confirm('هل تريد حذف هذه الرسالة من المحادثة؟')) return;
  try {
    await api(`/messages/${msgId}`, { method: 'DELETE' });
    S.messages = S.messages.filter((m) => m.id !== msgId);
    refreshChatList();
    toast('تم حذف الرسالة');
  } catch (err) { toast(err.message, 'error'); }
}

async function leaveCircle() {
  if (!confirm('هل أنت متأكد من مغادرة الدائرة؟\n\nسيتم حذف جميع منشوراتك ورسائلك نهائياً.')) return;
  try {
    await api('/me', { method: 'DELETE' });
    toast('تم مغادرة الدائرة ✓');
    session.set('');
    if (S.sock) S.sock.close();
    setTimeout(() => location.reload(), 500);
  } catch (err) { toast(err.message, 'error'); }
}

/* ------------------------------- البحث الموحد ------------------------------- */

let searchDebounce = null;
function openSearch() {
  const input = h('input', {
    class: 'input search-input', type: 'search',
    placeholder: 'ابحث في المنشورات والرسائل...',
    autofocus: true, dir: 'auto',
  });
  const results = h('div', { class: 'search-results' });
  const closeBtn = h('button', { class: 'icon-btn', onclick: closeSearch, text: '✕' });

  const overlay = h('div', { class: 'search-overlay' },
    h('div', { class: 'search-bar-wrap' },
      h('button', { class: 'icon-btn', text: '→', onclick: () => closeSearch() }),
      input,
      closeBtn),
    results);

  function closeSearch() {
    overlay.remove();
  }

  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (q.length < 2) { results.replaceChildren(h('div', { class: 'search-empty', text: 'اكتب حرفين على الأقل للبحث' })); return; }
    searchDebounce = setTimeout(async () => {
      try {
        const r = await api(`/search?q=${encodeURIComponent(q)}`);
        results.replaceChildren(...renderSearchResults(r, q, closeSearch));
      } catch (err) { results.replaceChildren(h('div', { class: 'search-empty', text: err.message })); }
    }, 300);
  });

  document.body.append(overlay);
  setTimeout(() => input.focus(), 50);
}

function renderSearchResults(r, q, closeFn) {
  const total = r.total || 0;
  if (total === 0) return [h('div', { class: 'search-empty', text: `لا نتائج لـ «${q}»` })];
  const items = [h('div', { class: 'search-summary', text: `${total} نتيجة لـ «${q}»` })];

  for (const p of r.posts || []) {
    items.push(h('div', { class: 'search-item', onclick: () => { closeFn(); switchTab('feed'); } },
      h('div', { class: 'search-item-type', text: '📰 منشور' }),
      h('div', { class: 'search-item-author', text: p.author.name }),
      h('div', { class: 'search-item-text', html: highlightMatch(p.text, q) }),
      h('div', { class: 'search-item-time', text: timeAgo(p.createdAt) })));
  }

  for (const m of r.messages || []) {
    items.push(h('div', { class: 'search-item', onclick: () => { closeFn(); switchTab('chat'); } },
      h('div', { class: 'search-item-type', text: '💬 رسالة' }),
      h('div', { class: 'search-item-author', text: m.author.name }),
      h('div', { class: 'search-item-text', html: highlightMatch(m.text, q) }),
      h('div', { class: 'search-item-time', text: timeAgo(m.createdAt) })));
  }
  return items;
}

function highlightMatch(text, q) {
  if (!text) return '';
  const safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const i = safe.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return safe;
  const before = safe.slice(Math.max(0, i - 40), i);
  const match = safe.slice(i, i + q.length);
  const after = safe.slice(i + q.length, i + q.length + 40);
  return (i > 40 ? '...' : '') + before + `<mark style="background:#fef08a;color:#000">${match}</mark>` + after + (i + q.length + 40 < safe.length ? '...' : '');
}

/* ---------------------------- أحداث اللحظية (WebSocket Events) ---------------------------- */

function onWsEvent(ev) {
  switch (ev.type) {
    case 'hello':
      S.online = new Set(ev.online || []);
      updatePresenceUI();
      break;
    case 'presence':
      if (ev.online) S.online.add(ev.id);
      else S.online.delete(ev.id);
      updatePresenceUI();
      break;
    case 'post':
      mergePost(ev.post);
      break;
    case 'post_deleted':
      S.posts = S.posts.filter((p) => p.id !== ev.id);
      refreshPostList();
      break;
    case 'like': {
      const p = S.posts.find((x) => x.id === ev.id);
      if (p) { p.likes = ev.likes; refreshPostList(); }
      break;
    }
    case 'comment': {
      const p = S.posts.find((x) => x.id === ev.postId);
      if (p && !p.comments.some((c) => c.id === ev.comment.id)) {
        p.comments.push(ev.comment);
        refreshPostList();
      }
      break;
    }
    case 'message':
      if (ev.message.author.id !== S.me.id) soundFx.playReceive();
      mergeMessage(ev.message);
      break;
    case 'message_reaction': {
      const m = S.messages.find((x) => x.id === ev.id);
      if (m) { m.reactions = ev.reactions; refreshChatList(); }
      break;
    }
    case 'message_deleted':
      S.messages = S.messages.filter((m) => m.id !== ev.id);
      refreshChatList();
      break;
    case 'typing':
      if (ev.id !== S.me.id) {
        S.typing = { name: ev.name, until: Date.now() + 3000 };
        renderTyping();
      }
      break;
    case 'read': {
      const rm = S.messages.find((m) => m.id === ev.id);
      if (rm) { rm.readBy = ev.readBy; refreshChatList(); }
      break;
    }
    case 'status':
      if (!S.statuses.some((s) => s.id === ev.status.id)) {
        S.statuses.unshift(ev.status);
        if (S.tab === 'status') renderStatusScreen(S.mainEl);
        if (S.tab === 'chatlist') renderChatList(S.mainEl);
      }
      break;
    case 'status_deleted':
      S.statuses = S.statuses.filter((s) => s.id !== ev.id);
      if (S.tab === 'status') renderStatusScreen(S.mainEl);
      break;
    case 'status_view': {
      const s = S.statuses.find((x) => x.id === ev.id);
      if (s) s.viewers = ev.viewers;
      break;
    }
    case 'members':
      refreshMembers();
      break;
    case 'call_invite':
      handleIncomingCallInvite(ev);
      break;
    case 'call_accept':
      handleCallAccept(ev);
      break;
    case 'call_reject':
      handleCallReject(ev);
      break;
    case 'call_hangup':
      handleCallHangup(ev);
      break;
    case 'webrtc_offer':
      handleWebRtcOffer(ev);
      break;
    case 'webrtc_answer':
      handleWebRtcAnswer(ev);
      break;
    case 'webrtc_ice':
      handleWebRtcIce(ev);
      break;
  }
}

function mergePost(post) {
  if (!post) return;
  const i = S.posts.findIndex((p) => p.id === post.id);
  if (i >= 0) S.posts[i] = post;
  else S.posts.unshift(post);
  S.posts.sort((a, b) => b.createdAt - a.createdAt);
  refreshPostList();
}

function mergeMessage(msg) {
  if (!msg || S.messages.some((m) => m.id === msg.id)) return;
  S.messages.push(msg);
  if (msg.author.id !== S.me.id && S.tab !== 'chat') {
    S.unread += 1;
    updateBadge();
  }
  refreshChatList();
  if (S.tab === 'chatlist') renderChatList(S.mainEl);
}

function refreshPostList() {
  if (S.tab !== 'feed') return;
  const list = $('#post-list');
  if (list) drawPosts(list);
}

function refreshChatList() {
  if (S.tab === 'chat') {
    const list = $('#chat-list');
    if (list) drawChat(list);
  }
  if (S.tab === 'chatlist') {
    renderChatList(S.mainEl);
  }
}

function updatePresenceUI() {
  if (S.tab === 'members') {
    const rows = $('#member-rows');
    if (rows) drawMemberRows(rows);
  }
  const head = $('#chat-head-count');
  if (head) head.textContent = `${S.online.size} متصل الآن`;
  const sub = $('#app-sub');
  if (sub) sub.textContent = `${S.online.size} متصل الآن`;
}

async function syncState() {
  try {
    const st = await api('/state');
    S.me = st.me;
    S.members = st.members;
    S.posts = st.posts;
    S.messages = st.messages;
    S.statuses = st.statuses || [];
    S.online = new Set(st.online);
    S.chatBackground = st.me?.chatBackground?.url || null;
    refreshPostList();
    refreshChatList();
    updatePresenceUI();
  } catch (err) {
    if (err.code === 'unauthorized') { session.set(''); location.reload(); }
  }
}

async function refreshMembers() {
  try {
    const st = await api('/state');
    S.members = st.members;
    if (S.tab === 'members') {
      const rows = $('#member-rows');
      if (rows) drawMemberRows(rows);
    }
  } catch { /* بلا اتصال */ }
}

/* ------------------------------- بدء التطبيق ------------------------------- */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
});

const root = $('#app');
if (session.token) boot(root);
else renderLogin(root);
