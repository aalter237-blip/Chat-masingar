/**
 * Headless smoke test for the web client (jsdom + esbuild).
 *
 * It logs a demo user in, renders the chat list, opens a conversation, sends a
 * message and fails on any console error / unhandled rejection.
 *
 *   npm i -D jsdom esbuild
 *   node test/web-smoke.mjs [baseUrl]
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
let build;
let JSDOM;
let VirtualConsole;
try {
  ({ build } = await import('esbuild'));
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  console.log('jsdom / esbuild are not installed -> skipping the web UI smoke test');
  console.log('(install them with: cd test && npm i jsdom esbuild)');
  process.exit(0);
}

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', 'web');

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  /* bundle the ES modules into one classic script jsdom can execute */
  const out = join(mkdtempSync(join(tmpdir(), 'masingar-')), 'bundle.js');
  await build({
    entryPoints: [join(web, 'js', 'app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: out,
    logLevel: 'silent',
  });

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

  /* --- browser APIs jsdom does not implement ------------------------- */
  window.fetch = (url, opts) => fetch(new URL(url, BASE), opts).then((res) => {
    // jsdom scripts expect a browser-like Response: clone the essentials
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
    };
  });
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

  /* --- run the app ---------------------------------------------------- */
  window.eval(readFileSync(out, 'utf8'));
  await sleep(400);

  check('login screen is visible', window.document.querySelector('#screen-login')?.classList.contains('active'));
  check('country codes populated', window.document.querySelectorAll('#country-code option').length > 20);
  check('demo accounts shown', window.document.querySelectorAll('#demo-list .demo-chip').length >= 4);

  /* log in with a demo account */
  const code = window.document.querySelector('#country-code');
  code.value = '967';
  window.document.querySelector('#phone').value = '771000001';
  window.document.querySelector('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(600);

  const codeInput = window.document.querySelector('#code');
  check('verification code received', codeInput && codeInput.value.length === 6, codeInput?.value);

  window.document.querySelector('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1200);

  // a brand new profile asks for a name - dismiss it if it appeared
  const nameOk = window.document.querySelector('.modal-actions .btn.primary');
  if (nameOk) {
    nameOk.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(500);
  }
  await sleep(900);

  check('main screen is visible', window.document.querySelector('#screen-main')?.classList.contains('active'));
  const chatItems = window.document.querySelectorAll('#view-chats .list-item');
  check('chat list rendered', chatItems.length >= 1, `items=${chatItems.length}`);

  /* open the first conversation and send a message */
  chatItems[0]?.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(700);
  check('chat screen opened', window.document.querySelector('#screen-chat')?.classList.contains('active'));
  const before = window.document.querySelectorAll('#messages .msg').length;

  window.document.querySelector('#input').value = 'اختبار تلقائي ✓';
  window.document.querySelector('#composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(900);
  const after = window.document.querySelectorAll('#messages .msg').length;
  check('message sent and rendered', after === before + 1, `before=${before} after=${after}`);

  /* tabs */
  for (const tab of ['calls', 'contacts', 'settings']) {
    window.document.querySelector(`.tab[data-tab="${tab}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(350);
    check(`tab ${tab} renders`, window.document.querySelector(`#view-${tab}`)?.classList.contains('active') && window.document.querySelector(`#view-${tab}`).children.length > 0);
  }

  check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  dom.window.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
