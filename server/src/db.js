/**
 * SQLite layer.
 *
 * Uses the built-in `node:sqlite` module when available (Node >= 22, recommended)
 * and falls back to `better-sqlite3` (npm optional dependency) otherwise.
 * Both expose the same tiny subset we rely on: exec / prepare / run / get / all.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, ROOT } from './config.js';
import { log } from './util.js';

async function openSqlite() {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    DatabaseSync = null;
  }

  if (DatabaseSync) {
    const db = new DatabaseSync(config.dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    log('db: using built-in node:sqlite');
    return db;
  }

  try {
    const mod = await import('better-sqlite3');
    const Better = mod.default ?? mod;
    const db = new Better(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    log('db: using better-sqlite3');
    return db;
  } catch (err) {
    log('db: no sqlite driver found ->', err.message);
    throw new Error(
      'No SQLite driver available. Use Node.js >= 22 (built-in node:sqlite) or run "npm install better-sqlite3".'
    );
  }
}

// make sure the data / upload folders exist before opening the database
mkdirSync(dirname(config.dbPath), { recursive: true });
mkdirSync(config.uploadsDir, { recursive: true });

export const db = await openSqlite();

/* ------------------------------------------------------------------ */
/* Low level helpers                                                    */
/* ------------------------------------------------------------------ */

export function exec(sql) {
  return db.exec(sql);
}

export function run(sql, ...params) {
  const stmt = db.prepare(sql);
  const res = stmt.run(...params);
  return { changes: Number(res.changes ?? 0), lastInsertRowid: res.lastInsertRowid };
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params) || null;
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/** Run several statements inside one transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Schema                                                               */
/* ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,
  phone_hash    TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  avatar        TEXT NOT NULL DEFAULT '',
  about         TEXT NOT NULL DEFAULT '',
  locale        TEXT NOT NULL DEFAULT 'ar',
  public_key    TEXT NOT NULL DEFAULT '',
  push_token    TEXT NOT NULL DEFAULT '',
  push_platform TEXT NOT NULL DEFAULT '',
  online        INTEGER NOT NULL DEFAULT 0,
  last_seen     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  phone     TEXT PRIMARY KEY,
  code      TEXT NOT NULL,
  expires   INTEGER NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0,
  sent_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL UNIQUE,
  device        TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  expires       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'direct',   -- direct | group
  title           TEXT NOT NULL DEFAULT '',
  avatar          TEXT NOT NULL DEFAULT '',
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_message_id TEXT
);

CREATE TABLE IF NOT EXISTS participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       INTEGER NOT NULL,
  muted           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'text',  -- text|image|audio|video|file|location|contact|system|call
  body            TEXT NOT NULL DEFAULT '',
  media_url       TEXT NOT NULL DEFAULT '',
  media_meta      TEXT NOT NULL DEFAULT '',
  reply_to        TEXT,
  client_id       TEXT NOT NULL DEFAULT '',
  encrypted       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'sent',  -- sending|sent|delivered|read|failed
  created_at      INTEGER NOT NULL,
  edited_at       INTEGER,
  deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS message_receipts (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at INTEGER,
  read_at      INTEGER,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS calls (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT,
  caller_id       TEXT NOT NULL,
  callee_id       TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'audio',
  state           TEXT NOT NULL DEFAULT 'ringing', -- ringing|active|ended|missed|declined|failed|busy
  started_at      INTEGER,
  ended_at        INTEGER,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  end_reason      TEXT NOT NULL DEFAULT '',
  quality         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS contacts (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_hash TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, phone_hash)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS conversation_keys (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enc_key         TEXT NOT NULL,
  nonce           TEXT NOT NULL,
  updated_by      TEXT,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversation_settings (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  updated_by      TEXT,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, key)
);

CREATE TABLE IF NOT EXISTS push_queue (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_contacts_hash ON contacts(phone_hash);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

exec(SCHEMA);

export { ROOT };
export const dbFileExisted = existsSync(config.dbPath);
