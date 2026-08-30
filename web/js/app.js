/* ماسنجر لايت — واجهة التطبيق: دخول بالهاتف + منشورات + دردشة + أعضاء.
   دائرة صغيرة (٥ أعضاء كحد أقصى)، بدون بحث ولا غرباء. */

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
  const el = h('span', { class: 'avatar', style: `width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.45)}px` }, letter);
  return el;
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
};

const memberName = (id) => {
  if (S.me && id === S.me.id) return S.me.name;
  const m = S.members.find((x) => x.id === id);
  return m ? m.name : 'عضو';
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

  function drawInfo() {
    info.replaceChildren(h('div', { class: 'seats' },
      h('span', { class: 'dot' }), `أعضاء الدائرة: ${circle.members}/${circle.total}`));
  }
  drawInfo();

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
    tab: 'feed',
    unread: 0,
  });

  drawApp(root);

  if (S.sock) S.sock.close();
  S.sock = connect(onWsEvent, (up) => {
    if (S.connEl) S.connEl.classList.toggle('hidden', up);
  });
}

function drawApp(root) {
  const header = h('header', { class: 'topbar' },
    h('div', { class: 'brand' },
      h('span', { class: 'logo small', text: 'م' }),
      h('div', {},
        h('div', { class: 'app-title', text: S.circle.name }),
        h('div', { class: 'app-sub', text: `${S.members.length}/${S.circle.total} أعضاء` }))),
    h('button', { class: 'icon-btn', title: 'تسجيل الخروج', onclick: logout }, '⏻'));

  S.connEl = h('div', { class: 'offline hidden', text: 'غير متصل — بانتظار الشبكة...' });

  const main = h('main', { id: 'main' });
  const nav = h('nav', { class: 'bottomnav' },
    navItem('feed', '🏠', 'المنشورات'),
    navItem('chat', '💬', 'الدردشة'),
    navItem('members', '👥', 'الأعضاء'));

  root.replaceChildren(header, S.connEl, main, nav);
  switchTab('feed');
}

function navItem(id, icon, label) {
  const badge = h('span', { class: 'badge hidden', 'data-badge': id });
  const btn = h('button', { class: 'navitem', 'data-tab': id, onclick: () => switchTab(id) },
    h('span', { class: 'nav-icon' }, icon, badge),
    h('span', { class: 'nav-label', text: label }));
  return btn;
}

function switchTab(tab) {
  S.tab = tab;
  if (tab === 'chat') { S.unread = 0; updateBadge(); }
  $$('.bottomnav .navitem').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const main = $('#main');
  if (tab === 'feed') renderFeed(main);
  if (tab === 'chat') renderChat(main);
  if (tab === 'members') renderMembers(main);
}

function updateBadge() {
  const badge = $('.bottomnav .badge');
  if (!badge) return;
  badge.classList.toggle('hidden', S.unread === 0 || S.tab === 'chat');
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
    case 'hello':
    case 'presence':
      if (ev.online) S.online.add(ev.id); else S.online.delete(ev.id);
      if (S.tab === 'members') renderMembers($('#main'));
      break;

    case 'post': {
      const i = S.posts.findIndex((p) => p.id === ev.post.id);
      if (i >= 0) S.posts[i] = ev.post; else S.posts.unshift(ev.post);
      S.posts.sort((a, b) => b.createdAt - a.createdAt);
      if (S.tab === 'feed') renderFeed($('#main'));
      break;
    }
    case 'post_deleted':
      S.posts = S.posts.filter((p) => p.id !== ev.id);
      if (S.tab === 'feed') renderFeed($('#main'));
      break;

    case 'like': {
      const p = S.posts.find((x) => x.id === ev.id);
      if (p) { p.likes = ev.likes; if (S.tab === 'feed') renderFeed($('#main')); }
      break;
    }
    case 'comment': {
      const p = S.posts.find((x) => x.id === ev.postId);
      if (p && !p.comments.some((c) => c.id === ev.comment.id)) {
        p.comments.push(ev.comment);
        if (S.tab === 'feed') renderFeed($('#main'));
      }
      break;
    }

    case 'message': {
      if (!S.messages.some((m) => m.id === ev.message.id)) {
        S.messages.push(ev.message);
        if (ev.message.author.id !== S.me.id) {
          if (S.tab !== 'chat') { S.unread += 1; updateBadge(); }
        }
      }
      if (S.tab === 'chat') renderChat($('#main'));
      break;
    }
    case 'message_deleted':
      S.messages = S.messages.filter((m) => m.id !== ev.id);
      if (S.tab === 'chat') renderChat($('#main'));
      break;

    case 'typing':
      if (ev.id !== S.me.id) {
        S.typing = { name: ev.name, until: Date.now() + 3000 };
        if (S.tab === 'chat') renderTyping();
      }
      break;

    case 'members':
      refreshMembers();
      break;
  }
}

async function refreshMembers() {
  try {
    const st = await api('/state');
    S.members = st.members;
    if (!S.tab) return;
    if (S.tab === 'members') renderMembers($('#main'));
  } catch { /* مؤقتاً بلا اتصال */ }
}

/* ------------------------------ المنشورات ----------------------------- */

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
      await api('/posts', { method: 'POST', body: { text: t, photo: pendingPhoto } });
      text.value = '';
      pendingPhoto = null;
      photoPreview.classList.add('hidden');
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
  const feed = h('div', { class: 'feed' }, composer, list);
  main.replaceChildren(feed);
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

  const card = h('div', { class: 'card post' },
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

  return card;
}

/* ------------------------------- الدردشة ------------------------------ */

function renderChat(main) {
  const list = h('div', { class: 'chat-list', id: 'chat-list' });
  let pendingPhoto = null;

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
      await api('/messages', { method: 'POST', body: { text: t, photo: pendingPhoto } });
      input.value = '';
      pendingPhoto = null;
      preview.classList.add('hidden');
    } catch (err) { toast(err.message, 'error'); }
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  const typingEl = h('div', { class: 'typing hidden', id: 'typing' });
  const bar = h('div', { class: 'chat-bar' },
    h('button', { class: 'icon-btn attach', title: 'صورة', onclick: () => fileInput.click() }, '📷'),
    input,
    h('button', { class: 'btn primary send', onclick: send, text: 'إرسال' }),
    fileInput);

  main.replaceChildren(h('div', { class: 'chat-wrap' },
    h('div', { class: 'chat-head' },
      h('span', { text: 'دردشة الدائرة' }),
      h('span', { class: 'chat-head-sub', text: `${S.online.size} متصل الآن` })),
    list, typingEl, preview, bar));

  drawChat(list);
  renderTyping();
  list.scrollTop = list.scrollHeight;
}

function drawChat(container) {
  if (!S.messages.length) {
    container.replaceChildren(h('div', { class: 'chat-empty', text: 'ابدأوا المحادثة 👋 رسائل الدائرة كلها هنا.' }));
    return;
  }
  container.replaceChildren(S.messages.map((m) => chatBubble(m)));
  container.scrollTop = container.scrollHeight;
}

function chatBubble(m) {
  const mine = m.author.id === S.me.id;
  return h('div', { class: 'bubble-row ' + (mine ? 'mine' : 'theirs') },
    mine ? null : avatar(m.author.name, 30),
    h('div', { class: 'chat-bubble ' + (mine ? 'me' : 'them') },
      mine ? null : h('div', { class: 'bubble-author', text: m.author.name }),
      m.text ? h('div', { class: 'bubble-text', text: m.text }) : null,
      m.photo ? h('img', { class: 'bubble-photo', src: m.photo, alt: 'صورة', loading: 'lazy' }) : null,
      h('div', { class: 'bubble-time', text: timeAgo(m.createdAt) }),
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
    el.textContent = `${t.name} يكتب...`;
    setTimeout(renderTyping, t.until - Date.now() + 100);
  } else {
    el.classList.add('hidden');
  }
}

/* ------------------------------- الأعضاء ------------------------------ */

function renderMembers(main) {
  const seatsLeftCount = Math.max(0, S.circle.total - S.members.length);

  const nameInput = h('input', { class: 'input', maxlength: '30', value: S.me.name });
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

  const installBtn = h('button', { class: 'btn ghost block', id: 'install-btn', text: '📲 تثبيت التطبيق على جوالك' });
  installBtn.addEventListener('click', async () => {
    if (window.__installPrompt) {
      window.__installPrompt.prompt();
      window.__installPrompt = null;
      installBtn.classList.add('hidden');
    } else {
      toast('من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية»');
    }
  });

  main.replaceChildren(h('div', { class: 'members-wrap' },
    h('div', { class: 'card circle-card' },
      h('div', { class: 'circle-title', text: `دائرة: ${S.circle.name}` }),
      h('div', { class: 'circle-count' },
        h('span', { class: 'count-num', text: String(S.members.length) }),
        h('span', { class: 'count-total', text: ` / ${S.circle.total}` })),
      h('p', { class: 'hint', text: seatsLeftCount > 0
        ? `مقاعد متاحة للانضمام: ${seatsLeftCount} — يظهر اسم ورقم كل من يسجل هنا تلقائياً.`
        : 'الدائرة مكتملة — لا يمكن لأحد جديد التسجيل.' })),

    h('div', { class: 'card' },
      h('div', { class: 'section-title', text: 'الأعضاء المسجلون (برقم الهاتف)' }),
      S.members.map((m) => memberRow(m))),

    h('div', { class: 'card' },
      h('div', { class: 'section-title', text: 'اسمك' }),
      h('div', { class: 'rename-row' }, nameInput, saveBtn)),

    h('div', { class: 'card about' },
      h('div', { class: 'section-title', text: 'عن التطبيق' }),
      h('p', { class: 'hint', text: 'ماسنجر لايت: تطبيق خفيف جداً لدائرة صغيرة — منشورات ودردشة فقط، بلا بحث عن أشخاص وبلا مساحة تخزين كبيرة (الأرشيف يُقلَّم تلقائياً).' }),
      installBtn),
  ));
}

function memberRow(m) {
  const isMe = m.id === S.me.id;
  const online = S.online.has(m.id);
  return h('div', { class: 'member-row' },
    h('span', { class: 'avatar-wrap' },
      avatar(m.name, 44),
      h('span', { class: 'presence ' + (online ? 'on' : 'off'), title: online ? 'متصل' : 'غير متصل' })),
    h('div', { class: 'member-info' },
      h('div', { class: 'member-name' }, h('b', { text: m.name }), isMe ? h('span', { class: 'you-tag', text: 'أنت' }) : null),
      h('div', { class: 'member-phone', dir: 'ltr', text: fmtPhone(m.phone) }),
      h('div', { class: 'member-sub', text: online ? '🟢 متصل الآن' : `آخر ظهور ${timeAgo(m.lastSeen)}` })),
    h('div', { class: 'member-since', text: `عضو منذ ${new Date(m.createdAt).toLocaleDateString('ar')}` }));
}

/* ------------------------------- الإقلاع ------------------------------ */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
});

const root = $('#app');
if (session.token) boot(root);
else renderLogin(root);
