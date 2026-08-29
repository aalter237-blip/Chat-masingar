/**
 * WhatsApp (Meta Cloud API) provider test.
 *
 *   node test/sms-whatsapp.mjs
 *
 * It stubs global fetch, asks the real server code to send a verification code
 * and checks the request the provider builds: the endpoint, the Bearer token,
 * the recipient in E.164 form, the template name/language and the code carried
 * as the first body parameter. No request leaves the machine, so the test is
 * offline and uses no WhatsApp credits.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dataDir = mkdtempSync(join(tmpdir(), 'masingar-wa-'));

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
let networkErrors = 0;
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
    throw new Error('getaddrinfo ENOTFOUND graph.facebook.com');
  }
  return {
    ok: nextStatus >= 200 && nextStatus < 300,
    status: nextStatus,
    text: async () => (nextStatus < 300 ? '{"messages":[{"id":"wamid.x"}]}' : '{"error":{"message":"bad token"}}'),
    json: async () => ({ messages: [{ id: 'wamid.x' }] }),
  };
};

/**
 * The modules are loaded once (config reads the environment at import time),
 * then the values under test are written straight onto the live config object -
 * exactly what a server restart with different variables would produce.
 */
process.env.DB_PATH = join(dataDir, 'wa.db');
const auth = await import('../server/src/auth.js');
const { config } = await import('../server/src/config.js');

function loadWith(values) {
  Object.assign(config, values);
  return { auth, config };
}

console.log('\nwhatsapp (meta cloud api) provider\n');

/* 1. the request the provider builds ---------------------------------- */
{
  const { auth, config } = await loadWith({
    smsProvider: 'whatsapp',
    whatsappPhoneNumberId: '123456789012345',
    whatsappAccessToken: 'EAAG_permanent_token',
    whatsappBaseUrl: 'https://graph.facebook.com',
    whatsappApiVersion: 'v20.0',
    whatsappTemplateName: 'masingar_otp',
    whatsappTemplateLanguage: 'ar',
  });

  check('provider is whatsapp', config.smsProvider === 'whatsapp');
  resetStub();
  const res = await auth.sendOtp('967771000001');

  check('provider reported back', res.provider === 'whatsapp', res.provider);
  check('marks the message delivered', res.delivered === true);
  check(
    'calls the Meta Cloud API messages endpoint',
    lastCall?.url === 'https://graph.facebook.com/v20.0/123456789012345/messages',
    lastCall?.url,
  );
  check('method is POST', lastCall?.opts.method === 'POST');
  check(
    'sends the bearer token header',
    lastCall?.opts.headers.Authorization === 'Bearer EAAG_permanent_token',
    JSON.stringify(lastCall?.opts.headers),
  );
  check('sends json content type', lastCall?.opts.headers['Content-Type'] === 'application/json');

  const body = JSON.parse(lastCall?.opts.body || '{}');
  check('messaging_product is whatsapp', body.messaging_product === 'whatsapp');
  check('recipient is E.164 with a leading +', body.to === '+967771000001', body.to);
  check('message type is a template', body.type === 'template');
  check('template language is ar', body.template?.language?.code === 'ar');
  check('template name is configured', body.template?.name === 'masingar_otp', body.template?.name);
  const firstParam = body.template?.components?.[0]?.parameters?.[0];
  check('code is the first body parameter of the template', firstParam?.type === 'text' && firstParam?.text === res.code, JSON.stringify(firstParam));
  check('code is 6 digits', /^\d{6}$/.test(res.code), res.code);
}

/* 2. a custom base url and api version are honoured -------------------- */
{
  const { auth } = await loadWith({
    smsProvider: 'whatsapp',
    whatsappPhoneNumberId: 'phone_1',
    whatsappAccessToken: 'tok',
    whatsappBaseUrl: 'https://graph.instagram.test/',
    whatsappApiVersion: '21.0',
    whatsappTemplateName: 'otp',
    whatsappTemplateLanguage: 'en_US',
  });
  resetStub();
  await auth.sendOtp('12025550123');
  check(
    'trailing slash is trimmed and v21.0 is used',
    lastCall?.url === 'https://graph.instagram.test/v21.0/phone_1/messages',
    lastCall?.url,
  );
  const body = JSON.parse(lastCall?.opts.body || '{}');
  check('recipient is still E.164', body.to === '+12025550123');
  check('custom language is used', body.template?.language?.code === 'en_US');
}

/* 3. a refusal from Meta is reported, not thrown ----------------------- */
{
  const { auth } = await loadWith({
    smsProvider: 'whatsapp',
    whatsappPhoneNumberId: 'phone_2',
    whatsappAccessToken: 'bad',
    whatsappBaseUrl: 'https://graph.facebook.com',
    whatsappApiVersion: 'v20.0',
    whatsappTemplateName: 'masingar_otp',
    whatsappTemplateLanguage: 'ar',
  });
  resetStub({ status: 401 });
  const res = await auth.sendOtp('967771000002');
  check('meta error is not fatal', res.delivered === false);
  check('the code is still stored and returned', /^\d{6}$/.test(res.code));
  check('a refusal is not retried', calls === 1, `calls=${calls}`);
}

/* 4. missing credentials -> nothing is sent, the server still works ---- */
{
  const { auth } = await loadWith({
    smsProvider: 'whatsapp',
    whatsappPhoneNumberId: '',
    whatsappAccessToken: '',
    whatsappBaseUrl: 'https://graph.facebook.com',
    whatsappApiVersion: 'v20.0',
    whatsappTemplateName: 'masingar_otp',
    whatsappTemplateLanguage: 'ar',
  });
  resetStub();
  const res = await auth.sendOtp('967771000003');
  check('no request is made without credentials', lastCall === null);
  check('code is still issued', /^\d{6}$/.test(res.code));
}

/* 5. slow/flaky Meta API is retried, a refusal is not ------------------- */
{
  const { auth } = await loadWith({
    smsProvider: 'whatsapp',
    whatsappPhoneNumberId: 'phone_3',
    whatsappAccessToken: 'tok',
    whatsappBaseUrl: 'https://graph.facebook.com',
    whatsappApiVersion: 'v20.0',
    whatsappTemplateName: 'masingar_otp',
    whatsappTemplateLanguage: 'ar',
    whatsappRetries: 1,
    whatsappRetryDelayMs: 10,
    whatsappTimeoutMs: 10000,
  });

  resetStub({ errors: 1 });
  let res = await auth.sendOtp('967771000005');
  check('a dropped connection is retried', calls === 2, `calls=${calls}`);
  check('the retry succeeds', res.delivered === true);

  resetStub({ status: 503 });
  res = await auth.sendOtp('967771000006');
  check('a meta outage is retried once', calls === 2, `calls=${calls}`);
  check('and reported as not delivered', res.delivered === false);

  resetStub({ status: 404 });
  res = await auth.sendOtp('967771000007');
  check('an invalid phone id / template is refused without a retry', calls === 1, `calls=${calls}`);
  check('and reported as not delivered', res.delivered === false);

  resetStub({ errors: 9 });
  const before = Date.now();
  res = await auth.sendOtp('967771000008');
  check('gives up after the configured attempts', calls === 2 && res.delivered === false, `calls=${calls}`);
  check('and never hangs', Date.now() - before < 3000);
}

/* 6. every request is bounded by a timeout ------------------------------- */
{
  const { auth } = await loadWith({
    smsProvider: 'whatsapp',
    whatsappPhoneNumberId: 'phone_4',
    whatsappAccessToken: 'tok',
    whatsappBaseUrl: 'https://graph.facebook.com',
    whatsappApiVersion: 'v20.0',
    whatsappTemplateName: 'masingar_otp',
    whatsappTemplateLanguage: 'ar',
    whatsappRetries: 0,
    whatsappTimeoutMs: 10,
    whatsappRetryDelayMs: 0,
  });
  resetStub();
  globalThis.fetch = async (url, opts) => {
    if (opts?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        removeAbort();
        resolve();
      }, 200);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      const removeAbort = () => opts?.signal?.removeEventListener('abort', onAbort);
      opts?.signal?.addEventListener('abort', onAbort, { once: true });
    });
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };
  const before = Date.now();
  const res = await auth.sendOtp('967771000009');
  check('a hanging Meta API does not block the request', Date.now() - before < 3000, `${Date.now() - before}ms`);
  check('still reports not delivered on timeout', res.delivered === false);
}

try {
  rmSync(dataDir, { recursive: true, force: true });
} catch { /* keep going */ }

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
