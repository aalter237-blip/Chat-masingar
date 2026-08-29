/**
 * Masingar Chat - server entry point.
 *   REST  : http://host:PORT/api     (auth, messages, contacts, uploads, ICE)
 *   WS    : ws://host:PORT/ws        (presence, typing, delivery, call signalling)
 *   Web   : http://host:PORT/        (browser client, served statically)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import { config, ROOT } from './config.js';
import { log, now } from './util.js';
import apiRouter from './api.js';
import { attachWebSocket } from './ws.js';
import { seed } from './seed.js';
import { iceServers } from './ice.js';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

/* --------------------------- request logging -------------------------- */
app.use((req, res, next) => {
  const started = now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      const ms = now() - started;
      log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

/* -------------------------------- API --------------------------------- */
app.use('/api', apiRouter);

/* ------------------------------- uploads ------------------------------ */
app.use(
  '/uploads',
  express.static(config.uploadsDir, {
    maxAge: '30d',
    fallthrough: true,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

/* ------------------------------ web client ---------------------------- */
const webDir = config.webDir;
if (fs.existsSync(webDir)) {
  app.use(
    express.static(webDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html') || filePath === webDir) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(webDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.type('html').send('<h1>Masingar server</h1><p>Web client not found. API is at <code>/api</code>.</p>'));
}

/* ------------------------------- errors -------------------------------- */
app.use((err, req, res, _next) => {
  log('error:', err?.message);
  const status = err?.status || 500;
  res.status(status).json({ ok: false, code: err?.code || 'server_error', message: err?.message || 'خطأ في الخادم' });
});

/* -------------------------------- start -------------------------------- */
const server = http.createServer(app);
attachWebSocket(server);

server.listen(config.port, config.host, () => {
  const seeded = seed();
  log('-------------------------------------------------------------');
  log(`Masingar server  v1.0.0   (${config.env})`);
  log(`REST  : http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/api`);
  log(`WS    : ws://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/ws`);
  log(`Web   : http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/`);
  log(`DB    : ${config.dbPath}`);
  log(`SMS   : provider=${config.smsProvider}${config.smsProvider === 'none' ? ' (codes are returned by the API)' : ''}`);
  if (config.smsProvider === 'textbee') {
    if (!config.textbeeApiKey) log('SMS   : WARNING textbee is selected but TEXTBEE_API_KEY is empty -> no SMS will be sent');
    else log(`SMS   : textbee device=${config.textbeeDeviceId || '(account default)'} base=${config.textbeeBaseUrl}`);
  }
  log(`TURN  : ${config.turnSecret && config.turnHost ? `coturn ${config.turnHost}` : config.freeTurn ? 'free public relay (set TURN_SECRET/TURN_HOST for your own)' : 'STUN only (set TURN_SECRET/TURN_HOST for relaying)'}`);
  log(`PUSH  : ${process.env.FCM_PROJECT_ID ? 'FCM configured' : 'disabled (set FCM_* to enable)'}`);
  if (seeded.created) log(`Demo users: ${seeded.users.map((u) => u.phone).join(' ')}`);
  log('-------------------------------------------------------------');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`shutting down (${sig})`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

process.on('unhandledRejection', (err) => log('unhandledRejection:', err?.message || err));
process.on('uncaughtException', (err) => log('uncaughtException:', err?.stack || err?.message || err));

export { server, app, iceServers };
