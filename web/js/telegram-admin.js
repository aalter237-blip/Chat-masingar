/**
 * Telegram OTP bot admin view (/telegram): shows the bot status and the list
 * of linked phone numbers (masked). No token needed — the page exposes only
 * state, never secrets.
 */
const $ = (s) => document.querySelector(s);

async function refresh() {
  try {
    const res = await fetch('/api/telegram/status');
    const info = await res.json();
    const status = $('#tg-status');
    const text = $('#tg-status-text');

    if (!info.enabled) {
      status.classList.remove('on');
      text.textContent = 'البوت غير مفعّل — اضبط TELEGRAM_BOT_TOKEN ثم أعد تشغيل السيرفر.';
      return;
    }
    status.classList.add('on');
    const bot = info.botUsername || 'بدون اسم مستخدم';
    text.textContent = `البوت ${bot} يعمل — ${info.linked} رقم مرتبط`;

    const wrap = $('#tg-list-wrap');
    const list = $('#tg-list');
    list.innerHTML = '';
    if (info.phones && info.phones.length) {
      wrap.classList.remove('hidden');
      $('#tg-count').textContent = info.phones.length;
      for (const phone of info.phones) {
        list.append(
          h('div', { class: 'row' }, [h('span', {}, '+' + phone), h('span', { class: 'chip' }, 'مرتبط')])
        );
      }
    } else {
      wrap.classList.remove('hidden');
      $('#tg-count').textContent = 0;
      list.append(h('div', { class: 'row' }, [h('span', {}, 'لا يوجد أي رقم مرتبط بعد'), h('span', {}, '—')]));
    }
  } catch {
    $('#tg-status-text').textContent = 'تعذّر الوصول للسيرفر — أعد المحاولة لاحقًا.';
  }
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of [].concat(children)) {
    if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c ?? '')));
  }
  return el;
}

refresh();
setInterval(refresh, 5000);
