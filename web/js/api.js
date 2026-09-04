/* ماسنجر لايت — طبقة الاتصال: جلسة + REST + WebSocket مع إعادة اتصال ذكية */
const TOKEN_KEY = 'ml_token';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  set(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  },
};

export async function api(path, { method = 'GET', body } = {}) {
  const token = session.token;
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    const err = new Error('لا يوجد اتصال بالخادم — تحقق من الإنترنت');
    err.code = 'network';
    throw err;
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* رد غير JSON من الخادم (مثل 502/503/404 من البروكسي) */
    data = {};
  }
  if (!res.ok || data.ok === false) {
    let msg = data.message;
    if (!msg) {
      if (res.status === 401) msg = 'انتهت صلاحية الجلسة — يرجى تسجيل الدخول مجدداً';
      else if (res.status === 403) msg = 'غير مصرح بالوصول إلى هذا المورد';
      else if (res.status === 404) msg = 'المورد المطلوب غير موجود في الخادم';
      else if (res.status >= 500) msg = 'الخادم قيد التشغيل أو يعالج طلباً آخر — أعد المحاولة';
      else msg = 'تعذر الاتصال بالخادم (رمز ' + res.status + ')';
    }
    const err = new Error(msg);
    err.code = data.code || (res.status === 401 ? 'unauthorized' : 'unknown');
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * اتصال لحظي مع إعادة محاولة تلقائية.
 * onAuthLost يُستدعى عندما يرفض السيرفر الجلسة نهائياً (دخول من جهاز آخر)
 * حتى لا تدور حلقة إعادة اتصال بلا نهاية.
 */
export function connect(onEventOrOpts, onStatus, onAuthLost) {
  let onEvent = onEventOrOpts;
  let onStatusFn = onStatus;
  let onAuthLostFn = onAuthLost;

  if (typeof onEventOrOpts === 'object' && onEventOrOpts !== null) {
    onEvent = onEventOrOpts.onEvent;
    onStatusFn = onEventOrOpts.onConnectChange || onEventOrOpts.onStatus;
    onAuthLostFn = onEventOrOpts.onAuthLost;
  }

  const token = session.token;
  let ws = null;
  let closed = false;
  let retry = 0;
  let timer = null;

  function notifyStatus(status) {
    if (typeof onStatusFn === 'function') {
      try { onStatusFn(status); } catch { /* ignore */ }
    }
  }

  function open() {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => { retry = 0; notifyStatus(true); };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (typeof onEvent === 'function') onEvent(data);
      } catch { /* رسالة غير صالحة */ }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* تجاهل */ } };
    ws.onclose = (e) => {
      notifyStatus(false);
      if (closed) return;
      if (e.code === 4001) {
        if (typeof onAuthLostFn === 'function') onAuthLostFn();
        return;
      }
      retry += 1;
      timer = setTimeout(open, Math.min(1000 * retry, 10000));
    };
  }
  open();

  return {
    send(data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(typeof data === 'string' ? data : JSON.stringify(data));
        return true;
      }
      return false;
    },
    close() { closed = true; clearTimeout(timer); try { ws && ws.close(); } catch { /* سبق إغلاقه */ } },
  };
}
