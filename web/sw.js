/* ماسنجر لايت — Service Worker مصغّر: يخزّن هيكل التطبيق فقط (أقل من نصف ميجابايت). */
const CACHE = 'masingar-lite-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/api.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

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

  /* الـ API والوسائط: من الشبكة دائماً */
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/media') || url.pathname.startsWith('/ws')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ ok: false, code: 'offline' }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  /* هيكل التطبيق: من الشبكة ثم الكاش عند انقطاعها */
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./')))
  );
});
