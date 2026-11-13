// Fake Worker env for tests: in-memory KV + a D1 shim over node:sqlite that
// runs the real migration.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function fakeKV() {
  const m = new Map();
  return {
    _map: m,
    async get(k, type) {
      const v = m.get(k) ?? null;
      return type === 'json' && v !== null ? JSON.parse(v) : v;
    },
    async put(k, v) {
      m.set(k, String(v));
    },
    async delete(k) {
      m.delete(k);
    },
  };
}

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_birthday_recovery.sql']) {
    db.exec(readFileSync(fileURLToPath(new URL(`../migrations/${f}`, import.meta.url)), 'utf8'));
  }
  const stmt = (sql, args) => {
    const st = db.prepare(sql);
    return {
      async first(col) {
        const raw = st.get(...args);
        const row = raw ? { ...raw } : null; // node:sqlite rows have a null prototype
        return col ? (row?.[col] ?? null) : row;
      },
      async run() {
        const r = st.run(...args);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      async all() {
        return { results: st.all(...args).map((r) => ({ ...r })), success: true };
      },
    };
  };
  return {
    _db: db,
    prepare(sql) {
      return { ...stmt(sql, []), bind: (...args) => stmt(sql, args) };
    },
  };
}

export function fakeEnv({ d1 = true } = {}) {
  return { SYNC: fakeKV(), ...(d1 ? { DB: fakeD1() } : {}), AI: { run: async () => ({ text: 'నమస్కారం' }) } };
}

export function req(path, { method = 'GET', body, headers = {}, ip = '1.2.3.4' } = {}) {
  const h = { 'cf-connecting-ip': ip, ...headers };
  const init = { method, headers: h };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  return new Request(`https://sync.test${path}`, init);
}

export const authKey = (seed = 'a') => seed.repeat(64).slice(0, 64);
