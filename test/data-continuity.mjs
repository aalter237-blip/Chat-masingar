/**
 * Data continuity test: everything must survive a server restart.
 *
 *   node test/data-continuity.mjs
 *
 * The server persists to a SQLite DB and keeps a stable JWT secret, so:
 *   - a login session (access token) stays valid across a restart,
 *   - accounts, conversations and messages are still there after a restart.
 *
 * This is what makes a real deployment safe: restarts, deploys and even a
 * crashed box lose nothing that matters.
 *
 * The test boots its own server with a temporary database and a fixed
 * JWT_SECRET (exactly how production sets it), kills it, boots it again on
 * the SAME database, and asserts the data and session survived.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BASE_PORT = 4500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${BASE_PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'masingar-continuity-'));

/** A fixed secret the same way production sets one; never on a real deploy. */
const JWT_SECRET = 'continuity-test-secret-' + 'x'.repeat(40);

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

const env = () => ({
  ...process.env,
  PORT: String(BASE_PORT),
  DB_PATH: join(dataDir, 'continuity.db'),
  JWT_SECRET,
  SMS_PROVIDER: 'none',
  DEMO_SEED: 'false',
  NODE_ENV: 'production',
});

function bootServer() {
  const child = spawn('node', ['src/index.js'], {
    cwd: join(root, 'server'),
    env: env(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));
  return { child, log: () => log };
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* keep trying */
    }
    await sleep(200);
  }
  return false;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function stop(child) {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(resolve, 3000).unref();
  });
}

let srv = bootServer();
try {
  console.log('\ndata continuity: sessions and data survive a restart\n');

  /* ---- boot #1 --------------------------------------------------------- */
  check('first boot: server is up', await waitForServer());

  const PHONE = '967770000555';
  const asked = await api('/api/auth/otp/request', { method: 'POST', body: { phone: PHONE } });
  check('the code is handed back to the API (provider none)', /^\d{6}$/.test(asked.data.devCode || ''), asked.data.devCode);
  const code = asked.data.devCode;

  const verified = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { phone: PHONE, code, name: 'استمرارية', locale: 'ar', device: 'data-continuity-test' },
  });
  const token = verified.data.accessToken;
  const userId = verified.data.user?.id;
  check('a session is created', typeof token === 'string', JSON.stringify(verified.data));
  check('an account is created', Boolean(userId));

  /* an account + a private conversation + a message to keep alive */
  const phone2 = '967770000556';
  const b = await api('/api/auth/otp/request', { method: 'POST', body: { phone: phone2 } });
  const bv = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { phone: phone2, code: b.data.devCode, name: 'بعد' },
  });
  const tokenB = bv.data.accessToken;

  const conv = await api('/api/conversations', {
    method: 'POST',
    token,
    body: { userId: bv.data.user.id },
  });
  const convId = conv.data.conversation?.id;
  check('a conversation is created', Boolean(convId), JSON.stringify(conv.data));

  const sent = await api(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    token,
    body: { type: 'text', body: JSON.stringify({ t: 'text', x: 'رسالة قبل إعادة التشغيل' }), clientId: 'continuity-1' },
  });
  const msgId = sent.data.message?.id;
  check('a message is stored', Boolean(msgId));

  /* ---- restart --------------------------------------------------------- */
  console.log('  restarting the server on the same database…');
  await stop(srv.child);
  srv = bootServer();
  check('second boot: server is up again', await waitForServer());

  /* the previous session token must still be accepted */
  const me = await api('/api/me', { token });
  check('the pre-restart session still opens the account', me.status === 200 && me.data.user?.id === userId, `${me.status}`);

  /* the account, conversation and message are still there */
  const inbox = await api(`/api/conversations/${convId}/messages`, { token });
  const got = inbox.data.messages?.find((m) => m.id === msgId);
  check('the conversation is still listed', Boolean(inbox.data.messages));
  check(
    'the message survived the restart',
    JSON.parse(got?.body || '{}').x === 'رسالة قبل إعادة التشغيل',
    got?.body,
  );

  /* the second account's session also still works */
  const meB = await api('/api/me', { token: tokenB });
  check('the second session also survives', meB.status === 200 && meB.data.user?.phone === phone2, `${meB.status}`);

  const health = await api('/api/health');
  check('both real accounts persist', health.data.users === 2, `users=${health.data.users}`);
} catch (err) {
  failed++;
  console.log(`  ✗ unexpected error: ${err.message}`);
  console.log(srv.log().split('\n').slice(-15).join('\n'));
} finally {
  await stop(srv.child).catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
