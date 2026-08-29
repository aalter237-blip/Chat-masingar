/**
 * Runs the whole test suite in the right order.
 *
 *   node test/run-all.mjs
 *
 * 1. crypto reference vectors   (python3, RFC 7748 / RFC 5869 + Node vectors)
 * 2. web engine unit tests      (test/e2ee-web.mjs)
 * 3. web <-> android cross test (test/e2ee-cross.mjs)
 * 4. TextBee SMS provider       (test/sms-textbee.mjs, offline, fetch is stubbed)
 *    WhatsApp (Meta Cloud API)  (test/sms-whatsapp.mjs, offline, fetch is stubbed)
 * 5. real signup + messaging    (test/real-signup.mjs, own server, DEMO_SEED=false)
 * 6. server REST/WebSocket e2e  (server/test/e2e.mjs, own server + temp db)
 * 7. live end-to-end            (test/e2ee-live.mjs, same server)
 * 8. two web clients            (test/web-two-clients.mjs, jsdom, same server)
 * 9. web UI smoke test          (test/web-smoke.mjs, needs jsdom in test/node_modules)
 *
 * The last three suites drive the server started right here, so no server has
 * to be running on port 3000 beforehand.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = process.env.TEST_PORT || '3999';

function run(command, args, options = {}) {
  const res = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) },
  });
  return (res.status ?? 1) === 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`).catch(() => null);
      if (res && res.ok) return true;
    } catch {
      /* keep trying */
    }
    await sleep(200);
  }
  return false;
}

const results = [];
function step(name, ok) {
  results.push({ name, ok });
}

step('crypto reference vectors (python3)', run('python3', ['test/verify-crypto.py']));
step('web crypto engine', run('node', ['test/e2ee-web.mjs']));
step('web <-> android protocol', run('node', ['test/e2ee-cross.mjs']));
step('TextBee SMS provider (offline)', run('node', ['test/sms-textbee.mjs']));
step('WhatsApp Meta Cloud API provider (offline)', run('node', ['test/sms-whatsapp.mjs']));
step('real use: personal numbers, no demo accounts', run('node', ['test/real-signup.mjs']));

const dataDir = mkdtempSync(join(tmpdir(), 'masingar-test-'));
const server = spawn('node', ['src/index.js'], {
  cwd: join(root, 'server'),
  env: {
    ...process.env,
    PORT,
    DB_PATH: join(dataDir, 'test.db'),
    SMS_PROVIDER: 'none',
    // the suites below log the demo users in; a real deployment leaves this off
    DEMO_SEED: 'true',
    NODE_ENV: 'development',
  },
  stdio: 'ignore',
});

let serverUp = false;
try {
  serverUp = await waitForServer(`http://127.0.0.1:${PORT}`);
  if (!serverUp) {
    step('server end to end', false);
    step('live end-to-end (encryption, wallpaper, notices)', false);
  } else {
    step(
      'server end to end',
      run('node', ['test/e2e.mjs', `http://127.0.0.1:${PORT}`], {
        cwd: join(root, 'server'),
      }),
    );
    step(
      'live end-to-end (encryption, wallpaper, notices)',
      run('node', ['test/e2ee-live.mjs'], { env: { BASE: `http://127.0.0.1:${PORT}` } }),
    );
    step(
      'two web clients (jsdom): encryption, wallpaper, notices',
      run('node', ['test/web-two-clients.mjs', `http://127.0.0.1:${PORT}`]),
    );
  }
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}

/* 7. The UI smoke test gets its own fresh server: it logs a demo user in, and
   the one time code for a phone number is rate limited, so reusing the server
   above would see the limit the earlier suites already consumed. */
if (process.env.SKIP_UI_TEST !== '1') {
  const uiPort = String(Number(PORT) + 1);
  const uiDir = mkdtempSync(join(tmpdir(), 'masingar-ui-'));
  const uiServer = spawn('node', ['src/index.js'], {
    cwd: join(root, 'server'),
    env: {
      ...process.env,
      PORT: uiPort,
      DB_PATH: join(uiDir, 'test.db'),
      SMS_PROVIDER: 'none',
    // the suites below log the demo users in; a real deployment leaves this off
    DEMO_SEED: 'true',
      NODE_ENV: 'development',
    },
    stdio: 'ignore',
  });
  try {
    if (await waitForServer(`http://127.0.0.1:${uiPort}`)) {
      step('web UI smoke (jsdom)', run('node', ['test/web-smoke.mjs', `http://127.0.0.1:${uiPort}`]));
    } else {
      step('web UI smoke (jsdom)', false);
    }
  } finally {
    uiServer.kill('SIGTERM');
    await sleep(300);
    rmSync(uiDir, { recursive: true, force: true });
  }
}

console.log('\n==================== summary ====================');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} suites passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
