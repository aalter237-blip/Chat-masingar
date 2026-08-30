/**
 * ماسنجر لايت — سيرفر صغير لكل ما يحتاجه التطبيق:
 *   REST  /api      (دخول بالهاتف، منشورات، دردشة، أعضاء)
 *   WS    /ws       (تحديثات لحظية وحضور)
 *   Web   /         (تطبيق الويب الخفيف PWA)
 *
 * بلا قاعدة بيانات وبلا مكتبات ثقيلة: ملف JSON واحد + مجلد صور صغير.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import * as store from './store.js';
import { api } from './api.js';
import { attachWebSocket } from './realtime.js';

store.load();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '3mb' })); // الصور تُرسل base64 بعد ضغطها في المتصفح

app.use('/api', api);

/* صور الوسائط (تُخزَّن مضغوطة أصلاً — لا نحتاج معالجة على السيرفر) */
app.use(
  '/media',
  express.static(store.MEDIA_DIR, {
    maxAge: '30d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

/* تطبيق الويب */
if (fs.existsSync(config.webDir)) {
  app.use(
    express.static(config.webDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(config.webDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.type('html').send('<h1>ماسنجر لايت</h1><p>واجهة الويب غير موجودة — الـ API على <code>/api</code></p>')
  );
}

/* أخطاء موحّدة */
app.use((err, _req, res, _next) => {
  console.error('error:', err?.message);
  const status = err?.status || 500;
  res.status(status).json({ ok: false, code: err?.code || 'server_error', message: err?.message || 'خطأ في الخادم' });
});

const server = http.createServer(app);
attachWebSocket(server);

server.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log('-----------------------------------------------------------');
  console.log(`ماسنجر لايت  (${config.env})`);
  console.log(`Web   : http://${shown}:${config.port}/`);
  console.log(`API   : http://${shown}:${config.port}/api/circle`);
  console.log(`دائرة : ${store.members().length}/${config.maxMembers} أعضاء${config.joinCode ? ' (رمز انضمام مفعّل)' : ''}`);
  console.log(`بيانات: ${config.dataDir}`);
  console.log('-----------------------------------------------------------');
});

/* حفظ نظيف عند الإيقاف */
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    store.flushSync();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.message || e));
