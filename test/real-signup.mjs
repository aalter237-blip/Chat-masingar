/**
 * Real use test: personal numbers, real activation, real messaging.
 *
 *   node test/real-signup.mjs
 *
 * It boots a server the way it is meant to be run in production:
 *   DEMO_SEED=false      -> no demo accounts are created at all
 *   SMS_PROVIDER=console -> the code goes to a gateway, never back to the API
 *
 * Then two brand new phone numbers register themselves, find each other and
 * exchange messages. The gateway here is the console, so no SMS is actually
 * sent; the code is read from the server log exactly as an operator would.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = String(Number(process.env.TEST_PORT || 0) || 4300 + Math.floor(Math.random() * 400));
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'masingar-real-'));

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

/* ------------------------------- the server ------------------------------- */
let log = '';
const server = spawn('node', ['src/index.js'], {
  cwd: join(root, 'server'),
  env: {
    ...process.env,
    PORT,
    DB_PATH: join(dataDir, 'real.db'),
    SMS_PROVIDER: 'console',
    DEMO_SEED: 'false',
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => {
  log += d.toString();
});
server.stderr.on('data', (d) => {
  log += d.toString();
});

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
  return { status: res.status, data, text: JSON.stringify(data) };
}

/** The console gateway prints the code; that is where an operator reads it. */
function codeFromLog(phone) {
  const re = new RegExp(`verification code for \\+${phone} is (\\d{6})`, 'g');
  let found = '';
  let m;
  while ((m = re.exec(log))) found = m[1];
  return found;
}

/** Registers a brand new personal number from start to finish. */
async function signUp(phone, name) {
  const asked = await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const code = codeFromLog(phone);
  const verified = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { phone, code, name, locale: 'ar', device: 'real-signup-test' },
  });
  return { asked, code, verified };
}

try {
  console.log('\nreal use: personal numbers, no demo accounts\n');

  const up = await waitForServer();
  check('server is up', up);
  if (!up) throw new Error('server did not start');

  /* 1. no demo accounts ---------------------------------------------------- */
  const health = await api('/api/health');
  check('no user is seeded on a fresh install', health.data.users === 0, `users=${health.data.users}`);
  check('the server does not advertise a demo box', health.data.demo === false, `demo=${health.data.demo}`);
  check('the sms provider is not the development one', health.data.sms === 'console', health.data.sms);

  /* 2. a personal number registers itself ---------------------------------- */
  const A_PHONE = '967770000101';
  const a = await signUp(A_PHONE, 'خالد');
  check('the code is not returned by the api', a.asked.data.devCode === undefined, JSON.stringify(a.asked.data));
  check('the code does not appear anywhere in the response', !/\d{6}/.test(a.asked.text.replace(A_PHONE, '')));
  check('the gateway accepted the message', a.asked.data.delivered === true);
  check('the number is new', a.asked.data.isNew === true);
  check('a real code was handed to the gateway', /^\d{6}$/.test(a.code), a.code);
  check('verification returns a session', typeof a.verified.data.accessToken === 'string');
  check('the account carries the name that was given', a.verified.data.user?.name === 'خالد', a.verified.data.user?.name);
  check('the account carries the real phone number', a.verified.data.user?.phone === A_PHONE);

  /* 3. a wrong code is refused --------------------------------------------- */
  const wrong = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { phone: A_PHONE, code: '000000' },
  });
  check('a wrong code does not open the account', wrong.status === 400 && !wrong.data.accessToken);

  /* 4. a second person ----------------------------------------------------- */
  const B_PHONE = '967770000102';
  const b = await signUp(B_PHONE, 'سالم');
  check('a second number registers the same way', typeof b.verified.data.accessToken === 'string');
  const A = a.verified.data.accessToken;
  const B = b.verified.data.accessToken;
  check('the two accounts are different', a.verified.data.user.id !== b.verified.data.user.id);

  /* 5. they find each other ------------------------------------------------ */
  const found = await api(`/api/search?q=${B_PHONE}`, { token: A });
  check(
    'searching the phone number finds the person',
    found.data.users?.some((u) => u.phone === B_PHONE),
    JSON.stringify(found.data.users?.map((u) => u.phone)),
  );

  /* 6. and they really talk ------------------------------------------------ */
  const conv = await api('/api/conversations', {
    method: 'POST',
    token: A,
    body: { userId: b.verified.data.user.id },
  });
  const convId = conv.data.conversation?.id;
  check('a conversation between the two is opened', Boolean(convId), JSON.stringify(conv.data));

  const sent = await api(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    token: A,
    body: { type: 'text', body: JSON.stringify({ t: 'text', x: 'مرحباً سالم، هذه رسالة حقيقية' }), clientId: 'real-1' },
  });
  check('the message is accepted', sent.status === 200 && Boolean(sent.data.message?.id));

  const inbox = await api(`/api/conversations/${convId}/messages`, { token: B });
  const got = inbox.data.messages?.find((m) => m.id === sent.data.message?.id);
  check('the other person receives it', Boolean(got));
  check(
    'the text arrives intact',
    JSON.parse(got?.body || '{}').x === 'مرحباً سالم، هذه رسالة حقيقية',
    got?.body,
  );

  const reply = await api(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    token: B,
    body: { type: 'text', body: JSON.stringify({ t: 'text', x: 'وعليكم السلام خالد' }), clientId: 'real-2' },
  });
  const back = await api(`/api/conversations/${convId}/messages`, { token: A });
  check(
    'the reply comes back to the sender',
    back.data.messages?.some((m) => m.id === reply.data.message?.id),
  );

  /* 7. only the two of them are in it -------------------------------------- */
  const list = await api('/api/conversations', { token: A });
  const mine = list.data.conversations?.find((c) => c.id === convId);
  check('the conversation has exactly the two members', mine?.members?.length === 2, String(mine?.members?.length));

  const health2 = await api('/api/health');
  check('exactly the two real accounts exist', health2.data.users === 2, `users=${health2.data.users}`);
} catch (err) {
  failed++;
  console.log(`  ✗ unexpected error: ${err.message}`);
  console.log(log.split('\n').slice(-15).join('\n'));
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
