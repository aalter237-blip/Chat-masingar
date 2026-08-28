/**
 * Firebase Cloud Messaging (HTTP v1) push helper.
 * Works with a service-account (RSA) key - no extra npm dependency needed.
 *
 * Env: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY
 * Without configuration, pushes are logged only (the app still works while
 * it is in the foreground; background calls simply arrive when it re-opens).
 */
import { createSign } from 'node:crypto';
import { config } from './config.js';
import { log } from './util.js';

let cachedToken = null;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  if (!config.fcmProjectId || !config.fcmClientEmail || !config.fcmPrivateKey) return null;

  const iat = Math.floor(Date.now() / 1000);
  const claim = {
    iss: config.fcmClientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const jwt = `${unsigned}.${b64url(signer.sign(config.fcmPrivateKey))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) {
    log('push: token error', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return null;
  }
  const json = await res.json();
  cachedToken = { value: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

export const pushEnabled = () => Boolean(config.fcmProjectId && config.fcmClientEmail && config.fcmPrivateKey);

/** Send a data-only (high priority) push used for incoming calls and messages. */
export async function sendPush(user, { title, body, data = {}, collapseKey }) {
  if (!user?.push_token) return false;
  const token = await accessToken();
  if (!token) {
    log(`push: (disabled) ${title} -> ${user.id}`);
    return false;
  }
  const payload = {
    message: {
      token: user.push_token,
      android: {
        priority: 'high',
        ttl: '60s',
        notification: { title, body: body || '', channelId: 'calls', sound: 'default' },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      ...(collapseKey ? { android: { collapseKey } } : {}),
    },
  };
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${config.fcmProjectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) log('push: send error', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return res.ok;
  } catch (err) {
    log('push: send failed ->', err.message);
    return false;
  }
}

export async function pushIncomingCall(caller, callee, call) {
  return sendPush(callee, {
    title: caller.name || caller.phone,
    body: call.type === 'video' ? 'مكالمة فيديو واردة' : 'مكالمة صوتية واردة',
    data: { type: 'call', callId: call.id, callerId: caller.id, callType: call.type, conversationId: call.conversationId || '' },
  });
}

export async function pushMessage(sender, recipient, conversation, preview) {
  return sendPush(recipient, {
    title: sender.name || sender.phone,
    body: preview,
    data: { type: 'message', conversationId: conversation.id, senderId: sender.id },
    collapseKey: conversation.id,
  });
}
