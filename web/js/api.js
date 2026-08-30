/* ماسنجر لايت — طبقة الاتصال: جلسة + REST + WebSocket */
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
  } catch {
    const err = new Error('لا يوجد اتصال بالخادم — تحقق من الإنترنت');
    err.code = 'network';
    throw err;
  }
  let data = {};
  try { data = await res.json(); } catch { /* رد غير JSON */ }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || 'حدث خطأ غير متوقع');
    err.code = data.code || 'unknown';
    err.status = res.status;
    throw err;
  }
  return data;
}

/** اتصال لحظي مع إعادة محاولة تلقائية. */
export function connect(onEvent, onStatus) {
  const token = session.token;
  let ws = null;
  let closed = false;
  let retry = 0;
  let timer = null;

  function open() {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => { retry = 0; onStatus(true); };
    ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* رسالة غير صالحة */ } };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      onStatus(false);
      if (closed) return;
      retry += 1;
      timer = setTimeout(open, Math.min(1000 * retry, 10000));
    };
  }
  open();

  return {
    close() { closed = true; clearTimeout(timer); try { ws && ws.close(); } catch { /* سبق إغلاقه */ } },
  };
}
