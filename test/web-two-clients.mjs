/**
 * Two real web clients in two jsdom windows, talking through a live server.
 *
 * This drives the actual UI code (web/js/app.js) of both sides:
 *
 *   • messages are encrypted on one side and read on the other
 *   • the server only ever stores the envelope (checked over REST)
 *   • the wallpaper set by one side appears on the other, live
 *   • pressing PrintScreen on one side writes a notice into the other chat
 *
 *   node test/web-two-clients.mjs [baseUrl]
 */
import { webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let build;
let JSDOM;
let VirtualConsole;
try {
  ({ build } = await import('esbuild'));
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  console.log('jsdom / esbuild are not installed -> skipping the two client UI test');
  console.log('(install them with: cd test && npm i jsdom esbuild)');
  process.exit(0);
}

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:3000';
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', 'web');

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until `fn()` is truthy (or the timeout expires) and returns the value. */
async function waitFor(fn, timeout = 12000, step = 400) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let value = null;
    try {
      value = await fn();
    } catch {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(step);
  }
}

/* --------------------------------- helpers --------------------------------- */
async function api(path, { method = 'GET', token, body, retries = 3 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  if (res.status === 429 && retries > 0) {
    await sleep(12000);
    return api(path, { method, token, body, retries: retries - 1 });
  }
  return json;
}

async function tokenFor(phone) {
  const otp = await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const ok = await api('/api/auth/otp/verify', { method: 'POST', body: { phone, code: otp.devCode } });
  return { token: ok.accessToken, user: ok.user };
}

/** Builds the app once and hands out a browser window per run. */
async function openWindow(bundle, phone) {
  const html = readFileSync(join(web, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, {
    url: BASE + '/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.fetch = (url, opts) =>
    fetch(new URL(url, BASE), opts).then((res) => ({
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
    }));
  window.AudioContext = class {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
    }
    createOscillator() {
      return { frequency: { value: 0 }, connect: () => this, start() {}, stop() {} };
    }
    createGain() {
      return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect: () => this };
    }
    get destination() {
      return this;
    }
    resume() {}
  };
  window.MediaRecorder = class {
    start() {}
    stop() {}
  };
  window.RTCPeerConnection = class {
    addTrack() {}
    addTransceiver() {}
    close() {}
    createOffer() {
      return Promise.resolve({});
    }
    createAnswer() {
      return Promise.resolve({});
    }
    setLocalDescription() {
      return Promise.resolve();
    }
    setRemoteDescription() {
      return Promise.resolve();
    }
    addEventListener() {}
    getStats() {
      return Promise.resolve(new Map());
    }
  };
  window.RTCSessionDescription = class {};
  window.navigator.mediaDevices = {
    getUserMedia: () => Promise.resolve({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }),
    enumerateDevices: () => Promise.resolve([]),
  };
  window.navigator.serviceWorker = { register: () => Promise.resolve({}) };
  window.prompt = () => null;
  // jsdom has no WebCrypto: give it Node's so the app can encrypt for real
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
  window.eval(bundle);
  await sleep(400);

  const doc = window.document;
  doc.querySelector('#country-code').value = '967';
  doc.querySelector('#phone').value = phone;
  doc.querySelector('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(700);
  const codeInput = doc.querySelector('#code');
  if (!codeInput || codeInput.value.length !== 6) throw new Error(`no code for ${phone}`);
  doc.querySelector('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1200);
  const nameOk = doc.querySelector('.modal-actions .btn.primary');
  if (nameOk) {
    nameOk.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(400);
  }
  await sleep(900);
  if (!doc.querySelector('#screen-main')?.classList.contains('active')) {
    throw new Error(`login failed for ${phone}`);
  }
  return { window, doc, errors };
}

const openChatWith = async ({ window, doc }, titlePart) => {
  const items = [...doc.querySelectorAll('#view-chats .list-item')];
  const item = items.find((el) => (el.textContent || '').includes(titlePart));
  if (!item) return false;
  item.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(900);
  return !!doc.querySelector('#screen-chat')?.classList.contains('active');
};

/* ----------------------------------- run ----------------------------------- */
async function main() {
  const alice = await tokenFor('967771000001');
  const bob = await tokenFor('967771000002');
  const conv = await api('/api/conversations', {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.user.id },
  });
  const convId = conv.conversation.id;

  const out = join(mkdtempSync(join(tmpdir(), 'masingar-two-')), 'bundle.js');
  await build({
    entryPoints: [join(web, 'js', 'app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: out,
    logLevel: 'silent',
  });
  const bundle = readFileSync(out, 'utf8');

  console.log('two web clients (jsdom) through a live server');
  const a = await openWindow(bundle, '771000001');
  const b = await openWindow(bundle, '771000002');
  check('both clients are logged in', true);

  await sleep(800);
  check('client A opened the chat with سارة', await openChatWith(a, 'سارة'));
  check('client B opened the chat with أحمد', await openChatWith(b, 'أحمد'));

  /* ------------------------- 1:1 encrypted message ------------------------- */
  const secret = `سر ${Math.random().toString(36).slice(2, 10)}`;
  a.doc.querySelector('#input').value = secret;
  a.doc.querySelector('#composer').dispatchEvent(new a.window.Event('submit', { bubbles: true, cancelable: true }));

  const delivered = await waitFor(async () => {
    const list = await api(`/api/conversations/${convId}/messages`, { token: bob.token });
    return list.messages.some((m) => m.encrypted && m.body.length > 40) ? list : null;
  });
  check('the message reached the server encrypted', !!delivered);
  check(
    'the server never sees the text',
    delivered && !delivered.messages.some((m) => (m.body || '').includes(secret)),
  );
  check(
    'the stored envelope is opaque',
    delivered &&
      delivered.messages
        .filter((m) => m.encrypted)
        .every((m) => /^[A-Za-z0-9+/=]+$/.test(m.body || '') && !m.body.includes(secret)),
  );

  const opened = await waitFor(() => {
    const bubbles = [...b.doc.querySelectorAll('#messages .msg')].map((el) => el.textContent || '');
    return bubbles.some((t) => t.includes(secret)) ? bubbles : null;
  });
  check('the other client decrypted it', !!opened, opened ? '' : 'timed out');
  check(
    'no raw envelope is ever shown',
    opened && !opened.some((t) => t.includes('"ct"') || t.includes('eyJ')),
  );

  /* --------------------------- encrypted group chat ----------------------- */
  const group = await api('/api/conversations', {
    method: 'POST',
    token: alice.token,
    body: { type: 'group', title: `مجموعة ${Math.random().toString(36).slice(2, 6)}`, memberIds: [bob.user.id] },
  });
  const groupId = group.conversation.id;
  const groupSecret = `سري للمجموعة ${Math.random().toString(36).slice(2, 8)}`;
  // a fresh window for A: it now loads the list that contains the new group
  // (and publishes a brand new identity key, which B receives as user:key)
  const a2 = await openWindow(bundle, '771000001');
  await sleep(1200);
  check('client A opened the group', await openChatWith(a2, group.conversation.title));
  check('client B opened the group', await openChatWith(b, group.conversation.title));
  await sleep(1200);
  a2.doc.querySelector('#input').value = groupSecret;
  a2.doc.querySelector('#composer').dispatchEvent(new a2.window.Event('submit', { bubbles: true, cancelable: true }));

  const groupOpened = await waitFor(() => {
    const bubbles = [...b.doc.querySelectorAll('#messages .msg')].map((el) => el.textContent || '');
    return bubbles.some((t) => t.includes(groupSecret)) ? bubbles : null;
  });
  check('the group message opened on the other device', !!groupOpened);
  const groupStored = await api(`/api/conversations/${groupId}/messages`, { token: bob.token });
  check(
    'the group message is stored encrypted',
    groupStored.messages.some((m) => m.encrypted) &&
      !groupStored.messages.some((m) => (m.body || '').includes(groupSecret)),
  );
  const keys = await api(`/api/conversations/${groupId}/keys`, { token: bob.token });
  check('a group key was wrapped for the member', (keys.keys || []).length >= 1);

  // back to the direct chat for the remaining checks
  await openChatWith(a2, 'سارة');
  await openChatWith(b, 'أحمد');
  await sleep(600);

  /* ------------------------------- wallpaper -------------------------------- */
  a2.doc.querySelector('#btn-wallpaper')?.dispatchEvent(new a2.window.Event('click', { bubbles: true }));
  await sleep(500);
  const items = [...a2.doc.querySelectorAll('.wall-item')];
  const teal = items.find((el) => (el.textContent || '').includes('أخضر'));
  check('the wallpaper picker lists the shared presets', items.length >= 6, `items=${items.length}`);
  teal?.dispatchEvent(new a2.window.Event('click', { bubbles: true }));
  await sleep(1800);
  const settings = await api('/api/conversations', { token: bob.token });
  const shared = settings.conversations.find((c) => c.id === convId)?.settings?.wallpaper;
  check('the wallpaper was saved on the server', shared?.id === 'teal', JSON.stringify(shared));
  const bBackground = b.doc.querySelector('#messages')?.getAttribute('style') || '';
  check(
    'the other client paints the same wallpaper',
    bBackground.includes('gradient') || bBackground.includes('rgb'),
    bBackground,
  );

  /* ------------------------------ screenshot -------------------------------- */
  a2.window.dispatchEvent(new a2.window.KeyboardEvent('keyup', { key: 'PrintScreen', bubbles: true }));
  await sleep(1800);
  const notices = [...b.doc.querySelectorAll('#messages .system-msg')].map((el) => el.textContent || '');
  check('the screenshot notice reached the other side', notices.some((t) => t.includes('لقطة')), notices.slice(-1).join(''));
  const persisted = await api(`/api/conversations/${convId}/messages`, { token: bob.token });
  check(
    'the notice stays in the history',
    persisted.messages.some((m) => m.type === 'system' && (m.body || '').includes('لقطة')),
  );

  check('client A had no runtime errors', a.errors.length === 0 && a2.errors.length === 0, [...a.errors, ...a2.errors].slice(0, 2).join(' | '));
  check('client B had no runtime errors', b.errors.length === 0, b.errors.slice(0, 2).join(' | '));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  a.window.close();
  a2.window.close();
  b.window.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
