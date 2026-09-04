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

/* ----------------------- مكتبة الأيقونات المتجهة (SVG Icons) ----------------------- */

const ICONS = {
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  status: '<circle cx="12" cy="12" r="9" stroke-dasharray="32 10" stroke-linecap="round"/>',
  feed: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/>',
  members: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  'mic-off': '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  more: '<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>',
  attachment: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  emoji: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  poll: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'bell-off': '<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><line x1="1" y1="1" x2="23" y2="23"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  'check-double': '<polyline points="18 6 9 15 5 11"/><polyline points="22 10 13 19 11 17"/>',
  back: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'screen-share': '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="9 9 12 6 15 9"/><line x1="12" y1="6" x2="12" y2="13"/>',
  'switch-camera': '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a6 6 0 0 1-6-6V9a2 2 0 0 1 2-2h3"/><polyline points="4 3 8 7 4 11"/>',
  'phone-hangup': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" transform="rotate(135 12 12)"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  pin: '<path d="M16 3l1 1-4 4 3 8-7-7-4 4-1-1 4-4-7-7 8 3 4-4z"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
};

function icon(name, size = 20, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `svg-icon ${className}`.trim());
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}

/* تنسيق حجم الملفات */
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 ب';
  if (bytes < 1024) return `${bytes} ب`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

/* ----------------------- النوافذ التفاعلية والحوارات المخصصة ----------------------- */

/** نافذة تأكيد داخلية آمنة (بديل حديث لـ confirm) */
function showConfirm(title, message, confirmText = 'تأكيد', cancelText = 'إلغاء', isDanger = false) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'wa-modal-overlay' });
    const cancelBtn = h('button', { class: 'btn ghost small', text: cancelText, onclick: () => { overlay.remove(); resolve(false); } });
    const okBtn = h('button', {
      class: `btn small ${isDanger ? 'leave-btn' : 'primary'}`,
      style: isDanger ? 'background:var(--wa-danger);color:#fff;border:none' : '',
      text: confirmText,
      onclick: () => { overlay.remove(); resolve(true); }
    });

    const card = h('div', { class: 'wa-modal-card' },
      h('div', { class: 'wa-modal-title', text: title }),
      h('div', { class: 'wa-modal-desc', text: message }),
      h('div', { class: 'wa-modal-actions' }, cancelBtn, okBtn)
    );

    overlay.append(card);
    document.body.append(overlay);
  });
}

/** نافذة إدخال نصية آمنة داخلية (بديل حديث لـ prompt) */
function showPromptModal(title, message, defaultValue = '', placeholder = '', isSecret = false) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'wa-modal-overlay' });
    const input = h('input', {
      class: 'input',
      type: isSecret ? 'password' : 'text',
      value: defaultValue,
      placeholder: placeholder,
      style: 'margin-top:8px'
    });
    const cancelBtn = h('button', { class: 'btn ghost small', text: 'إلغاء', onclick: () => { overlay.remove(); resolve(null); } });
    const okBtn = h('button', {
      class: 'btn primary small',
      text: 'موافق',
      onclick: () => {
        const val = input.value;
        overlay.remove();
        resolve(val);
      }
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });

    const card = h('div', { class: 'wa-modal-card' },
      h('div', { class: 'wa-modal-title', text: title }),
      h('div', { class: 'wa-modal-desc', text: message }),
      input,
      h('div', { class: 'wa-modal-actions' }, cancelBtn, okBtn)
    );

    overlay.append(card);
    document.body.append(overlay);
    setTimeout(() => input.focus(), 100);
  });
}

/** نافذة المساعدة وإعادة محاولة منح الأذونات عند رفضها */
function openPermissionHelpModal(kind) {
  const titles = {
    mic: 'إذن الميكروفون مطلوب',
    camera_mic: 'إذن الكاميرا والميكروفون مطلوب',
    geo: 'إذن تحديد الموقع الجغرافي',
    notif: 'إذن تنبيهات وإشعارات الرسائل'
  };
  const descs = {
    mic: 'يحتاج التطبيق إذن الميكروفون لتسجيل وإرسال الرسائل الصوتية وإجراء المكالمات الصوتية.',
    camera_mic: 'يحتاج التطبيق إذن الكاميرا والميكروفون لبدء مكالمات الفيديو والتواصل المرئي المباشر.',
    geo: 'يحتاج التطبيق إذن الموقع الجغرافي لمشاركة موقعك الحالي في المحادثة بدقة.',
    notif: 'يحتاج التطبيق إذن الإشعارات لتنبيهك عند وصول رسائل ومكالمات واردة أثناء تشغيل التطبيق في الخلفية.'
  };

  const overlay = h('div', { class: 'wa-modal-overlay' });
  const card = h('div', { class: 'wa-modal-card' },
    h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:12px' },
      icon(kind === 'geo' ? 'location' : kind === 'notif' ? 'bell' : 'shield', 26, 'text-green'),
      h('div', { class: 'wa-modal-title', style: 'margin:0', text: titles[kind] || 'إذن الجهاز' })),
    h('div', { class: 'wa-modal-desc', text: descs[kind] || 'يرجى تمكين الإذن لمتابعة هذه الميزة.' }),
    h('div', { style: 'background:var(--bg-hover);padding:12px;border-radius:8px;margin-bottom:14px;border:1px solid var(--border-line)' },
      h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:6px', text: '💡 كيفية التفعيل في متصفحك:' }),
      h('div', { style: 'font-size:12.5px;color:var(--text-secondary);line-height:1.6' },
        '1. انقر على أيقونة القفل 🔒 أو علامة الأذونات بجانب شريط عنوان الموقع أعلاه.\n2. قم بتغيير حالة الإذن إلى (سماح / Allow).\n3. حدّث الصفحة أو انقر "إعادة المحاولة" بالأسفل.')),
    h('div', { class: 'wa-modal-actions' },
      h('button', { class: 'btn ghost small', text: 'إغلاق', onclick: () => overlay.remove() }),
      h('button', {
        class: 'btn primary small',
        text: 'إعادة المحاولة',
        onclick: async () => {
          overlay.remove();
          if (kind === 'mic') {
            try {
              const s = await navigator.mediaDevices.getUserMedia({ audio: true });
              s.getTracks().forEach((t) => t.stop());
              toast('تم منح إذن الميكروفون بنجاح ✓');
            } catch { toast('لم يتم منح الإذن بعد، تأكد من إعدادات المتصفح', 'error'); }
          } else if (kind === 'camera_mic') {
            try {
              const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
              s.getTracks().forEach((t) => t.stop());
              toast('تم منح إذن الكاميرا والميكروفون بنجاح ✓');
            } catch { toast('لم يتم منح الإذن بعد', 'error'); }
          } else if (kind === 'geo') {
            navigator.geolocation.getCurrentPosition(
              () => toast('تم منح إذن الموقع بنجاح ✓'),
              () => toast('تعذر الوصول للموقع', 'error')
            );
          } else if (kind === 'notif') {
            if ('Notification' in window) {
              const p = await Notification.requestPermission();
              toast(p === 'granted' ? 'تم تفعيل الإشعارات بنجاح ✓' : 'تم الرفض', p === 'granted' ? 'info' : 'error');
            }
          }
        }
      })
    )
  );
  overlay.append(card);
  document.body.append(overlay);
}

/** خيارات توجيه الصورة الملتقطة بالكاميرا السريعة */
function openPhotoTargetModal(photoDataUrl) {
  const overlay = h('div', { class: 'wa-modal-overlay' });
  const card = h('div', { class: 'wa-modal-card' },
    h('div', { class: 'wa-modal-title', text: '📷 تم التقاط الصورة' }),
    h('div', { style: 'text-align:center;margin:12px 0' },
      h('img', { src: photoDataUrl, style: 'max-width:100%;max-height:220px;border-radius:10px;object-fit:cover' })),
    h('div', { class: 'wa-modal-desc', text: 'أين ترغب في نشر الصورة الملتقطة؟' }),
    h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
      h('button', {
        class: 'btn primary block',
        onclick: async () => {
          overlay.remove();
          try {
            await api('/messages', { method: 'POST', body: { photo: photoDataUrl } });
            switchTab('chat');
            toast('تم إرسال الصورة في الدردشة 📷');
          } catch (err) { toast(err.message, 'error'); }
        },
        text: '💬 إرسال في دردشة الدائرة'
      }),
      h('button', {
        class: 'btn secondary block',
        onclick: async () => {
          overlay.remove();
          try {
            await api('/status', { method: 'POST', body: { type: 'photo', media: photoDataUrl, text: '' } });
            switchTab('status');
            toast('تم نشر الصورة كحالة جديدة ⭕');
          } catch (err) { toast(err.message, 'error'); }
        },
        text: '⭕ نشر كحالة مؤقتة (24 ساعة)'
      }),
      h('button', { class: 'btn ghost block small', onclick: () => overlay.remove(), text: 'إلغاء' })
    )
  );
  overlay.append(card);
  document.body.append(overlay);
}

/** منتقي الإيموجي الشامل والمنبثق */
let activeEmojiPicker = null;
function openEmojiPicker(onSelect, anchorEl) {
  if (activeEmojiPicker) {
    activeEmojiPicker.remove();
    activeEmojiPicker = null;
    return;
  }

  const EMOJI_CATEGORIES = [
    { id: 'faces', icon: '😄', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','🥹','☺️','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😮‍💨','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫣','🤭','🫢','🫡','🤫','🫠','🤥','😶','😐','😑','😬','🫨','😮','😯','😲','🥱','😴','🤤','😪','😵','😵‍💫','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'] },
    { id: 'hands', icon: '👍', emojis: ['👍','👎','👏','🙌','👐','🤲','🤝','👊','✊','🤛','🤜','🤞','✌️','🫰','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','🫲','🫱','🫴','🫳','💪','🦾','✍️','🙏','💅','🤳','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💖','💗','💓','💞','💕','💟','❣️'] },
    { id: 'nature', icon: '🌿', emojis: ['🌱','🌿','☘️','🍀','🎍','🪴','🎋','🍃','🍂','🍁','🌾','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌙','⭐','🌟','✨','⚡','🔥','💥','☄️','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','💦','🫧','🌊'] },
    { id: 'objects', icon: '💡', emojis: ['📱','💻','⌨️','🖥️','🖨️','📷','📸','📹','🎥','📽️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🧯','🪔','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','⚙️','🗜️','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','🧲','🩹','🩺','💊','💉','🩸','🧬','🔬','🔭','📡','🪐'] },
    { id: 'symbols', icon: '🟢', emojis: ['🟢','🔴','🟡','🟠','🔵','🟣','🟤','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜','💯','💢','💬','👁️‍🗨️','🗨️','🗯️','💭','💤','♨️','🛑','🕛','🕧','🕐','🕜','🕑','🕝','🕒','🕞','🕓','🕟','🕔','🕠','🕕','🕡','🕖','🕢','🕗','🕣','🕘','🕤','🕙','🕥','🕚','🕦','✅','☑️','✔️','❌','❎','➕','➖','➗','✖️','❓','❔','❕','❗'] },
  ];

  let currentCat = 'faces';
  const container = h('div', { class: 'wa-emoji-picker' });

  const tabBar = h('div', { class: 'emoji-tab-bar' });
  const grid = h('div', { class: 'emoji-grid' });

  function renderCategory(catId) {
    currentCat = catId;
    tabBar.querySelectorAll('.emoji-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === catId));
    grid.replaceChildren();
    const cat = EMOJI_CATEGORIES.find((c) => c.id === catId);
    if (!cat) return;
    for (const em of cat.emojis) {
      grid.append(h('div', {
        class: 'emoji-cell',
        text: em,
        onclick: (e) => {
          e.stopPropagation();
          onSelect(em);
        }
      }));
    }
  }

  for (const cat of EMOJI_CATEGORIES) {
    const btn = h('button', {
      class: 'emoji-tab-btn' + (cat.id === currentCat ? ' active' : ''),
      'data-cat': cat.id,
      text: cat.icon,
      title: cat.id,
      onclick: (e) => { e.stopPropagation(); renderCategory(cat.id); }
    });
    tabBar.append(btn);
  }

  renderCategory('faces');
  container.append(tabBar, grid);

  if (anchorEl && anchorEl.parentElement) {
    anchorEl.parentElement.style.position = 'relative';
    anchorEl.parentElement.append(container);
  } else {
    document.body.append(container);
  }

  activeEmojiPicker = container;

  setTimeout(() => {
    document.addEventListener('click', function closePicker(e) {
      if (activeEmojiPicker && !activeEmojiPicker.contains(e.target) && e.target !== anchorEl) {
        activeEmojiPicker.remove();
        activeEmojiPicker = null;
        document.removeEventListener('click', closePicker);
      }
    });
  }, 20);
}

/** نافذة إنشاء استطلاع رأي تفاعلي في المجموعة */
function openCreatePollModal() {
  const overlay = h('div', { class: 'wa-modal-overlay' });
  const questionInput = h('input', { class: 'input', placeholder: 'اسأل سؤالاً...', maxlength: '200' });

  const optionsContainer = h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin:12px 0' });
  const optionInputs = [];

  function addOptionRow(val = '') {
    if (optionInputs.length >= 6) return toast('الحد الأقصى هو 6 خيارات');
    const idx = optionInputs.length + 1;
    const inp = h('input', { class: 'input small', placeholder: `الخيار ${idx}`, maxlength: '100', value: val });
    optionInputs.push(inp);
    optionsContainer.append(inp);
  }

  // خيارين افتراضيين
  addOptionRow();
  addOptionRow();

  const addMoreBtn = h('button', {
    class: 'btn ghost small',
    style: 'align-self:flex-start;display:flex;align-items:center;gap:4px',
    onclick: () => addOptionRow(),
    text: '+ إضافة خيار آخر'
  });

  const submitBtn = h('button', {
    class: 'btn primary block',
    text: 'نشر الاستطلاع 📊',
    onclick: async () => {
      const q = questionInput.value.trim();
      if (!q) return toast('يرجى كتابة سؤال الاستطلاع', 'error');
      const validOpts = optionInputs.map((inp) => inp.value.trim()).filter(Boolean);
      if (validOpts.length < 2) return toast('أدخل خيارين على الأقل للاستطلاع', 'error');

      submitBtn.disabled = true;
      try {
        await api('/messages', {
          method: 'POST',
          body: {
            poll: {
              question: q,
              options: validOpts
            }
          }
        });
        overlay.remove();
        toast('تم نشر الاستطلاع بنجاح 📊 ✓');
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
      }
    }
  });

  const card = h('div', { class: 'wa-modal-card' },
    h('div', { class: 'wa-modal-title', text: '📊 إنشاء استطلاع رأي' }),
    h('div', { class: 'wa-modal-desc', text: 'أنشئ تصويتاً تفاعلياً لأعضاء الدائرة مع نسب ومؤشرات تصويت فورية.' }),
    h('div', { class: 'field-label', text: 'سؤال الاستطلاع' }),
    questionInput,
    h('div', { class: 'field-label', style: 'margin-top:12px', text: 'خيارات التصويت' }),
    optionsContainer,
    addMoreBtn,
    h('div', { class: 'wa-modal-actions' },
      h('button', { class: 'btn ghost small', text: 'إلغاء', onclick: () => overlay.remove() }),
      submitBtn)
  );

  overlay.append(card);
  document.body.append(overlay);
}

/** فحص واختبار أجهزة العتاد والأذونات */
async function checkDevicePermissions() {
  const status = { mic: 'prompt', camera: 'prompt', geo: 'prompt', notif: 'prompt' };
  if (navigator.permissions && navigator.permissions.query) {
    try { const r = await navigator.permissions.query({ name: 'microphone' }); status.mic = r.state; } catch {}
    try { const r = await navigator.permissions.query({ name: 'camera' }); status.camera = r.state; } catch {}
    try { const r = await navigator.permissions.query({ name: 'geolocation' }); status.geo = r.state; } catch {}
    try { const r = await navigator.permissions.query({ name: 'notifications' }); status.notif = r.state; } catch {}
  }
  if ('Notification' in window && status.notif === 'prompt') {
    status.notif = Notification.permission;
  }
  return status;
}

/** اختبار الكاميرا الحي الفوري */
async function testCameraLive() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const overlay = h('div', { class: 'wa-modal-overlay' });
    const video = h('video', {
      autoplay: true,
      playsinline: true,
      style: 'width:100%;max-height:280px;border-radius:10px;background:#000;object-fit:cover'
    });
    video.srcObject = stream;

    const close = () => {
      stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    };

    const card = h('div', { class: 'wa-modal-card', style: 'text-align:center' },
      h('div', { class: 'wa-modal-title', text: '📷 فحص الكاميرا المباشر' }),
      h('div', { class: 'wa-modal-desc', text: 'إذا كنت ترى بث الفيديو أمامك بوضوح، فالكاميرا تعمل بنجاح وبأعلى جودة!' }),
      video,
      h('div', { style: 'margin-top:16px;display:flex;justify-content:center' },
        h('button', { class: 'btn primary small', text: 'تم بنجاح (إغلاق المعاينة)', onclick: close }))
    );

    overlay.append(card);
    document.body.append(overlay);
  } catch (err) {
    openPermissionHelpModal('camera_mic');
  }
}

/** اختبار الميكروفون المباشر وإعادة الاستماع للتسجيل للتأكد من جودة الصوت */
async function testMicrophoneLive() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const overlay = h('div', { class: 'wa-modal-overlay' });
    const statusLabel = h('div', { style: 'font-weight:700;font-size:16px;color:var(--wa-danger);margin:14px 0', text: '🔴 جاري التسجيل التجريبي... (تحدث الآن: 3 ثوان)' });
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const card = h('div', { class: 'wa-modal-card', style: 'text-align:center' },
      h('div', { class: 'wa-modal-title', text: '🎙️ فحص واختبار الميكروفون' }),
      h('div', { class: 'wa-modal-desc', text: 'سيقوم الاختبار بتسجيل صوتك لمدة 3 ثوان وإعادة تشغيله فوراً لتسمع وضوح التسجيل بنفسك.' }),
      statusLabel,
      h('div', { style: 'margin-top:16px;display:flex;justify-content:center' },
        h('button', {
          class: 'btn ghost small',
          text: 'إلغاء',
          onclick: () => {
            stream.getTracks().forEach((t) => t.stop());
            overlay.remove();
          }
        }))
    );
    overlay.append(card);
    document.body.append(overlay);

    mr.start();
    let left = 3;
    const interval = setInterval(() => {
      left--;
      if (left > 0) {
        statusLabel.textContent = `🔴 جاري التسجيل التجريبي... (تحدث الآن: ${left} ثوان)`;
      } else {
        clearInterval(interval);
        mr.stop();
        stream.getTracks().forEach((t) => t.stop());
        statusLabel.style.color = 'var(--wa-green)';
        statusLabel.textContent = '🔊 جاري تشغيل الصوت المسجل الآن...';
      }
    }, 1000);

    mr.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.play();
      audio.onended = () => {
        statusLabel.textContent = '✅ ممتاز! الميكروفون يعمل بنقاء 100%';
        toast('تم فحص الميكروفون بنجاح ✓');
      };
    };
  } catch (err) {
    openPermissionHelpModal('mic');
  }
}

/** اختبار الموقع الجغرافي */
function testGeolocationLive() {
  if (!navigator.geolocation) return toast('الموقع الجغرافي غير مدعوم في متصفحك', 'error');
  toast('جاري تحديد الإحداثيات...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(4);
      const lng = pos.coords.longitude.toFixed(4);
      const acc = Math.round(pos.coords.accuracy);
      toast(`تم تحديد موقعك بدقة! (دقة: ±${acc} متر) 📍`);
    },
    () => openPermissionHelpModal('geo')
  );
}

/** اختبار الإشعارات الفوري */
async function testNotificationLive() {
  if (!('Notification' in window)) return toast('الإشعارات غير مدعومة في هذا المتصفح', 'error');
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') {
      soundFx.playReceive();
      new Notification('ماسنجر لايت • فحص الإشعارات', {
        body: 'نظام الإشعارات وتنبيهات الرسائل يعمل بنجاح وكفاءة تامة!',
        icon: '/icons/icon-192.png'
      });
      toast('تم إرسال إشعار تجريبي بنجاح 🔔 ✓');
    } else {
      openPermissionHelpModal('notif');
    }
  } catch {
    openPermissionHelpModal('notif');
  }
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
  themeAccent: localStorage.getItem('wa_theme_accent') || 'emerald',
  autoPlayVoice: localStorage.getItem('wa_auto_play_voice') === 'true',
  vibration: localStorage.getItem('wa_vibration') !== 'false',
  showTyping: localStorage.getItem('wa_show_typing') !== 'false',
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
      circle.unlimited || !circle.total
        ? `الأعضاء المسجلون: ${circle.members}`
        : `الأعضاء المسجلون: ${circle.members} من ${circle.total}`)
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
    S.userBio = localStorage.getItem('wa_bio_' + S.me.id) || S.me.bio || 'متوفر 🟢';
    S.appPin = localStorage.getItem('wa_pin_' + S.me.id) || null;

    applyThemeAccent(S.themeAccent);
    setupKeyboardShortcuts();
    drawApp(root);

    if (S.appPin) {
      showAppLockScreen();
    }

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
      h('div', { class: 'logo-wa', style: 'display:inline-flex;align-items:center;justify-content:center' }, icon('chat', 22, 'text-white')),
      h('div', {},
        h('div', { class: 'app-title', text: S.circle.name }),
        h('div', { class: 'app-sub', id: 'app-sub', text: `${S.online.size} متصل الآن` }))),
    h('div', { class: 'topbar-actions' },
      h('button', { class: 'icon-btn', title: 'مكالمة صوتية للدائرة', onclick: () => startCall('circle', S.circle.name, false) }, icon('phone', 20)),
      h('button', { class: 'icon-btn', title: 'الكاميرا', onclick: () => triggerCameraQuick() }, icon('camera', 20)),
      h('button', { class: 'icon-btn', title: 'البحث الموحد (Ctrl+K)', onclick: () => openSearch() }, icon('search', 20)),
      h('button', { class: 'icon-btn', title: 'الخيارات', onclick: toggleMenu }, icon('more', 20)),
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
      h('span', { class: 'menu-icon' }, icon('star', 18)),
      h('span', { text: 'الرسائل المميزة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { openMediaGallery(); closeChatMenu(); } },
      h('span', { class: 'menu-icon' }, icon('image', 18)),
      h('span', { text: 'الوسائط والروابط' })),
    h('button', { class: 'wa-menu-item', onclick: () => { exportChatHistory('txt'); closeChatMenu(); } },
      h('span', { class: 'menu-icon' }, icon('document', 18)),
      h('span', { text: 'تصدير سجل الدردشة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { $('#bg-file-input')?.click(); closeChatMenu(); } },
      h('span', { class: 'menu-icon' }, icon('settings', 18)),
      h('span', { text: 'خلفية الشاشة' })),
    h('button', { class: 'wa-menu-item', onclick: () => { switchTab('members'); closeChatMenu(); } },
      h('span', { class: 'menu-icon' }, icon('members', 18)),
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
      h('button', { class: 'chat-head-back', onclick: () => switchTab('chatlist'), title: 'رجوع' }, icon('back', 20)),
      h('div', { class: 'wa-conv-avatar' }, avatar(S.circle.name, 38)),
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'app-title', style: 'font-size:16px', text: S.circle.name }),
        h('div', { class: 'app-sub', id: 'chat-head-count', text: onlineText }))),
    h('div', { class: 'topbar-actions' },
      h('button', { class: 'icon-btn', title: 'مكالمة مرئية', onclick: () => startCall('circle', S.circle.name, true) }, icon('video', 20)),
      h('button', { class: 'icon-btn', title: 'مكالمة صوتية', onclick: () => startCall('circle', S.circle.name, false) }, icon('phone', 20)),
      h('button', { class: 'icon-btn', title: 'البحث في المحادثة', onclick: () => openSearch() }, icon('search', 20)),
      h('button', { class: 'icon-btn', title: 'خيارات المحادثة', onclick: toggleChatMenu }, icon('more', 20)),
      chatMenu)
  );
}

function renderNav() {
  S.navEl.replaceChildren(
    navItem('chatlist', icon('chat', 22), 'الدردشات'),
    navItem('status', icon('status', 22), 'المستجدات'),
    navItem('feed', icon('feed', 22), 'المنشورات'),
    navItem('members', icon('members', 22), 'المجموعة'),
    navItem('profile', icon('settings', 22), 'الإعدادات')
  );
}

function navItem(id, iconEl, label) {
  const badge = h('span', { class: 'badge hidden', 'data-badge': id });
  return h('button', { class: 'navitem', 'data-tab': id, onclick: () => switchTab(id) },
    h('span', { class: 'nav-icon' }, iconEl, badge),
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
    S.fabEl = h('button', { class: 'fab', onclick: () => switchTab('chat'), title: 'محادثة الدائرة' }, icon('chat', 24, 'text-white'));
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
  const docFileInput = h('input', { type: 'file', class: 'hidden' });

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

  docFileInput.addEventListener('change', async () => {
    const f = docFileInput.files[0];
    docFileInput.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast('حجم الملف كبير جداً (الحد الأقصى 15 ميجابايت)', 'error');
    try {
      toast('جاري قراءة وإرسال المستند...');
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          soundFx.playSend();
          const r = await api('/messages', {
            method: 'POST',
            body: {
              file: {
                name: f.name,
                size: f.size,
                type: f.type || 'application/octet-stream',
                data: reader.result
              },
              replyTo: S.replyTo
            }
          });
          clearReply();
          mergeMessage(r.message);
          toast(`تم إرسال: ${f.name} ✓`);
        } catch (err) { toast(err.message, 'error'); }
      };
      reader.readAsDataURL(f);
    } catch { toast('تعذر قراءة الملف', 'error'); }
  });

  const input = h('input', { class: 'chat-input', maxlength: '1000', placeholder: 'اكتب رسالة...' });
  const actionBtn = h('button', { class: 'chat-action-btn', title: 'تسجيل صوتي' }, icon('mic', 20, 'text-white'));

  let typingSent = 0;
  input.addEventListener('input', () => {
    const val = input.value.trim();
    actionBtn.replaceChildren(icon(val ? 'send' : 'mic', 20, 'text-white'));
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
      actionBtn.replaceChildren(icon('mic', 20, 'text-white'));
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
      openPermissionHelpModal('mic');
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
    actionBtn.replaceChildren(icon('mic', 20, 'text-white'));
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
    actionBtn.replaceChildren(icon('mic', 20, 'text-white'));
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
    attachItem('doc', icon('document', 20), 'مستند/ملف', () => { docFileInput.click(); toggleAttach(); }),
    attachItem('gallery', icon('image', 20), 'المعرض', () => { fileInput.click(); toggleAttach(); }),
    attachItem('camera', icon('camera', 20), 'الكاميرا', () => { fileInput.click(); toggleAttach(); }),
    attachItem('poll', icon('poll', 20), 'استطلاع رأي', () => { openCreatePollModal(); toggleAttach(); }),
    attachItem('location', icon('location', 20), 'الموقع', () => { shareLocation(); toggleAttach(); }),
    attachItem('audio', icon('mic', 20), 'تسجيل صوتي', () => { startRecording(); toggleAttach(); })
  );

  function attachItem(type, iconEl, label, onClick) {
    return h('div', { class: 'wa-attach-item', onclick: onClick },
      h('div', { class: `wa-attach-circle ${type}` }, iconEl),
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
    }, () => openPermissionHelpModal('geo'));
  }

  const emojiBtn = h('button', {
    class: 'icon-btn dark-text',
    style: 'font-size:18px;width:34px;height:34px;padding:4px',
    title: 'الإيموجي',
    onclick: (e) => {
      e.stopPropagation();
      openEmojiPicker((em) => {
        input.value += em;
        input.dispatchEvent(new Event('input'));
        input.focus();
      }, emojiBtn);
    }
  }, icon('emoji', 20));

  const attachBtn = h('button', {
    class: 'icon-btn dark-text',
    style: 'width:34px;height:34px;padding:4px',
    title: 'إرفاق',
    onclick: toggleAttach
  }, icon('attachment', 20));

  const cameraInputBtn = h('button', {
    class: 'icon-btn dark-text',
    style: 'width:34px;height:34px;padding:4px',
    title: 'صورة من الكاميرا',
    onclick: () => fileInput.click()
  }, icon('camera', 20));

  const inputPill = h('div', { class: 'chat-input-pill' },
    emojiBtn,
    attachBtn,
    input,
    cameraInputBtn
  );

  const typingEl = h('div', { class: 'typing hidden', id: 'typing' });
  const bar = h('div', { class: 'chat-bar' },
    attachPopup,
    inputPill,
    recBar,
    actionBtn,
    fileInput,
    docFileInput
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

/* رسم بطاقة استطلاع الرأي التفاعلي */
function renderPollBubble(m) {
  const poll = m.poll;
  if (!poll || !Array.isArray(poll.options)) return null;
  const totalVotes = poll.options.reduce((sum, opt) => sum + (Array.isArray(opt.voters) ? opt.voters.length : 0), 0);

  const optionsContainer = h('div', { class: 'poll-options' });
  for (const opt of poll.options) {
    const voters = Array.isArray(opt.voters) ? opt.voters : [];
    const voteCount = voters.length;
    const isVotedByMe = S.me && voters.includes(S.me.id);
    const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

    const bar = h('div', { class: 'poll-bar', style: `width:${pct}%` });
    const checkEl = isVotedByMe ? h('span', { style: 'color:var(--wa-green);font-weight:bold;margin-left:4px' }, '✓') : null;

    const optEl = h('div', {
      class: 'poll-option-item' + (isVotedByMe ? ' voted' : ''),
      onclick: async (e) => {
        e.stopPropagation();
        try {
          const res = await api(`/messages/${m.id}/vote`, { method: 'POST', body: { optionId: opt.id } });
          m.poll = res.poll;
          const oldBubble = document.getElementById(`msg-bubble-${m.id}`);
          if (oldBubble && oldBubble.parentElement) {
            const newRow = chatBubble(m);
            oldBubble.parentElement.replaceWith(newRow);
          }
        } catch (err) { toast(err.message, 'error'); }
      }
    },
      bar,
      h('div', { class: 'poll-option-content' }, checkEl, h('span', { text: opt.text })),
      h('div', { class: 'poll-option-meta' }, `${voteCount} (${pct}%)`)
    );
    optionsContainer.append(optEl);
  }

  return h('div', { class: 'bubble-poll' },
    h('div', { class: 'poll-question', text: poll.question }),
    optionsContainer,
    h('div', { class: 'poll-total-votes', text: `إجمالي الأصوات: ${totalVotes} • انقر على أي خيار للتصويت أو التراجع` })
  );
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
        h('span', { class: 'menu-icon' }, icon('reply', 18)),
        h('span', { text: 'رد على الرسالة' })),
      h('button', { class: 'wa-menu-item', onclick: () => { toggleStar(m.id); msgMenu.remove(); } },
        h('span', { class: 'menu-icon' }, icon('star', 18)),
        h('span', { text: isStarred ? 'إزالة النجمة' : 'تمييز بنجمة' })),
      h('button', { class: 'wa-menu-item', onclick: () => { togglePin(m); msgMenu.remove(); } },
        h('span', { class: 'menu-icon' }, icon('pin', 18)),
        h('span', { text: isPinned ? 'إلغاء التثبيت' : 'تثبيت في الأعلى' })),
      m.text ? h('button', { class: 'wa-menu-item', onclick: () => { copyToClipboard(m.text); msgMenu.remove(); } },
        h('span', { class: 'menu-icon' }, icon('copy', 18)),
        h('span', { text: 'نسخ النص' })) : null,
      mine ? h('button', { class: 'wa-menu-item', style: 'color:var(--wa-danger)', onclick: () => { deleteMessage(m.id); msgMenu.remove(); } },
        h('span', { class: 'menu-icon' }, icon('trash', 18, 'text-danger')),
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

  // بطاقة المستند / الملف إن وجد
  const docCard = m.file ? h('a', {
    class: 'bubble-doc',
    href: m.file.data,
    download: m.file.name || 'document',
    title: 'انقر لتنزيل المستند'
  },
    h('div', { class: 'doc-icon-box' }, icon('document', 22)),
    h('div', { class: 'doc-info' },
      h('div', { class: 'doc-name', text: m.file.name }),
      h('div', { class: 'doc-size', text: formatFileSize(m.file.size) })
    ),
    h('div', { class: 'doc-dl-btn', title: 'تحميل' }, icon('download', 18))
  ) : null;

  // بطاقة استطلاع الرأي التفاعلي إن وجد
  const pollCard = m.poll ? renderPollBubble(m) : null;

  const bubbleWrap = h('div', { class: 'chat-bubble ' + (mine ? 'me' : 'them') + (isPinned ? ' is-pinned' : ''), id: `msg-bubble-${m.id}` },
    mine ? null : h('div', { class: 'bubble-author', text: m.author.name }),
    quoteBox,
    m.text ? h('div', { class: 'bubble-text', text: m.text }) : null,
    m.photo ? h('img', { class: 'bubble-photo', src: m.photo, alt: 'صورة', loading: 'lazy', onclick: () => openPhotoLightbox(m.photo) }) : null,
    m.audio ? audioMessagePlayer(m.audio) : null,
    docCard,
    pollCard,
    h('div', { class: 'bubble-footer' },
      isStarred ? h('span', { class: 'bubble-star-icon', title: 'مميزة بنجمة' }, '⭐') : null,
      isPinned ? h('span', { title: 'رسالة مثبتة', style: 'font-size:11px' }, '📌') : null,
      h('span', { class: 'bubble-time', text: timeAgo(m.createdAt) }),
      readTick(m)),
    h('div', { style: 'position:absolute;top:4px;left:4px;display:flex;gap:2px' },
      h('div', { class: 'bubble-actions-trigger', onclick: showReactions, title: 'تفاعل' }, icon('emoji', 16)),
      h('div', { class: 'bubble-actions-trigger', onclick: showMessageMenu, title: 'خيارات الرسالة' }, icon('more', 16))
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
  const isUnlimited = S.circle.unlimited || !Number.isFinite(S.circle.total);
  const seatsLeftCount = isUnlimited ? Infinity : Math.max(0, S.circle.total - S.members.length);
  const rows = h('div', { id: 'member-rows' });

  main.replaceChildren(
    contactsStripWithStatus(),
    h('div', { class: 'members-wrap', style: 'padding:12px 14px' },
      h('div', { class: 'card circle-card', style: 'border-radius:10px;text-align:center;padding:18px;background:var(--bg-card);box-shadow:var(--shadow-sm);margin-bottom:12px' },
        h('div', { style: 'font-weight:700;font-size:16px', text: `مجموعة: ${S.circle.name}` }),
        h('div', { style: 'font-size:36px;font-weight:900;color:var(--wa-green);margin:6px 0' },
          isUnlimited ? `${S.members.length} عضو` : `${S.members.length} / ${S.circle.total}`),
        h('p', { class: 'hint', text: isUnlimited
          ? 'الانضمام مفتوح وغير محدود — يمكن لأي شخص التسجيل والبدء بالتواصل.'
          : (seatsLeftCount > 0
            ? `مقاعد متاحة للانضمام: ${seatsLeftCount} — يظهر اسم ورقم كل من يسجل هنا تلقائياً.`
            : 'الدائرة مكتملة — لا يمكن لأحد جديد التسجيل.') })),

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

/* ------------------------------- سمات الألوان الحديثة وقفل التطبيق ------------------------------- */

function applyThemeAccent(accent) {
  S.themeAccent = accent;
  localStorage.setItem('wa_theme_accent', accent);
  document.body.classList.remove('theme-ocean', 'theme-violet', 'theme-amber', 'theme-midnight');
  if (accent && accent !== 'emerald') {
    document.body.classList.add(`theme-${accent}`);
  }
}

function showAppLockScreen() {
  if (!S.appPin) return;
  if ($('#app-lock-overlay')) return;

  const overlay = h('div', { id: 'app-lock-overlay', class: 'wa-lock-overlay' });
  const pinInput = h('input', {
    type: 'password',
    maxlength: '8',
    class: 'input lock-pin-input',
    placeholder: '••••',
    dir: 'ltr',
    autofocus: true,
  });

  const unlockBtn = h('button', {
    class: 'btn primary block',
    text: 'فتح القفل',
    onclick: () => {
      if (pinInput.value === S.appPin) {
        overlay.remove();
        toast('تم إلغاء قفل التطبيق ✓');
      } else {
        toast('رمز PIN غير صحيح', 'error');
        pinInput.value = '';
        pinInput.focus();
      }
    }
  });

  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockBtn.click();
  });

  const card = h('div', { class: 'wa-lock-card' },
    h('div', { class: 'lock-icon' }, '🔒'),
    h('h2', { text: 'واتساب محمي برمز PIN' }),
    h('p', { text: 'أدخل رمز الأمان للمتابعة إلى محادثاتك بأمان' }),
    pinInput,
    h('div', { style: 'margin-top:16px;width:100%' }, unlockBtn)
  );

  overlay.append(card);
  document.body.append(overlay);
  setTimeout(() => pinInput.focus(), 120);
}

function lockAppNow() {
  if (!S.appPin) {
    toast('يرجى تفعيل رمز PIN أولاً من الإعدادات', 'info');
    return;
  }
  showAppLockScreen();
}

/* ------------------------------- الإعدادات الشاملة والبروفايل (Settings Hub) ------------------------------- */

function renderProfile(main) {
  const online = S.online.has(S.me.id);
  const isDark = document.body.classList.contains('dark');

  // 1. تعديل الاسم
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

  // 2. تعديل الحالة الشخصية (Bio)
  const currentBio = S.me.bio || S.userBio || 'متوفر 🟢';
  const bioInput = h('input', { class: 'input', maxlength: '60', value: currentBio, placeholder: 'اكتب حالتك أو اختر حالة جاهزة...' });
  const bioPresets = ['متوفر 🟢', 'مشغول 💼', 'في اجتماع 📅', 'في النادي الرياضي 💪', 'نائم 😴', 'في العمل 💻', 'أحب واتساب ❤️'];
  const bioChips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' },
    ...bioPresets.map((b) => h('button', {
      class: 'filter-chip small' + (currentBio === b ? ' active' : ''),
      onclick: async () => {
        bioInput.value = b;
        S.userBio = b;
        S.me.bio = b;
        localStorage.setItem('wa_bio_' + S.me.id, b);
        try {
          await api('/me', { method: 'PUT', body: { bio: b } });
        } catch { /* تجاهل الخطأ في حال عدم الاتصال */ }
        toast(`تم تعيين الحالة: ${b}`);
        renderProfile(main);
      }
    }, b))
  );

  const saveBioBtn = h('button', {
    class: 'btn secondary small',
    text: 'حفظ الحالة',
    onclick: async () => {
      const v = bioInput.value.trim() || 'متوفر 🟢';
      S.userBio = v;
      S.me.bio = v;
      localStorage.setItem('wa_bio_' + S.me.id, v);
      try {
        await api('/me', { method: 'PUT', body: { bio: v } });
        toast('تم حفظ الحالة الشخصية في السيرفر ✓');
      } catch (err) {
        toast('تم الحفظ محلياً: ' + err.message, 'info');
      }
      renderProfile(main);
    }
  });

  // 3. سمات الألوان الحديثة (Theme Accents)
  const themeAccents = [
    { id: 'emerald', label: 'أخضر زمردي', color: '#008069', lightBg: '#00a884' },
    { id: 'ocean', label: 'أزرق عصري', color: '#0284c7', lightBg: '#0ea5e9' },
    { id: 'violet', label: 'بنفسجي ملكي', color: '#6d28d9', lightBg: '#8b5cf6' },
    { id: 'amber', label: 'كهرماني دافئ', color: '#b45309', lightBg: '#f59e0b' },
    { id: 'midnight', label: 'أسود عميق', color: '#18181b', lightBg: '#10b981' },
  ];

  const currentAccent = S.themeAccent || 'emerald';
  const themeAccentPicker = h('div', { class: 'theme-accent-picker' },
    ...themeAccents.map((acc) => {
      const isActive = currentAccent === acc.id;
      return h('button', {
        class: `theme-accent-btn ${isActive ? 'active' : ''}`,
        onclick: () => {
          applyThemeAccent(acc.id);
          toast(`تم تفعيل سمة: ${acc.label} ✨`);
          renderProfile(main);
        }
      },
      h('div', { class: 'theme-accent-circle', style: `background: linear-gradient(135deg, ${acc.color}, ${acc.lightBg})` },
        isActive ? '✓' : ''
      ),
      h('span', { class: 'theme-accent-label' }, acc.label)
      );
    })
  );

  // 4. حجم الخط
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

  // 5. خلفيات الدردشة الجاهزة
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

  const wallpaperPalette = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0' },
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

  // 6. قفل التطبيق برمز PIN
  const pinLockBtn = h('button', {
    class: 'btn secondary small',
    onclick: async () => {
      if (S.appPin) {
        const inputCode = await showPromptModal('إلغاء قفل التطبيق', 'أدخل رمز PIN الحالي للمتابعة:', '', 'رمز PIN الحالي', true);
        if (inputCode === S.appPin) {
          S.appPin = null;
          localStorage.removeItem('wa_pin_' + S.me.id);
          toast('تم إلغاء قفل التطبيق بنجاح');
          renderProfile(main);
        } else if (inputCode) {
          toast('رمز PIN غير صحيح', 'error');
        }
      } else {
        const newPin = await showPromptModal('تفعيل قفل التطبيق', 'أدخل رمز PIN جديد لحماية خصوصيتك:', '', '4 أرقام على الأقل', true);
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
    text: S.appPin ? '🔓 إلغاء رمز PIN' : '🔒 تفعيل رمز PIN جديد'
  });

  const testToneBtn = h('button', {
    class: 'btn ghost small',
    onclick: () => { soundFx.playReceive(); soundFx.playSend(); toast('تم تشغيل نغمات واتساب التجريبية 🎵'); },
    text: '🎵 اختبار النغمة'
  });

  // 7. قياس سرعة الاتصال والـ Ping
  const pingBtn = h('button', {
    class: 'btn ghost small',
    text: '⚡ فحص سرعة الاتصال (Ping)',
    onclick: async () => {
      const t0 = performance.now();
      try {
        await api('/circle');
        const elapsed = Math.round(performance.now() - t0);
        toast(`استجابة السيرفر ممتازة: ${elapsed} مللي ثانية ⚡`, 'info');
      } catch {
        toast('تعذر قياس سرعة الاتصال بالخادم', 'error');
      }
    }
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
        `الحالة: ${currentBio}`)),

    // 2. بطاقة تعديل الاسم والحالة
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title' },
        icon('members', 18),
        h('span', { text: 'الملف الشخصي والحساب' })),
      h('div', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:4px', text: 'الاسم المعروض في المحادثات:' }),
      h('div', { style: 'display:flex;gap:8px;margin-bottom:14px' }, nameInput, saveNameBtn),
      h('div', { style: 'font-size:13px;color:var(--text-secondary);margin-bottom:4px', text: 'الأخبار / الحالة (Bio):' }),
      bioInput,
      bioChips,
      h('div', { style: 'margin-top:8px;display:flex;justify-content:flex-end' }, saveBioBtn),
      h('div', { style: 'margin-top:14px;padding-top:10px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)' },
        h('span', { text: `المعرف: ${S.me.id}` }),
        h('span', { text: `الدائرة: ${S.circle.name}` }))
    ),

    // 3. المظهر والسمات الحديثة
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title' },
        icon('status', 18),
        h('span', { text: 'المظهر والسمات الحديثة' })),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'وضع الألوان (نهاري / ليلي)' }),
          h('div', { class: 'settings-row-desc', text: isDark ? 'الوضع الليلي مفعّل حالياً' : 'الوضع النهاري مفعّل حالياً' })),
        h('button', {
          class: 'btn ghost small',
          onclick: toggleDarkMode,
          text: isDark ? '☀️ تفعيل النهاري' : '🌙 تفعيل الليلي'
        })
      ),
      h('div', { style: 'margin-top:12px' },
        h('div', { style: 'font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:4px', text: 'سمة ألوان واتساب (Color Theme Accent):' }),
        themeAccentPicker),
      h('div', { style: 'margin-top:12px' },
        h('div', { style: 'font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:4px', text: 'حجم خط الرسائل والنصوص:' }),
        fontSelector),
      h('div', { style: 'margin-top:14px' },
        h('div', { style: 'font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:4px', text: 'خلفيات المحادثة:' }),
        wallpaperPalette,
        h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
          h('button', { class: 'btn secondary small block', onclick: () => $('#bg-file-input')?.click(), text: '🖼️ رفع صورة مخصصة' }),
          h('button', { class: 'btn ghost small', onclick: () => { S.chatBackground = null; localStorage.removeItem('wa_preset_bg'); applyChatBg(); toast('تمت استعادة الخلفية الافتراضية'); }, text: 'استعادة الافتراضية' }))
      )
    ),

    // 4. الخصوصية والأمان
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title' },
        icon('lock', 18),
        h('span', { text: 'الخصوصية والأمان' })),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'مؤشرات قراءة الرسائل (العلامات الزرقاء)' }),
          h('div', { class: 'settings-row-desc', text: 'إظهار علامات الصحين ✓✓ الزرقاء عند قراءة الرسائل' })),
        h('label', { class: 'toggle-switch' },
          h('input', {
            type: 'checkbox',
            checked: S.readReceipts,
            onchange: (e) => {
              S.readReceipts = e.target.checked;
              localStorage.setItem('wa_read_receipts', String(S.readReceipts));
              toast(S.readReceipts ? 'تم تفعيل مؤشرات القراءة ✓✓' : 'تم إخفاء مؤشرات القراءة');
            }
          }),
          h('span', { class: 'toggle-slider' }))
      ),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'مؤشر جاري الكتابة' }),
          h('div', { class: 'settings-row-desc', text: 'إظهار عبارة (يكتب الآن...) لأعضاء الدائرة عند الكتابة' })),
        h('label', { class: 'toggle-switch' },
          h('input', {
            type: 'checkbox',
            checked: S.showTyping,
            onchange: (e) => {
              S.showTyping = e.target.checked;
              localStorage.setItem('wa_show_typing', String(S.showTyping));
              toast(S.showTyping ? 'تم تفعيل مؤشر الكتابة' : 'تم إيقاف مؤشر الكتابة');
            }
          }),
          h('span', { class: 'toggle-slider' }))
      ),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'قفل التطبيق برمز PIN' }),
          h('div', { class: 'settings-row-desc', text: S.appPin ? '🟢 القفل مفعّل ومحمي' : '⚪ القفل غير مفعل' })),
        h('div', { style: 'display:flex;gap:6px' },
          pinLockBtn,
          S.appPin ? h('button', { class: 'btn primary small', onclick: lockAppNow, text: '🔒 قفل الآن' }) : null)
      ),
      h('div', { style: 'margin-top:10px;font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px' },
        icon('shield', 16),
        h('span', { text: 'جميع رسائل ومكالمات هذه الدائرة مشفرة ومحمية بالكامل.' }))
    ),

    // 5. المحادثات وإدارة السجل
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title' },
        icon('chat', 18),
        h('span', { text: 'المحادثات وإدارة السجل' })),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'إرسال بمفتاح Enter' }),
          h('div', { class: 'settings-row-desc', text: 'الضغط على Enter يُرسل الرسالة، و Shift+Enter لسطر جديد' })),
        h('label', { class: 'toggle-switch' },
          h('input', {
            type: 'checkbox',
            checked: S.enterSend,
            onchange: (e) => {
              S.enterSend = e.target.checked;
              localStorage.setItem('wa_enter_send', String(S.enterSend));
              toast(S.enterSend ? 'تم تفعيل الإرسال بزر Enter' : 'تم تعطيل الإرسال بزر Enter');
            }
          }),
          h('span', { class: 'toggle-slider' }))
      ),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'التشغيل التلقائي للصوتيات' }),
          h('div', { class: 'settings-row-desc', text: 'تشغيل الملاحظات الصوتية تلقائياً عند وصولها' })),
        h('label', { class: 'toggle-switch' },
          h('input', {
            type: 'checkbox',
            checked: S.autoPlayVoice,
            onchange: (e) => {
              S.autoPlayVoice = e.target.checked;
              localStorage.setItem('wa_auto_play_voice', String(S.autoPlayVoice));
              toast(S.autoPlayVoice ? 'تم تفعيل التشغيل التلقائي للصوت' : 'تم تعطيل التشغيل التلقائي');
            }
          }),
          h('span', { class: 'toggle-slider' }))
      ),
      h('div', { style: 'margin-top:12px;display:flex;gap:8px' },
        h('button', { class: 'btn ghost small block', style: 'flex:1', onclick: () => exportChatHistory('txt'), text: '📄 تصدير سجل الدردشة (.txt)' }),
        h('button', { class: 'btn ghost small block', style: 'flex:1', onclick: () => exportChatHistory('json'), text: '📦 تصدير كبيانات (.json)' })),
      h('div', { style: 'margin-top:10px' },
        h('button', {
          class: 'btn small block',
          style: 'background:rgba(234,67,53,0.1);color:var(--wa-danger);border:1px solid var(--wa-danger);width:100%',
          onclick: async () => {
            const confirmed = await showConfirm(
              'مسح سجل المحادثة بالكامل',
              'هل أنت متأكد تماماً من رغبتك في حذف جميع الرسائل في هذه الدائرة؟ لا يمكن استرجاعها بعد الحذف.',
              'مسح جميع الرسائل',
              'إلغاء',
              true
            );
            if (!confirmed) return;
            try {
              await api('/messages', { method: 'DELETE' });
              S.messages = [];
              toast('تم مسح سجل المحادثة بالكامل بنجاح 🗑️');
              refreshChatList();
            } catch (err) { toast(err.message, 'error'); }
          },
          text: '🗑️ مسح سجل المحادثة بالكامل'
        }))
    ),

    // 6. الإشعارات والأصوات
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title' },
        icon('bell', 18),
        h('span', { text: 'الإشعارات والتنبيهات' })),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'أصوات المحادثة' }),
          h('div', { class: 'settings-row-desc', text: soundFx.enabled ? 'أصوات الإرسال والاستلام مفعلة' : 'الأصوات مكتومة' })),
        h('div', { style: 'display:flex;gap:6px;align-items:center' },
          testToneBtn,
          h('button', { class: 'btn primary small', onclick: () => { toggleSounds(); renderProfile(main); }, text: soundFx.enabled ? 'كتم' : 'تفعيل' }))
      ),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'إشعارات سطح المكتب والهاتف' }),
          h('div', { class: 'settings-row-desc', text: 'تنبيهك بالرسائل الجديدة حتى عند تصغير المتصفح' })),
        h('button', {
          class: 'btn secondary small',
          onclick: () => {
            if ('Notification' in window) {
              Notification.requestPermission().then((p) => {
                toast(p === 'granted' ? 'تم منح إذن الإشعارات بنجاح ✓' : 'تم رفض الإذن', p === 'granted' ? 'info' : 'error');
                renderProfile(main);
              });
            } else toast('الإشعارات غير مدعومة في هذا المتصفح');
          },
          text: 'طلب الإذن 🔔'
        })
      ),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-info' },
          h('div', { class: 'settings-row-title', text: 'الاهتزاز عند التنبيه' }),
          h('div', { class: 'settings-row-desc', text: 'اهتزاز لطيف للأجهزة المدعومة' })),
        h('label', { class: 'toggle-switch' },
          h('input', {
            type: 'checkbox',
            checked: S.vibration,
            onchange: (e) => {
              S.vibration = e.target.checked;
              localStorage.setItem('wa_vibration', String(S.vibration));
              if (S.vibration && navigator.vibrate) navigator.vibrate(100);
              toast(S.vibration ? 'تم تفعيل الاهتزاز' : 'تم تعطيل الاهتزاز');
            }
          }),
          h('span', { class: 'toggle-slider' }))
      )
    ),

    // 7. التخزين والوسائط
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title' },
        icon('image', 18),
        h('span', { text: 'الوسائط والتخزين' })),
      h('div', { style: 'display:flex;gap:8px;margin-bottom:10px' },
        h('button', { class: 'btn secondary block', style: 'flex:1', onclick: openMediaGallery, text: '🖼️ معرض الوسائط والمستندات' }),
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

    // 8. الاختصارات وفحص الخادم
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title' },
        h('span', { text: '⌨️' }),
        h('span', { text: 'الاختصارات ودليل الاستخدام' })),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn ghost block', style: 'flex:1;text-align:right;justify-content:flex-start;gap:8px', onclick: openShortcutsModal, text: '⌨️ عرض دليل الاختصارات الشامل (Ctrl+/)' }),
        pingBtn),
      h('div', { style: 'margin-top:10px;font-size:12px;color:var(--text-muted);text-align:center' },
        `واتساب الدائرة الخاصة • الإصدار 2.5 العصري • جاهز للاستخدام والتكامل السحابي`)
    ),

    // 9. إدارة الحساب والخروج
    h('div', { class: 'settings-section-card' },
      h('div', { class: 'settings-section-title', style: 'color:var(--wa-danger)' },
        icon('close', 18),
        h('span', { text: 'إدارة الحساب والخروج' })),
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
      title: '🎨 التخصيص والأمان',
      items: [
        { key: 'Ctrl + D', desc: 'التبديل بين الوضع الليلي والنهاري 🌙/☀️' },
        { key: 'Ctrl + M', desc: 'تفعيل أو كتم أصوات واتساب 🔔/🔕' },
        { key: 'Ctrl + Shift + L', desc: 'قفل التطبيق فوراً برمز PIN 🔒' },
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
      const openModal = document.querySelector('.modal-overlay, .wa-modal-overlay');
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

    if (!inInput && e.key === '?') {
      e.preventDefault();
      openShortcutsModal();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      lockAppNow();
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
  const ok = await showConfirm(
    'مغادرة الدائرة',
    'هل أنت متأكد من مغادرة الدائرة نهائياً؟ سيتم حذف جميع منشوراتك ورسائلك من السيرفر.',
    'مغادرة الدائرة',
    'إلغاء',
    true
  );
  if (!ok) return;
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
    case 'message_poll': {
      const m = S.messages.find((x) => x.id === ev.id);
      if (m) {
        m.poll = ev.poll;
        const oldBubble = document.getElementById(`msg-bubble-${m.id}`);
        if (oldBubble && oldBubble.parentElement) {
          const newRow = chatBubble(m);
          oldBubble.parentElement.replaceWith(newRow);
        }
      }
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
