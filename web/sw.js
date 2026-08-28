/* Masingar service worker - offline shell + basic push fallback. */
const CACHE = 'masingar-v1';
const SHELL = ['./', './index.html', './css/style.css', './js/app.js', './js/api.js', './js/rtc.js', './js/i18n.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // network first for API, cache first for the app shell
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ ok: false, code: 'offline' }), { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'ماسنجر';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: data.data || {},
    tag: data.data?.conversationId || 'masingar',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow('./');
  }));
});
