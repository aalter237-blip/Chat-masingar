/**
 * End-to-end smoke test for the Masingar server.
 *   node test/e2e.mjs [baseUrl]
 *
 * Covers: OTP login, contacts sync, conversations, messages, receipts,
 * websocket presence/typing and the full call signalling handshake.
 */
import { webcrypto } from 'node:crypto';

const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3000';
const WS = BASE.replace(/^http/, 'ws') + '/ws';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const sha256 = async (s) => {
  const buf = new TextEncoder().encode(s);
  const d = await webcrypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non json */
  }
  return { status: res.status, json };
}

async function login(phone) {
  const otp = await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const code = otp.json?.devCode;
  const verify = await api('/api/auth/otp/verify', { method: 'POST', body: { phone, code, device: 'test' } });
  return { otp, verify, token: verify.json?.accessToken, user: verify.json?.user };
}

function socket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
    const inbox = [];
    const waiters = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(msg)) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
    ws.clearInbox = () => {
      inbox.length = 0;
    };
    ws.waitFor = (match, timeout = 6000) =>
      new Promise((res, rej) => {
        const found = inbox.find(match);
        if (found) return res(found);
        const t = setTimeout(() => rej(new Error('timeout waiting for frame')), timeout);
        waiters.push({
          match,
          resolve: (m) => {
            clearTimeout(t);
            res(m);
          },
        });
      });
  });
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));

async function main() {
  console.log(`\nMasingar e2e test -> ${BASE}\n`);

  console.log('health');
  {
    const { status, json } = await api('/api/health');
    check('health ok', status === 200 && json?.ok, JSON.stringify(json));
  }

  console.log('auth');
  const a = await login('967771000001');
  const b = await login('967771000002');
  check('otp request returns dev code', !!a.otp.json?.devCode);
  check('login A', !!a.token && a.user?.phone === '967771000001');
  check('login B', !!b.token && b.user?.phone === '967771000002');
  {
    const bad = await api('/api/auth/otp/verify', { method: 'POST', body: { phone: '967771000001', code: '000000' } });
    check('wrong code rejected', bad.status === 400);
  }
  {
    const me = await api('/api/me', { token: a.token });
    check('GET /api/me', me.status === 200 && me.json?.user?.id === a.user.id);
    const anon = await api('/api/me', { token: 'garbage' });
    check('invalid token rejected', anon.status === 401);
  }

  console.log('contacts');
  {
    const hash = await sha256('masingar:967771000002');
    const res = await api('/api/contacts/sync', {
      method: 'POST',
      token: a.token,
      body: { contacts: [{ hash, name: 'Sara' }] },
    });
    check('sync returns registered users', res.status === 200 && res.json?.users?.some((u) => u.id === b.user.id), JSON.stringify(res.json));
    const list = await api('/api/contacts', { token: a.token });
    check('contacts list', list.status === 200 && Array.isArray(list.json?.contacts));
  }

  console.log('conversations & messages');
  let convId;
  {
    const res = await api('/api/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id } });
    convId = res.json?.conversation?.id;
    check('create direct conversation', !!convId, JSON.stringify(res.json));
    const list = await api('/api/conversations', { token: a.token });
    check('conversation list contains it', list.json?.conversations?.some((c) => c.id === convId));
    const dup = await api('/api/conversations', { method: 'POST', token: a.token, body: { userId: b.user.id } });
    check('direct conversation is idempotent', dup.json?.conversation?.id === convId);
  }
  {
    const res = await api(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      token: a.token,
      body: { type: 'text', body: 'مرحبا', clientId: 'c1' },
    });
    check('send message', res.status === 200 && res.json?.message?.body === 'مرحبا', JSON.stringify(res.json));
    const list = await api(`/api/conversations/${convId}/messages?limit=10`, { token: b.token });
    check('peer can read messages', list.json?.messages?.some((m) => m.body === 'مرحبا'));
    const read = await api(`/api/conversations/${convId}/read`, { method: 'POST', token: b.token });
    check('mark read', read.status === 200);
    const edit = await api(`/api/messages/${res.json.message.id}`, { method: 'PUT', token: a.token, body: { body: 'مرحبا 👋' } });
    check('edit message', edit.json?.message?.body?.includes('👋'));
  }
  {
    const outsider = await login('967771000003');
    const forbidden = await api(`/api/conversations/${convId}/messages`, { token: outsider.token });
    check('non member blocked', forbidden.status === 403);
  }

  console.log('realtime');
  {
    const wsA = await socket(a.token);
    const wsB = await socket(b.token);
    const readyA = await wsA.waitFor((m) => m.t === 'ready');
    await wsB.waitFor((m) => m.t === 'ready');
    check('ws ready frame', !!readyA.user?.id);

    send(wsA, { t: 'typing', conversationId: convId, on: true });
    const typing = await wsB.waitFor((m) => m.t === 'typing' && m.on === true);
    check('typing delivered', typing.userId === a.user.id);

    send(wsA, { t: 'chat', conversationId: convId, body: 'رسالة عبر الويب سوكيت', clientId: 'ws1' });
    const msgFrame = await wsB.waitFor((m) => m.t === 'message' && m.message?.clientId === 'ws1');
    check('message delivered over ws', msgFrame.message.body === 'رسالة عبر الويب سوكيت');

    const ack = await wsA.waitFor((m) => m.t === 'ack' && m.clientId === 'ws1');
    check('sender gets ack', !!ack.message?.id);

    send(wsB, { t: 'read', conversationId: convId });
    const receipt = await wsA.waitFor((m) => m.t === 'receipt' && m.type === 'read');
    check('read receipt delivered', !!receipt);
  }

  console.log('call signalling');
  {
    const wsA = await socket(a.token);
    const wsB = await socket(b.token);
    await wsA.waitFor((m) => m.t === 'ready');
    await wsB.waitFor((m) => m.t === 'ready');

    send(wsA, { t: 'call.invite', to: b.user.id, type: 'video', conversationId: convId, sdp: { sdp: 'FAKE-OFFER', type: 'offer' } });
    const ringing = await wsA.waitFor((m) => m.t === 'call.ringing');
    check('caller gets ringing', !!ringing.callId && ringing.offline === false);

    const incoming = await wsB.waitFor((m) => m.t === 'call.incoming');
    check('callee gets invite', incoming.type === 'video' && incoming.sdp?.sdp === 'FAKE-OFFER');
    const callId = incoming.callId;

    send(wsB, { t: 'call.ice', callId, candidate: { candidate: 'candidate:1 1 udp' } });
    const ice = await wsA.waitFor((m) => m.t === 'call.ice');
    check('ice candidate relayed', ice.candidate?.candidate?.includes('udp'));

    send(wsB, { t: 'call.answer', callId, sdp: { sdp: 'FAKE-ANSWER', type: 'answer' } });
    const answer = await wsA.waitFor((m) => m.t === 'call.answer');
    check('answer relayed to caller', answer.sdp?.sdp === 'FAKE-ANSWER');

    send(wsB, { t: 'call.media', callId, video: false, reason: 'weak-network' });
    const media = await wsA.waitFor((m) => m.t === 'call.media');
    check('media downgrade relayed', media.video === false);

    send(wsA, { t: 'call.end', callId, reason: 'ended', durationMs: 4200 });
    const ended = await wsB.waitFor((m) => m.t === 'call.end');
    check('call end relayed', ended.reason === 'ended' && ended.call?.durationMs === 4200);

    const calls = await api('/api/calls', { token: a.token });
    check('call stored in history', calls.json?.calls?.some((c) => c.id === callId));

    // decline path
    send(wsA, { t: 'call.invite', to: b.user.id, type: 'audio', conversationId: convId, sdp: { sdp: 'O2', type: 'offer' } });
    const inv2 = await wsB.waitFor((m) => m.t === 'call.incoming' && m.type === 'audio');
    send(wsB, { t: 'call.decline', callId: inv2.callId });
    const declined = await wsA.waitFor((m) => m.t === 'call.decline');
    check('decline relayed', declined.callId === inv2.callId);

    wsA.close();
    wsB.close();
  }

  console.log('sync & misc');
  {
    const sync = await api('/api/sync?since=0', { token: a.token });
    check('sync returns conversations', sync.status === 200 && sync.json?.conversations?.length > 0);
    const ice = await api('/api/ice', { token: a.token });
    check('ice servers returned', Array.isArray(ice.json?.iceServers));
    const search = await api('/api/search?q=سارة', { token: a.token });
    check('search works', search.status === 200);
    const notFound = await api('/api/nope', { token: a.token });
    check('unknown route 404', notFound.status === 404);
    const logout = await api('/api/auth/logout', { method: 'POST', token: a.token, body: { refreshToken: 'x' } });
    check('logout ok', logout.status === 200);
  }

  console.log('wallpaper & privacy events');
  {
    const wsA = await socket(a.token);
    const wsB = await socket(b.token);
    await wsA.waitFor((m) => m.t === 'ready');
    await wsB.waitFor((m) => m.t === 'ready');

    /* shared chat wallpaper */
    const wallpaper = { id: 'teal', css: 'linear-gradient(160deg,#005c4b,#0b141a)' };
    const posted = await api(`/api/conversations/${convId}/settings`, {
      method: 'POST',
      token: a.token,
      body: { settings: { wallpaper } },
    });
    check('wallpaper stored', posted.status === 200 && posted.json?.settings?.wallpaper?.id === 'teal');

    const pushed = await wsB.waitFor((m) => m.t === 'conversation:settings');
    check('wallpaper pushed live to the peer', pushed.settings?.wallpaper?.id === 'teal');

    const listB = await api('/api/conversations', { token: b.token });
    const convB = listB.json?.conversations?.find((c) => c.id === convId);
    check('wallpaper visible on the other side', convB?.settings?.wallpaper?.id === 'teal');

    /* group keys (E2EE) - the server only stores ciphertext */
    const keys = await api(`/api/conversations/${convId}/keys`, {
      method: 'POST',
      token: a.token,
      body: { keys: [{ userId: b.user.id, enc: 'ENCRYPTED-BLOB', nonce: 'NONCE123' }] },
    });
    check('group key stored for a member', keys.status === 200 && keys.json?.keys?.length === 1);
    const keysB = await api(`/api/conversations/${convId}/keys`, { token: b.token });
    check('member can fetch their wrapped key', keysB.json?.keys?.[0]?.enc === 'ENCRYPTED-BLOB');

    /* screenshot / recording notice */
    send(wsA, { t: 'event', type: 'screenshot', conversationId: convId, meta: { source: 'keyboard' } });
    const event = await wsB.waitFor((m) => m.t === 'event' && m.type === 'screenshot');
    check('screenshot notice delivered to the peer', event.userId === a.user.id);
    const sysMsg = await wsB.waitFor((m) => m.t === 'message' && m.message?.type === 'system');
    check('screenshot is recorded in the chat', /لقطة/.test(sysMsg.message.body), sysMsg.message?.body);

    /* throttling */
    wsB.clearInbox();
    send(wsA, { t: 'event', type: 'screenshot', conversationId: convId });
    let throttled = true;
    try {
      await wsB.waitFor((m) => m.t === 'event' && m.type === 'screenshot', 1200);
      throttled = false;
    } catch {
      throttled = true;
    }
    check('duplicate notices are throttled', throttled);

    wsA.close();
    wsB.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
