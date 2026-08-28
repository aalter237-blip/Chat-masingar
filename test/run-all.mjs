/**
 * Runs the whole test suite in the right order.
 *
 *   node test/run-all.mjs
 *
 * 1. crypto reference vectors   (python3, RFC 7748 / RFC 5869 + Node vectors)
 * 2. web engine unit tests      (test/e2ee-web.mjs)
 * 3. web <-> android cross test (test/e2ee-cross.mjs)
 * 4. server REST/WebSocket e2e  (server/test/e2e.mjs, own server + temp db)
 * 5. live end-to-end            (test/e2ee-live.mjs, same server)
 * 6. web UI smoke test          (test/web-smoke.mjs, needs jsdom in test/node_modules)
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

const dataDir = mkdtempSync(join(tmpdir(), 'masingar-test-'));
const server = spawn('node', ['src/index.js'], {
  cwd: join(root, 'server'),
  env: {
    ...process.env,
    PORT,
    DB_PATH: join(dataDir, 'test.db'),
    SMS_PROVIDER: 'none',
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
  }
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}

if (process.env.SKIP_UI_TEST !== '1') {
  step('web UI smoke (jsdom)', run('node', ['test/web-smoke.mjs']));
}

console.log('\n==================== summary ====================');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} suites passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
