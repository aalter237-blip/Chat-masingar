/* REST + WebSocket client for the Masingar server. */

const TOKEN_KEY = 'masingar.token';
const REFRESH_KEY = 'masingar.refresh';
const USER_KEY = 'masingar.user';

export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  },
  get refreshToken() {
    return localStorage.getItem(REFRESH_KEY) || '';
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  save(accessToken, refreshToken, user) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

async function request(method, path, body, isForm = false) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = { ok: false, message: 'Invalid server response' };
  }
  if (res.status === 401) {
    // try a refresh once
    const refreshed = await refresh();
    if (refreshed) return request(method, path, body, isForm);
    session.clear();
    window.dispatchEvent(new CustomEvent('masingar:unauthorized'));
  }
  if (!res.ok) throw Object.assign(new Error(json?.message || `HTTP ${res.status}`), { code: json?.code, status: res.status });
  return json;
}

let refreshing = null;
export function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!session.refreshToken) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const json = await res.json();
      if (!json?.ok) return false;
      session.save(json.accessToken, json.refreshToken, json.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const api = {
  /** Public server information: health, users, sms provider, demo mode. */
  health: () => request('GET', '/health'),
  requestOtp: (phone) => request('POST', '/auth/otp/request', { phone }),
  verifyOtp: (phone, code, name) => request('POST', '/auth/otp/verify', { phone, code, name, device: navigator.userAgent.slice(0, 80) }),
  me: () => request('GET', '/me'),
  updateMe: (patch) => request('PATCH', '/me', patch),
  pushToken: (token) => request('POST', '/me/push-token', { token, platform: 'web' }),
  ice: () => request('GET', '/ice'),
  syncContacts: (contacts) => request('POST', '/contacts/sync', { contacts }),
  contacts: () => request('GET', '/contacts'),
  conversations: () => request('GET', '/conversations'),
  createConversation: (payload) => request('POST', '/conversations', payload),
  messages: (convId, { limit, before, after } = {}) => {
    const q = new URLSearchParams();
    if (limit) q.set('limit', limit);
    if (before) q.set('before', before);
    if (after) q.set('after', after);
    return request('GET', `/conversations/${convId}/messages?${q}`);
  },
  sendMessage: (convId, payload) => request('POST', `/conversations/${convId}/messages`, payload),
  read: (convId) => request('POST', `/conversations/${convId}/read`),
  settings: (convId, settings) => request('POST', `/conversations/${convId}/settings`, { settings }),
  groupKeys: (convId) => request('GET', `/conversations/${convId}/keys`),
  setGroupKeys: (convId, keys) => request('POST', `/conversations/${convId}/keys`, { keys }),
  editMessage: (id, body) => request('PUT', `/messages/${id}`, { body }),
  deleteMessage: (id) => request('DELETE', `/messages/${id}`),
  calls: () => request('GET', '/calls'),
  usersByPhone: (phone) => request('GET', `/users/by-phone/${encodeURIComponent(phone)}`),
  search: (q) => request('GET', `/search?q=${encodeURIComponent(q)}`),
  sync: (since) => request('GET', `/sync?since=${since}`),
  upload: async (file, extra = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return request('POST', '/uploads', form, true);
  },
};

/* --------------------------- realtime socket -------------------------- */

export class Realtime extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.retries = 0;
    this.queue = [];
    this.connected = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(session.token)}`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      this.retries = 0;
      const pending = this.queue.splice(0);
      for (const frame of pending) this.send(frame);
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true } }));
    });

    ws.addEventListener('message', (ev) => {
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.dispatchEvent(new CustomEvent('frame', { detail: frame }));
      if (frame.t) this.dispatchEvent(new CustomEvent(frame.t, { detail: frame }));
    });

    ws.addEventListener('close', () => {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: false } }));
      const delay = Math.min(30_000, 800 * 2 ** this.retries++);
      setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener('error', () => ws.close());
  }

  send(frame) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(frame));
    else this.queue.push(frame);
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
