/* ماسنجر لايت — واجهة التطبيق: دخول بالهاتف + منشورات + دردشة + أعضاء.
   دائرة صغيرة (٥ أعضاء كحد أقصى)، بدون بحث ولا غرباء.

   مبادئ الاستقرار للعمل المتواصل:
   - التحديثات اللحظية تُعيد رسم القوائم فقط ولا تمس حقل الكتابة أبداً
   - عند عودة الاتصال تُجرى مزامنة كاملة لالتقاط ما فات أثناء الانقطاع
   - الجلسة المُلغاة (دخول من جهاز آخر) تعيد المستخدم لشاشة الدخول بهدوء */

import { api, session, connect } from './api.js';

/* ------------------------------ أدوات ------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
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
  setTimeout(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'الآن';
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} دقيقة`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `قبل ${d} يوم`;
  return new Date(ts).toLocaleDateString('ar');
}

const AVATAR_COLORS = ['#f4a261', '#e76f51', '#2a9d8f', '#457b9d', '#8e7dbe', '#d884a8'];
function avatar(name, size = 40) {
  const letter = (name || '؟').trim().charAt(0);
  const color = AVATAR_COLORS[[...(name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return h('span', { class: 'avatar', style: `width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.45)}px` }, letter);
}

const fmtPhone = (p) => '+' + String(p || '').replace(/(\d{3})(?=\d)/, '$1 ');

/** يضغط الصورة في المتصفح قبل إرسالها — هكذا تبقى الصور والبيانات صغيرة. */
async function compressImage(file) {
  const MAX_DIM = 1280;
  const LIMIT = 280 * 1024;
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
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.72));
    if (blob.size > LIMIT) blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.5));
    if (blob.size > LIMIT) blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.35));
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

/* رموز دول مختصرة (قائمة قصيرة عربية + إدخال يدوي) */
const COUNTRIES = [
  ['967', '🇾🇪 اليمن'], ['966', '🇸🇦 السعودية'], ['971', '🇦🇪 الإمارات'], ['968', '🇴🇲 عُمان'],
  ['974', '🇶🇦 قطر'], ['973', '🇧🇭 البحرين'], ['965', '🇰🇼 الكويت'], ['962', '🇯🇴 الأردن'],
  ['964', '🇮🇶 العراق'], ['970', '🇵🇸 فلسطين'], ['963', '🇸🇾 سوريا'], ['961', '🇱🇧 لبنان'],
  ['20', '🇪🇬 مصر'], ['249', '🇸🇩 السودان'], ['213', '🇩🇿 الجزائر'], ['212', '🇲🇦 المغرب'],
  ['216', '🇹🇳 تونس'], ['218', '🇱🇾 ليبيا'], ['90', '🇹🇷 تركيا'], ['1', '🇺🇸 أمريكا/كندا'],
  ['44', '🇬🇧 بريطانيا'], ['49', '🇩🇪 ألمانيا'], ['33', '🇫🇷 فرنسا'], ['', '＋ أخرى'],
];

/* ---------------------------- حالة التطبيق ---------------------------- */

const S = {
  me: null,
  members: [],
  posts: [],
  messages: [],
  online: new Set(),
  circle: { name: 'ماسنجر لايت', total: 5 },
  tab: 'feed',
  unread: 0,
  typing: null, // {name, until}
  sock: null,
  connEl: null,
  chatBackground: null,
};

/* ---------------------------- شاشة الدخول ---------------------------- */

async function renderLogin(root) {
  let circle = { name: 'ماسنجر لايت', members: 0, total: 5, joinCodeRequired: false };
  try { circle = await api('/circle'); } catch { /* لا يوجد اتصال — نعرض الشاشة كما هي */ }

  const country = h('select', { class: 'input code-select' },
    COUNTRIES.map(([code, label]) => h('option', { value: code, text: label })));
  country.value = '967';

  const phone = h('input', {
    class: 'input', type: 'tel', inputmode: 'tel', autocomplete: 'tel',
    placeholder: '7xxxxxxxx', dir: 'ltr',
  });

  const code = h('input', { class: 'input big', type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: '––––––', dir: 'ltr' });
  const name = h('input', { class: 'input', type: 'text', maxlength: '30', placeholder: 'اسمك كما يظهر للأعضاء' });
  const join = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'رمز الانضمام', dir: 'ltr' });

  const step1 = h('div', { class: 'step' });
  const step2 = h('div', { class: 'step hidden' });
  const info = h('div', { class: 'login-info' });

  let sentPhone = '';
  let isMember = false;

  info.replaceChildren(h('div', { class: 'seats' },
    h('span', { class: 'dot' }), `أعضاء الدائرة: ${circle.members}/${circle.total}`));

  async function requestCode() {
    const local = phone.value.replace(/[^0-9]/g, '');
    if (local.length < 6) return toast('أدخل رقم هاتف صحيحاً', 'error');
    const cc = country.value;
    sentPhone = (cc || '') + local;
    const btn = $('#send-btn', step1);
    btn.disabled = true;
    btn.textContent = 'جارٍ الإرسال...';
    try {
      const r = await api('/auth/request', { method: 'POST', body: { phone: sentPhone } });
      isMember = r.isMember;
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      $('#shown-code', step2).textContent = r.code; // وضع الدائرة الخاصة: الكود يظهر هنا
      if (!isMember) $('#new-fields', step2).classList.remove('hidden');
      $('#phone-label', step2).textContent = fmtPhone(sentPhone);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'إرسال كود التحقق';
    }
  }

  async function verify() {
    const btn = $('#verify-btn', step2);
    btn.disabled = true;
    try {
      const body = { phone: sentPhone, code: code.value.trim() };
      if (!isMember) {
        body.name = name.value;
        if (circle.joinCodeRequired) body.joinCode = join.value;
      }
      const r = await api('/auth/verify', { method: 'POST', body });
      session.set(r.token);
      boot($('#app'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  step1.append(
    h('div', { class: 'field-label', text: 'رقم هاتفك (مع رمز الدولة)' }),
    h('div', { class: 'phone-row' }, country, phone),
    h('button', { id: 'send-btn', class: 'btn primary block', onclick: requestCode, text: 'إرسال كود التحقق' }),
    h('p', { class: 'hint', text: 'التطبيق لدائرة خاصة صغيرة فقط — لا بحث ولا غرباء. الدخول برقم الهاتف.' }),
  );

  step2.append(
    h('div', { class: 'phone-label-row' },
      h('span', { text: 'تم إرسال كود إلى: ' }),
      h('b', { id: 'phone-label', dir: 'ltr' })),
    h('div', { class: 'code-box' },
      h('div', { class: 'code-box-title', text: 'كود التحقق الخاص بك' }),
      h('div', { class: 'code-value', id: 'shown-code', dir: 'ltr', text: '······' }),
      h('div', { class: 'hint', text: 'وضع الدائرة الخاصة: بدون رسائل SMS — انسخ الكود وأدخله.' })),
    h('div', { id: 'new-fields', class: 'hidden' },
      h('div', { class: 'field-label', text: 'اسمك' }), name,
      circle.joinCodeRequired ? h('div', { class: 'field-label', text: 'رمز الانضمام' }) : null,
      circle.joinCodeRequired ? join : null),
    h('div', { class: 'field-label', text: 'أدخل الكود' }), code,
    h('button', { id: 'verify-btn', class: 'btn primary block', onclick: verify, text: 'دخول' }),
    h('button', { class: 'btn ghost block', onclick: () => { step2.classList.add('hidden'); step1.classList.remove('hidden'); }, text: 'تغيير الرقم' }),
  );

  root.replaceChildren(
    h('div', { class: 'login-wrap' },
      h('div', { class: 'login-card' },
        h('div', { class: 'logo-row' },
          h('div', { class: 'logo', text: 'م' }),
          h('div', {},
            h('h1', { text: circle.name }),
            h('p', { class: 'tagline', text: 'دائرة خاصة لأقرب أشخاصك' }))),
        info,
        step1,
        step2)),
  );
}

/* ------------------------------ التطبيق ------------------------------ */

async function boot(root) {
  let state;
  try {
    state = await api('/state');
  } catch (err) {
    if (err.code === 'unauthorized') { session.set(''); renderLogin(root); return; }
    toast(err.message, 'error');
    setTimeout(() => boot(root), 2500);
    return;
  }

  Object.assign(S, {
    me: state.me,
    members: state.members,
    posts: state.posts,
    messages: state.messages,
    online: new Set(state.online),
    circle: state.circle || S.circle,
    tab: 'chatlist',
    unread: 0,
    chatBackground: state.me?.chatBackground?.url || null,
  });

  drawApp(root);

  if (S.sock) S.sock.close();
  S.sock = connect(
    onWsEvent,
    (up) => {
      if (S.connEl) S.connEl.classList.toggle('hidden', up);
      if (up) syncState(); // التقاط أي شيء فات أثناء الانقطاع
    },
    () => { session.set(''); location.reload(); } // الجلسة أُبطلت (دخول من جهاز آخر)
  );
}

function drawApp(root) {
  S.headerEl = h('header', { class: 'topbar', id: 'app-header' });
  S.connEl = h('div', { class: 'offline hidden', text: 'غير متصل — بانتظار الشبكة...' });
  S.mainEl = h('main', { id: 'main' });
  S.navEl = h('nav', { class: 'bottomnav', id: 'app-nav' });
  root.replaceChildren(S.headerEl, S.connEl, S.mainEl, S.navEl);
  renderDefaultHeader();
  renderNav();
  switchTab('chatlist');
}

function renderDefaultHeader() {
  S.headerEl.replaceChildren(
    h('div', { class: 'brand' },
      h('span', { class: 'logo small', text: 'م' }),
      h('div', {},
        h('div', { class: 'app-title', text: S.circle.name }),
        h('div', { class: 'app-sub', id: 'app-sub', text: `${S.online.size} متصل` }))),
    h('div', { style: 'display:flex;gap:4px;align-items:center' },
      h('button', { class: 'icon-btn', title: 'البحث', onclick: () => toast('بحث') }, '🔍'),
      h('button', { class: 'icon-btn', title: 'خيارات', onclick: () => switchTab('profile') }, '⋮')));
}

function renderChatHeader() {
  const onlineMembers = S.members.filter((m) => S.online.has(m.id));
  const onlineText = onlineMembers.length > 0
    ? `${onlineMembers.map((m) => m.name).slice(0, 3).join(', ')}${onlineMembers.length > 3 ? ` و ${onlineMembers.length - 3} آخرون` : ''}`
    : `${S.members.length} عضو`;

  S.headerEl.replaceChildren(
    h('button', { class: 'chat-head-back', onclick: () => switchTab('chatlist'), text: '→' }),
    h('div', { class: 'wa-conv-avatar', style: 'margin-left:4px' }, avatar(S.circle.name, 40)),
    h('div', { class: 'chat-head-info', style: 'flex:1;min-width:0' },
      h('div', { class: 'chat-head-name', text: S.circle.name }),
      h('div', { class: 'chat-head-sub', id: 'chat-head-count', text: onlineText })),
    h('div', { class: 'chat-head-actions' },
      h('button', { class: 'icon-btn', title: 'تغيير الخلفية', onclick: () => $('#bg-file-input')?.click() }, '🎨')));
}

function renderNav() {
  S.navEl.replaceChildren(
    navItem('chatlist', '💬', 'المحادثات'),
    navItem('feed', '📰', 'المنشورات'),
    navItem('members', '👥', 'الأعضاء'),
    navItem('profile', '👤', 'حسابي'));
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
  if (tab === 'feed') { renderDefaultHeader(); main.style.display = ''; S.navEl.style.display = ''; renderFeed(main); }
  else if (tab === 'chat') { renderChatHeader(); main.style.display = ''; S.navEl.style.display = 'none'; renderChat(main); }
  else if (tab === 'chatlist') { renderDefaultHeader(); main.style.display = ''; S.navEl.style.display = ''; renderChatList(main); }
  else if (tab === 'members') { renderDefaultHeader(); main.style.display = ''; S.navEl.style.display = ''; renderMembers(main); }
  else if (tab === 'profile') { renderDefaultHeader(); main.style.display = ''; S.navEl.style.display = ''; renderProfile(main); }
}

function updateBadge() {
  const badge = $$('.bottomnav .badge[data-badge="chatlist"]')[0];
  if (!badge) return;
  badge.classList.toggle('hidden', S.unread === 0);
  badge.textContent = S.unread > 9 ? '٩+' : String(S.unread);
}

function logout() {
  if (!confirm('تسجيل الخروج؟')) return;
  session.set('');
  if (S.sock) S.sock.close();
  location.reload();
}

/* ---------------------------- أحداث لحظية ---------------------------- */

function onWsEvent(ev) {
  switch (ev.type) {
    case 'hello': // قائمة المتصلين الكاملة عند الاتصال
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
      mergeMessage(ev.message);
      break;
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

    case 'members':
      refreshMembers();
      break;
  }
}

/** يدمج منشوراً في الحالة ويحدّث القائمة فقط (بدون مسح حقل الكتابة). */
function mergePost(post) {
  if (!post) return;
  const i = S.posts.findIndex((p) => p.id === post.id);
  if (i >= 0) S.posts[i] = post;
  else S.posts.unshift(post);
  S.posts.sort((a, b) => b.createdAt - a.createdAt);
  refreshPostList();
}

/** يدمج رسالة في الحالة ويحدّث القائمة فقط. */
function mergeMessage(msg) {
  if (!msg || S.messages.some((m) => m.id === msg.id)) return;
  S.messages.push(msg);
  if (msg.author.id !== S.me.id && S.tab !== 'chat') {
    S.unread += 1;
    updateBadge();
  }
  refreshChatList();
  // تحديث تلقائي لقائمة المحادثات عند وصول رسالة جديدة
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
  if (head) head.textContent = `${S.online.size} متصل`;
  const sub = $('#app-sub');
  if (sub) sub.textContent = `${S.online.size} متصل`;
}

/** مزامنة كاملة بعد عودة الاتصال — تلتقط ما فات أثناء الانقطاع. */
async function syncState() {
  try {
    const st = await api('/state');
    S.me = st.me;
    S.members = st.members;
    S.posts = st.posts;
    S.messages = st.messages;
    S.online = new Set(st.online);
    S.chatBackground = st.me?.chatBackground?.url || null;
    refreshPostList();
    refreshChatList();
    updatePresenceUI();
    const sub = $('.app-sub');
    if (sub) sub.textContent = `${S.members.length}/${S.circle.total} أعضاء`;
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
    const sub = $('.app-sub');
    if (sub) sub.textContent = `${S.members.length}/${S.circle.total} أعضاء`;
  } catch { /* مؤقتاً بلا اتصال */ }
}

/* ------------------------------ المنشورات ----------------------------- */

function contactsStrip() {
  const strip = h('div', { class: 'contacts-strip' });
  const onlineMembers = S.members.filter((m) => S.online.has(m.id));
  const offlineMembers = S.members.filter((m) => !S.online.has(m.id));
  const sorted = [...onlineMembers, ...offlineMembers];
  for (const m of sorted) {
    const isOnline = S.online.has(m.id);
    const item = h('div', { class: 'contact-item', onclick: () => switchTab('chat') },
      h('div', { class: 'contact-avatar-wrap' },
        avatar(m.name, 50),
        h('span', { class: 'contact-status ' + (isOnline ? 'on' : 'off')})),
      h('div', { class: 'contact-name', text: m.id === S.me.id ? 'أنت' : m.name }));
    strip.append(item);
  }
  return strip;
}

/* ─── قائمة المحادثات ─── */

function renderChatList(main) {
  const lastMsg = S.messages.length ? S.messages[S.messages.length - 1] : null;
  const lastTime = lastMsg ? formatChatTime(lastMsg.createdAt) : '';
  const lastText = lastMsg
    ? (lastMsg.author.id === S.me.id ? 'أنت: ' : '') + (lastMsg.text || '📷 صورة')
    : 'ابدأوا المحادثة 👋';
  const onlineCount = S.online.size;

  const conv = h('div', { class: 'wa-conversation', onclick: () => switchTab('chat') },
    h('div', { class: 'wa-conv-avatar' },
      avatar(S.circle.name, 50),
      h('span', { class: 'presence ' + (onlineCount > 0 ? 'on' : 'off') })),
    h('div', { class: 'wa-conv-info' },
      h('div', { class: 'wa-conv-top' },
        h('span', { class: 'wa-conv-name', text: S.circle.name }),
        h('span', { class: 'wa-conv-time' + (S.unread ? ' unread' : ''), text: lastTime })),
      h('div', { class: 'wa-conv-bottom' },
        h('span', { class: 'wa-conv-msg', text: lastText }),
        S.unread ? h('span', { class: 'wa-conv-unread', text: S.unread > 9 ? '٩+' : String(S.unread) }) : null)),
    h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:2px;margin-right:4px' },
      h('span', { class: 'hint', text: `${onlineCount} متصل` })));

  main.replaceChildren(
    contactsStrip(),
    h('div', { class: 'wa-chat-list' }, conv),
    S.posts.length ? h('div', { class: 'wa-conversation', onclick: () => switchTab('feed') },
      h('div', { class: 'wa-conv-avatar' }, avatar('📰', 50)),
      h('div', { class: 'wa-conv-info' },
        h('div', { class: 'wa-conv-top' },
          h('span', { class: 'wa-conv-name', text: 'المنشورات' })),
        h('div', { class: 'wa-conv-bottom' },
          h('span', { class: 'wa-conv-msg', text: `${S.posts.length} منشور في الدائرة` })))) : null,
    h('div', { class: 'wa-conversation', onclick: () => switchTab('members') },
      h('div', { class: 'wa-conv-avatar' }, avatar('👥', 50)),
      h('div', { class: 'wa-conv-info' },
        h('div', { class: 'wa-conv-top' },
          h('span', { class: 'wa-conv-name', text: 'أعضاء الدائرة' })),
        h('div', { class: 'wa-conv-bottom' },
          h('span', { class: 'wa-conv-msg', text: `${S.members.length} / ${S.circle.total} — ${onlineCount} متصل` })))))
  );
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

/* ─── المنشورات ─── */

function renderFeed(main) {
  let pendingPhoto = null;

  const text = h('textarea', { class: 'input composer', rows: '2', maxlength: '2000', placeholder: `بماذا تفكر يا ${S.me.name}؟` });
  const photoPreview = h('div', { class: 'photo-preview hidden' });

  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      pendingPhoto = await compressImage(f);
      photoPreview.replaceChildren(
        h('img', { src: pendingPhoto, alt: 'معاينة' }),
        h('button', { class: 'remove-photo', title: 'إزالة', onclick: () => { pendingPhoto = null; photoPreview.classList.add('hidden'); } }, '✕'));
      photoPreview.classList.remove('hidden');
    } catch {
      toast('تعذر تحميل الصورة', 'error');
    }
  });

  const submit = h('button', { class: 'btn primary', onclick: publish, text: 'نشر' });
  async function publish() {
    const t = text.value.trim();
    if (!t && !pendingPhoto) return;
    submit.disabled = true;
    try {
      const r = await api('/posts', { method: 'POST', body: { text: t, photo: pendingPhoto } });
      text.value = '';
      pendingPhoto = null;
      photoPreview.classList.add('hidden');
      mergePost(r.post); // يظهر فوراً حتى لو كان WS منقطعاً
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  }

  const composer = h('div', { class: 'card composer-card' },
    h('div', { class: 'composer-row' }, avatar(S.me.name), text),
    photoPreview,
    h('div', { class: 'composer-actions' },
      h('button', { class: 'btn ghost small', onclick: () => fileInput.click(), text: '📷 صورة' }),
      submit),
    fileInput);

  const list = h('div', { id: 'post-list' });
  main.replaceChildren(contactsStrip(), h('div', { class: 'feed' }, composer, list));
  drawPosts(list);
}

function drawPosts(container) {
  if (!S.posts.length) {
    container.replaceChildren(h('div', { class: 'card empty', text: 'لا منشورات بعد — شارك أول منشور مع دائرتك 👋' }));
    return;
  }
  container.replaceChildren(S.posts.map((p) => postCard(p)));
}

function postCard(p) {
  const mine = p.author.id === S.me.id;
  const liked = p.likes.includes(S.me.id);
  let commentsOpen = false;

  const likeBtn = h('button', { class: 'action-btn' + (liked ? ' liked' : ''),
    onclick: async () => {
      try { await api(`/posts/${p.id}/like`, { method: 'POST' }); } catch (err) { toast(err.message, 'error'); }
    } },
    h('span', { class: 'action-icon', text: liked ? '❤️' : '🤍' }),
    p.likes.length ? h('span', { text: String(p.likes.length) }) : h('span', { text: 'إعجاب' }));

  const commentBody = h('div', { class: 'comments hidden' });
  const commentInput = h('input', { class: 'input', maxlength: '500', placeholder: 'اكتب تعليقاً...' });
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
      p.comments.map((c) => h('div', { class: 'comment' },
        avatar(c.author.name, 28),
        h('div', { class: 'bubble' },
          h('div', { class: 'comment-head' },
            h('b', { text: c.author.id === S.me.id ? 'أنت' : c.author.name }),
            h('span', { class: 'time', text: timeAgo(c.createdAt) })),
          c.text))),
      h('div', { class: 'comment-input-row' }, commentInput,
        h('button', { class: 'btn primary small', onclick: sendComment, text: 'إرسال' })));
  }
  redrawComments();

  const commentBtn = h('button', { class: 'action-btn',
    onclick: () => { commentsOpen = !commentsOpen; commentBody.classList.toggle('hidden', !commentsOpen); } },
    h('span', { class: 'action-icon', text: '💬' }),
    h('span', { text: p.comments.length ? String(p.comments.length) : 'تعليق' }));

  return h('div', { class: 'card post' },
    h('div', { class: 'post-head' },
      avatar(p.author.name),
      h('div', { class: 'post-meta' },
        h('b', { text: mine ? 'أنت' : p.author.name }),
        h('span', { class: 'time', text: timeAgo(p.createdAt) })),
      mine ? h('button', { class: 'icon-btn subtle', title: 'حذف',
        onclick: async () => {
          if (!confirm('حذف هذا المنشور؟')) return;
          try { await api(`/posts/${p.id}`, { method: 'DELETE' }); } catch (err) { toast(err.message, 'error'); }
        } }, '🗑') : null),
    p.text ? h('p', { class: 'post-text', text: p.text }) : null,
    p.photo ? h('img', { class: 'post-photo', src: p.photo, alt: 'صورة', loading: 'lazy' }) : null,
    h('div', { class: 'post-actions' }, likeBtn, commentBtn),
    commentBody);
}

/* ------------------------------- الدردشة ------------------------------ */

function renderChat(main) {
  const list = h('div', { class: 'chat-list', id: 'chat-list' });
  let pendingPhoto = null;
  let pendingBg = null;

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

  const input = h('input', { class: 'input chat-input', maxlength: '1000', placeholder: 'اكتب رسالة...' });
  let typingSent = 0;
  input.addEventListener('input', () => {
    const now = Date.now();
    if (now - typingSent > 2000) {
      typingSent = now;
      api('/typing', { method: 'POST', body: {} }).catch(() => {});
    }
  });

  async function send() {
    const t = input.value.trim();
    if (!t && !pendingPhoto) return;
    try {
      const r = await api('/messages', { method: 'POST', body: { text: t, photo: pendingPhoto } });
      input.value = '';
      pendingPhoto = null;
      preview.classList.add('hidden');
      mergeMessage(r.message); // تظهر فوراً حتى لو كان WS منقطعاً
    } catch (err) { toast(err.message, 'error'); }
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  const typingEl = h('div', { class: 'typing hidden', id: 'typing' });
  const bar = h('div', { class: 'chat-bar' },
    h('button', { class: 'icon-btn attach', title: 'صورة', onclick: () => fileInput.click() }, '📷'),
    input,
    h('button', { class: 'send', title: 'إرسال', onclick: send }, '➤'),
    fileInput);

  /* ─── خلفية الدردشة ─── */
  const bgFileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  bgFileInput.addEventListener('change', async () => {
    const f = bgFileInput.files[0];
    bgFileInput.value = '';
    if (!f) return;
    try {
      pendingBg = await compressImage(f);
      try {
        const r = await api('/chat-background', { method: 'PUT', body: { photo: pendingBg } });
        S.chatBackground = r.me?.chatBackground?.url || null;
        applyChatBg();
        toast('تم تغيير خلفية الدردشة ✓');
      } catch (err) { toast(err.message, 'error'); }
      pendingBg = null;
    } catch { toast('تعذر تحميل الصورة', 'error'); }
  });

  bgFileInput.id = 'bg-file-input';
  main.replaceChildren(h('div', { class: 'chat-wrap', id: 'chat-wrap' },
    list, typingEl, preview, bar, bgFileInput));

  applyChatBg();

  drawChat(list);
  renderTyping();
  markMessagesRead();
}

function drawChat(container) {
  /* نمرر للأسفل فقط إذا كان المستخدم قريباً من الأسفل أصلاً (لا نقطع قراءته) */
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
  if (!S.messages.length) {
    container.replaceChildren(h('div', { class: 'chat-empty', text: 'ابدأوا المحادثة 👋 رسائل الدائرة كلها هنا.' }));
    return;
  }
  container.replaceChildren(S.messages.map((m) => chatBubble(m)));
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

function readTick(m) {
  if (m.author.id !== S.me.id) return null;
  const readBy = m.readBy || [m.author.id];
  const othersCount = S.members.filter((x) => x.id !== S.me.id).length;
  const readOthers = readBy.filter((id) => id !== S.me.id).length;
  if (readOthers === 0) return h('span', { class: 'read-tick tick-sent', title: 'مرسل', text: '✓' });
  if (readOthers < othersCount) return h('span', { class: 'read-tick tick-delivered', title: 'تم التوصيل', text: '✓✓' });
  return h('span', { class: 'read-tick tick-read', title: 'مقروءة من الجميع', text: '✓✓' });
}

function chatBubble(m) {
  const mine = m.author.id === S.me.id;
  return h('div', { class: 'bubble-row ' + (mine ? 'mine' : 'theirs') },
    mine ? null : avatar(m.author.name, 30),
    h('div', { class: 'chat-bubble ' + (mine ? 'me' : 'them') },
      mine ? null : h('div', { class: 'bubble-author', text: m.author.name }),
      m.text ? h('div', { class: 'bubble-text', text: m.text }) : null,
      m.photo ? h('img', { class: 'bubble-photo', src: m.photo, alt: 'صورة', loading: 'lazy' }) : null,
      h('div', { class: 'bubble-footer' },
        h('span', { class: 'bubble-time', text: timeAgo(m.createdAt) }),
        readTick(m)),
      mine ? h('button', { class: 'bubble-del', title: 'حذف',
        onclick: async () => {
          if (!confirm('حذف الرسالة؟')) return;
          try { await api(`/messages/${m.id}`, { method: 'DELETE' }); } catch (err) { toast(err.message, 'error'); }
        } }, '✕') : null));
}

function renderTyping() {
  const el = $('#typing');
  if (!el) return;
  const t = S.typing;
  if (t && Date.now() < t.until) {
    el.classList.remove('hidden');
    el.replaceChildren(
      h('span', { class: 'typing-dots' }, h('span'), h('span'), h('span')),
      ` ${t.name} يكتب...`);
    setTimeout(renderTyping, t.until - Date.now() + 100);
  } else {
    el.classList.add('hidden');
  }
}

/** علّم الرسائل كمقروءة عند فتح الدردشة */
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

/* ------------------------------- الأعضاء ------------------------------ */

function renderMembers(main) {
  const seatsLeftCount = Math.max(0, S.circle.total - S.members.length);
  const rows = h('div', { id: 'member-rows' });

  main.replaceChildren(
    contactsStrip(),
    h('div', { class: 'members-wrap' },
      h('div', { class: 'card circle-card' },
        h('div', { class: 'circle-title', text: `دائرة: ${S.circle.name}` }),
        h('div', { class: 'circle-count' },
          h('span', { class: 'count-num', text: String(S.members.length) }),
          h('span', { class: 'count-total', text: ` / ${S.circle.total}` })),
        h('p', { class: 'hint', text: seatsLeftCount > 0
          ? `مقاعد متاحة للانضمام: ${seatsLeftCount} — يظهر اسم ورقم كل من يسجل هنا تلقائياً.`
          : 'الدائرة مكتملة — لا يمكن لأحد جديد التسجيل.' })),

      h('div', { class: 'card' },
        h('div', { class: 'section-title', text: 'أعضاء الدائرة' }),
        rows),
    )
  );

  drawMemberRows(rows);
}

function drawMemberRows(container) {
  container.replaceChildren(S.members.map((m) => memberRow(m)));
}

function memberRow(m) {
  const isMe = m.id === S.me.id;
  const online = S.online.has(m.id);
  return h('div', { class: 'member-row', onclick: () => switchTab('chat') },
    h('span', { class: 'avatar-wrap' },
      avatar(m.name, 44),
      h('span', { class: 'presence ' + (online ? 'on' : 'off'), title: online ? 'متصل' : 'غير متصل' })),
    h('div', { class: 'member-info' },
      h('div', { class: 'member-name' },
        h('b', { text: isMe ? 'أنت' : m.name }),
        isMe ? h('span', { class: 'you-tag', text: 'أنت' }) : null),
      h('div', { class: 'member-phone', dir: 'ltr', text: fmtPhone(m.phone) }),
      h('div', { class: 'member-sub', style: online ? 'color:var(--green)' : '',
        text: online ? '🟢 متصل الآن' : `آخر ظهور ${timeAgo(m.lastSeen)}` })),
    h('div', { class: 'member-since', text: new Date(m.createdAt).toLocaleDateString('ar') }));
}

/* ------------------------------- البروفايل ------------------------------ */

function renderProfile(main) {
  const online = S.online.has(S.me.id);

  const nameInput = h('input', { class: 'input', maxlength: '30', value: S.me.name, placeholder: 'اسمك' });
  const saveBtn = h('button', {
    class: 'btn primary small',
    text: 'حفظ',
    onclick: async () => {
      const v = nameInput.value.trim();
      if (v.length < 2) return toast('الاسم قصير جداً', 'error');
      try {
        await api('/me', { method: 'PUT', body: { name: v } });
        S.me.name = v;
        toast('تم حفظ الاسم ✓');
      } catch (err) { toast(err.message, 'error'); }
    },
  });

  const installBtn = h('button', { class: 'btn ghost block', text: '📲 تثبيت التطبيق على جوالك' });
  installBtn.addEventListener('click', async () => {
    if (window.__installPrompt) {
      window.__installPrompt.prompt();
      window.__installPrompt = null;
      installBtn.classList.add('hidden');
    } else {
      toast('من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية»');
    }
  });

  main.replaceChildren(
    h('div', { class: 'profile-card' },
      h('div', { class: 'profile-avatar' },
        avatar(S.me.name, 72),
        h('span', { class: 'presence ' + (online ? 'on' : 'off')})),
      h('div', { class: 'profile-name', text: S.me.name }),
      h('div', { class: 'profile-phone', dir: 'ltr', text: fmtPhone(S.me.phone) }),
      h('div', { class: 'profile-status', text: online ? '🟢 متصل الآن' : `آخر ظهور ${timeAgo(S.me.lastSeen)}` })),

    h('div', { class: 'card profile-info-card' },
      h('div', { class: 'info-row' },
        h('div', { class: 'info-icon', text: '👤' }),
        h('div', { class: 'info-text' },
          h('div', { class: 'info-label', text: 'الاسم' }),
          h('div', { class: 'info-value', text: S.me.name }))),
      h('div', { class: 'info-row' },
        h('div', { class: 'info-icon', text: '📱' }),
        h('div', { class: 'info-text' },
          h('div', { class: 'info-label', text: 'رقم الهاتف' }),
          h('div', { class: 'info-value', dir: 'ltr', text: fmtPhone(S.me.phone) }))),
      h('div', { class: 'info-row' },
        h('div', { class: 'info-icon', text: '👥' }),
        h('div', { class: 'info-text' },
          h('div', { class: 'info-label', text: 'الأعضاء المتصلون' }),
          h('div', { class: 'info-value', text: `${S.online.size} من ${S.members.length}` }))),
      h('div', { class: 'info-row' },
        h('div', { class: 'info-icon', text: '📅' }),
        h('div', { class: 'info-text' },
          h('div', { class: 'info-label', text: 'عضو منذ' }),
          h('div', { class: 'info-value', text: new Date(S.me.createdAt).toLocaleDateString('ar')}))),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'section-title', text: 'تعديل الاسم' }),
      h('div', { class: 'rename-row' }, nameInput, saveBtn)),

    h('div', { class: 'card about' },
      h('div', { class: 'section-title', text: 'عن التطبيق' }),
      h('p', { class: 'hint', text: 'ماسنجر لايت: تطبيق خفيف جداً لدائرة صغيرة — منشورات ودردشة فقط، بلا بحث عن أشخاص وبلا مساحة تخزين كبيرة.' }),
      installBtn),
  );
}

/* ------------------------------- الإقلاع ------------------------------ */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
});

const root = $('#app');
if (session.token) boot(root);
else renderLogin(root);
