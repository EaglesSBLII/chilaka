-- Chilaka accounts + push reminders. Legacy KV slots keep working; a slot gets
-- a `progress` row only once an account claims it (see src/lib/store.js).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  auth_hash TEXT NOT NULL,
  server_salt TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  slot_key TEXT UNIQUE NOT NULL,
  token_ver INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  slot_key TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_day TEXT,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  tz TEXT NOT NULL,
  hh INTEGER NOT NULL,
  mm INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sent_day TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS push_subs_user_id ON push_subs(user_id);
