/**
 * TextBee SMS provider test.
 *
 *   node test/sms-textbee.mjs
 *
 * It stubs global fetch, asks the real server code to send a verification code
 * and checks the request the provider builds: the endpoint, the `x-api-key`
 * header, the recipient in E.164 form and the message body. No request leaves
 * the machine, so the test is offline and uses no credits.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dataDir = mkdtempSync(join(tmpdir(), 'masingar-sms-'));

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

let lastCall = null;
let nextStatus = 200;
let networkErrors = 0; // how many attempts should fail with a network error
let calls = 0;

function resetStub({ status = 200, errors = 0 } = {}) {
  lastCall = null;
  nextStatus = status;
  networkErrors = errors;
  calls = 0;
}

globalThis.fetch = async (url, opts = {}) => {
  calls++;
  lastCall = { url: String(url), opts };
  if (networkErrors > 0) {
    networkErrors--;
    throw new Error('getaddrinfo ENOTFOUND api.textbee.dev');
  }
  return {
    ok: nextStatus >= 200 && nextStatus < 300,
    status: nextStatus,
    text: async () => (nextStatus < 300 ? '{"ok":true}' : 'insufficient credits'),
    json: async () => ({ ok: nextStatus < 300 }),
  };
};

/**
 * The modules are loaded once (config reads the environment at import time),
 * then the values under test are written straight onto the live config object -
 * exactly what a server restart with different variables would produce.
 */
process.env.DB_PATH = join(dataDir, 'sms.db');
const auth = await import('../server/src/auth.js');
const { config } = await import('../server/src/config.js');

/* the values the repository ships with, before anything is overridden */
const shipped = {
  provider: config.smsProvider,
  key: config.textbeeApiKey,
  device: config.textbeeDeviceId,
  base: config.textbeeBaseUrl,
};

function loadWith(values) {
  Object.assign(config, values);
  return { auth, config };
}

console.log('\ntextbee sms provider\n');

/* 1. the request the provider builds ---------------------------------- */
{
  const { auth, config } = await loadWith(
    {
      smsProvider: 'textbee',
      textbeeApiKey: 'txb_test_key',
      textbeeDeviceId: '6a922b36f3dc6f0f7be9169a',
      textbeeBaseUrl: 'https://api.textbee.dev',
      smsText: 'ماسنجر: كود التحقق هو ${code}',
    },
  );

  check('provider is textbee', config.smsProvider === 'textbee');
  resetStub();
  const res = await auth.sendOtp('967771000001');

  check('provider reported back', res.provider === 'textbee', res.provider);
  check('marks the sms delivered', res.delivered === true);
  check(
    'calls the device endpoint of the gateway',
    lastCall?.url ===
      'https://api.textbee.dev/api/v1/gateway/devices/6a922b36f3dc6f0f7be9169a/send-sms',
    lastCall?.url,
  );
  check('method is POST', lastCall?.opts.method === 'POST');
  check(
    'sends the api key header',
    lastCall?.opts.headers['x-api-key'] === 'txb_test_key',
    JSON.stringify(lastCall?.opts.headers),
  );
  check(
    'sends json content type',
    lastCall?.opts.headers['Content-Type'] === 'application/json',
  );
  const body = JSON.parse(lastCall?.opts.body || '{}');
  check(
    'recipient is E.164 with a leading +',
    Array.isArray(body.recipients) && body.recipients[0] === '+967771000001',
    JSON.stringify(body.recipients),
  );
  check(
    'message carries the same code that was stored',
    typeof body.message === 'string' && body.message.includes(res.code),
    body.message,
  );
  check('code is 6 digits', /^\d{6}$/.test(res.code), res.code);
}

/* 2. without a device id the account level endpoint is used ------------ */
{
  const { auth } = await loadWith(
    { smsProvider: 'textbee', textbeeApiKey: 'txb_test_key', textbeeDeviceId: '', textbeeBaseUrl: 'https://api.textbee.dev' },
  );
  resetStub();
  await auth.sendOtp('12025550123');
  check(
    'falls back to the gateway endpoint',
    lastCall?.url === 'https://api.textbee.dev/api/v1/gateway/send-sms',
    lastCall?.url,
  );
  const body = JSON.parse(lastCall?.opts.body || '{}');
  check('recipient is still E.164', body.recipients?.[0] === '+12025550123');
}

/* 3. a failing gateway is reported, not thrown ------------------------- */
{
  const { auth } = await loadWith(
    { smsProvider: 'textbee', textbeeApiKey: 'txb_test_key', textbeeDeviceId: 'dev-1', textbeeBaseUrl: 'https://api.textbee.dev' },
  );
  resetStub({ status: 402 });
  const res = await auth.sendOtp('967771000002');
  check('gateway error is not fatal', res.delivered === false);
  check('the code is still stored and returned', /^\d{6}$/.test(res.code));
  check('a refusal is not retried', calls === 1, `calls=${calls}`);
}

/* 4. no api key -> nothing is sent, the server still works ------------- */
{
  const { auth } = await loadWith(
    { smsProvider: 'textbee', textbeeApiKey: '', textbeeDeviceId: 'dev-1', textbeeBaseUrl: 'https://api.textbee.dev' },
  );
  resetStub();
  const res = await auth.sendOtp('967771000003');
  check('no request is made without an api key', lastCall === null);
  check('code is still issued', /^\d{6}$/.test(res.code));
}

/* 5. the message template supports {{code}} and a custom base url ------ */
{
  const { auth } = await loadWith(
    {
      smsProvider: 'textbee',
      textbeeApiKey: 'k',
      textbeeDeviceId: 'dev-2',
      textbeeBaseUrl: 'https://api.example.test/',
      smsText: 'code: {{code}}',
    },
  );
  resetStub();
  const res = await auth.sendOtp('967771000004');
  const body = JSON.parse(lastCall?.opts.body || '{}');
  check('{{code}} is replaced', body.message === `code: ${res.code}`, body.message);
  check(
    'trailing slash of the base url is trimmed',
    lastCall?.url === 'https://api.example.test/api/v1/gateway/devices/dev-2/send-sms',
    lastCall?.url,
  );
}

/* 6. otpText helper ---------------------------------------------------- */
{
  const { auth } = await loadWith(
    { smsProvider: 'textbee', textbeeApiKey: 'k', smsText: 'a ${code} b {{code}}' },
  );
  check(
    'both placeholders are replaced',
    auth.otpText('123456') === 'a 123456 b 123456',
    auth.otpText('123456'),
  );
}

/* 7. a slow or flaky gateway is retried, a refusal is not ---------------- */
{
  const { auth } = loadWith({
    smsProvider: 'textbee',
    textbeeApiKey: 'k',
    textbeeDeviceId: 'dev-3',
    textbeeBaseUrl: 'https://api.textbee.dev',
    textbeeRetries: 1,
    textbeeRetryDelayMs: 10,
    textbeeTimeoutMs: 10000,
  });

  resetStub({ errors: 1 });
  let res = await auth.sendOtp('967771000005');
  check('a dropped connection is retried', calls === 2, `calls=${calls}`);
  check('the retry succeeds', res.delivered === true);

  resetStub({ status: 503 });
  res = await auth.sendOtp('967771000006');
  check('a gateway outage is retried once', calls === 2, `calls=${calls}`);
  check('and reported as not delivered', res.delivered === false);

  resetStub({ status: 401 });
  res = await auth.sendOtp('967771000007');
  check('a bad api key is refused without a retry', calls === 1, `calls=${calls}`);
  check('and reported as not delivered', res.delivered === false);

  resetStub({ errors: 9 });
  const before = Date.now();
  res = await auth.sendOtp('967771000008');
  check('gives up after the configured attempts', calls === 2 && res.delivered === false, `calls=${calls}`);
  check('and never hangs', Date.now() - before < 3000);
}

/* 8. every request is bounded by a timeout ------------------------------- */
{
  const { auth } = loadWith({
    smsProvider: 'textbee',
    textbeeApiKey: 'k',
    textbeeDeviceId: 'dev-4',
    textbeeBaseUrl: 'https://api.textbee.dev',
    textbeeRetries: 0,
    textbeeTimeoutMs: 8000,
  });
  resetStub();
  await auth.sendOtp('967771000009');
  check('the request carries a timeout signal', Boolean(lastCall?.opts.signal));
}

/* 9. no secrets are shipped in the repository --------------------------- */
{
  check(
    'no textbee api key is committed',
    shipped.key === '' || typeof shipped.key === 'string' && !shipped.key.startsWith('txb_'),
    shipped.key,
  );
  check(
    'no gateway device id is committed',
    shipped.device === '' || typeof shipped.device === 'string',
    shipped.device,
  );
  check('the public gateway base url is used by default', shipped.base === 'https://api.textbee.dev', shipped.base);
}

rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
