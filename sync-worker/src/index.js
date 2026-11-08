// Chilaka sync server — a Cloudflare Worker + KV + D1.
//
// Legacy (device-paired) sync: /<key> where key is a 48-64 hex-char secret
// only your devices know. GET returns {rev, updatedAt, data}; PUT {rev, data}
// succeeds only when rev === currentRev + 1 (optimistic concurrency; clients
// merge and retry on 409).
//
// Accounts (/auth/*) own a slot too; their data lives in D1 (src/lib/store.js
// hides which store a slot is in). Push reminders (/push/*) are sent by the
// cron `scheduled` handler. Free tier is far beyond one learner's needs.

import { loadSlot, saveSlot, slotExists, ensureSlotRow } from './lib/store.js';
import {
  isAuthKey,
  newCredential,
  checkAuthKey,
  makeRecoveryCode,
  hashRecoveryCode,
  checkRecoveryCode,
  randomHex,
  signToken,
  verifyToken,
} from './lib/auth.js';
import { getVapidKeys, vapidPublicKeyString, sendPush } from './lib/push.js';
import { dueSubs, pickCopy, dayOfYear, isValidTimeZone } from './lib/schedule.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-chilaka-hint, authorization',
};

const MAX_BYTES = 4 * 1024 * 1024; // plenty for years of progress JSON
const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~60s of 16k mono WAV
const KEY_RE = /^[a-f0-9]{48,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- lightweight in-memory rate limiting (no KV writes burned) ----
// Per-isolate sliding windows: resets when the isolate recycles, which is
// fine — the goal is stopping hammering/abuse, not accounting.
const windows = new Map();
function limited(bucket, max, windowMs) {
  const now = Date.now();
  let w = windows.get(bucket);
  if (!w || now - w.start > windowMs) {
    w = { start: now, n: 0 };
    windows.set(bucket, w);
  }
  w.n += 1;
  if (windows.size > 5000) windows.clear(); // memory guard
  return w.n > max;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const error = (message, status) => json({ error: message }, status);

async function readJson(request) {
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return { error: error('too large', 413) };
    return { body: JSON.parse(text) };
  } catch {
    return { error: error('bad json', 400) };
  }
}

const clientIp = (request) => request.headers.get('cf-connecting-ip') ?? 'unknown';
const normaliseEmail = (e) => String(e ?? '').trim().toLowerCase();

// ---- /asr/<key>: phone speech scoring via Workers AI Whisper ----
async function handleAsr(request, env, asrKey) {
  if (!KEY_RE.test(asrKey)) return error('bad key', 400);
  if (request.method !== 'POST') return error('method', 405);
  // the key must belong to a real sync slot (stops strangers using your AI quota)
  if (!(await slotExists(env, asrKey))) return error('unpaired key', 403);
  // abuse brakes: a real learner sends a few clips a minute at most
  if (
    limited(`asr:${asrKey}`, 30, 10 * 60_000) ||
    limited(`asrday:${asrKey}`, 250, 24 * 60 * 60_000) ||
    limited('asr:global', 300, 10 * 60_000)
  ) {
    return error('rate limited — try again in a few minutes', 429);
  }
  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) return error('bad audio size', 413);
  try {
    // base64 the WAV for whisper-large-v3-turbo
    const bytes = new Uint8Array(audio);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    // lesson context from the app (percent-encoded header) primes the decoder
    // with the surrounding phrases — never the target sentence itself
    let hint = '';
    try {
      hint = decodeURIComponent(request.headers.get('x-chilaka-hint') ?? '').slice(0, 1500);
    } catch {
      hint = '';
    }
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: btoa(bin),
      language: 'te',
      ...(hint ? { initial_prompt: hint } : {}),
    });
    return json({ text: String(result?.text ?? '').trim() });
  } catch (err) {
    return error(`asr failed: ${err.message ?? err}`, 502);
  }
}

// ---- /auth/* ----
// Error codes the app maps to copy: 'exists' (409), 'invalid' (401), 'rate' (429).
async function findUserByEmail(env, email) {
  return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

async function issue(env, user, extra = {}, status = 200) {
  const token = await signToken(env, { uid: user.id, slot: user.slot_key, ver: user.token_ver });
  return json({ token, slot: user.slot_key, ...extra }, status);
}

async function handleSignup(request, env) {
  if (limited(`signup:${clientIp(request)}`, 5, 60 * 60_000)) return error('rate', 429);
  const { body, error: bad } = await readJson(request);
  if (bad) return bad;
  const email = normaliseEmail(body?.email);
  if (!EMAIL_RE.test(email)) return error('bad email', 400);
  if (!isAuthKey(body?.authKey)) return error('bad authKey', 400);
  if (await findUserByEmail(env, email)) return error('exists', 409);

  // Adopt the device's existing slot when it is free, so progress carries over.
  let slot = typeof body?.slot === 'string' && KEY_RE.test(body.slot) ? body.slot : null;
  if (slot) {
    const owned = await env.DB.prepare('SELECT 1 AS one FROM users WHERE slot_key = ?').bind(slot).first();
    if (owned) slot = null;
  }
  if (!slot) slot = randomHex(28);
  await ensureSlotRow(env, slot);

  const { serverSalt, authHash } = await newCredential(body.authKey);
  const recoveryCode = makeRecoveryCode();
  const user = { id: randomHex(16), email, slot_key: slot, token_ver: 1 };
  await env.DB.prepare(
    'INSERT INTO users (id, email, auth_hash, server_salt, recovery_hash, slot_key, token_ver, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
  )
    .bind(user.id, email, authHash, serverSalt, await hashRecoveryCode(recoveryCode), slot, Date.now())
    .run();
  return issue(env, user, { recoveryCode }, 201);
}

// Hashed against a throwaway salt when the email is unknown so both failures
// take the same time.
const DUMMY = { server_salt: '00'.repeat(16), auth_hash: '00'.repeat(32) };

async function handleLogin(request, env) {
  if (limited(`login:${clientIp(request)}`, 10, 10 * 60_000)) return error('rate', 429);
  const { body, error: bad } = await readJson(request);
  if (bad) return bad;
  const email = normaliseEmail(body?.email);
  if (!EMAIL_RE.test(email) || !isAuthKey(body?.authKey)) return error('invalid', 401);
  const user = await findUserByEmail(env, email);
  const ok = await checkAuthKey((user ?? DUMMY).server_salt, (user ?? DUMMY).auth_hash, body.authKey);
  if (!user || !ok) return error('invalid', 401);
  return issue(env, user);
}

async function handleReset(request, env) {
  if (limited(`login:${clientIp(request)}`, 10, 10 * 60_000)) return error('rate', 429);
  const { body, error: bad } = await readJson(request);
  if (bad) return bad;
  const email = normaliseEmail(body?.email);
  if (!EMAIL_RE.test(email) || !isAuthKey(body?.authKey)) return error('invalid', 401);
  const user = await findUserByEmail(env, email);
  const ok = user && (await checkRecoveryCode(body?.recoveryCode, user.recovery_hash));
  if (!ok) return error('invalid', 401);

  const { serverSalt, authHash } = await newCredential(body.authKey);
  const recoveryCode = makeRecoveryCode();
  const ver = user.token_ver + 1;
  await env.DB.prepare('UPDATE users SET auth_hash = ?, server_salt = ?, recovery_hash = ?, token_ver = ? WHERE id = ?')
    .bind(authHash, serverSalt, await hashRecoveryCode(recoveryCode), ver, user.id)
    .run();
  return issue(env, { ...user, token_ver: ver }, { recoveryCode });
}

async function handleAuth(request, env, path) {
  if (!env.DB) return error('accounts unavailable', 503);
  if (path === '/auth/me') {
    if (request.method !== 'GET') return error('method', 405);
    const who = await verifyToken(env, request.headers.get('authorization'));
    return who ? json({ email: who.email, slot: who.slot }) : error('unauthorized', 401);
  }
  if (request.method !== 'POST') return error('method', 405);
  if (path === '/auth/signup') return handleSignup(request, env);
  if (path === '/auth/login') return handleLogin(request, env);
  if (path === '/auth/reset') return handleReset(request, env);
  return error('not found', 404);
}

// ---- /push/* ----
async function handlePush(request, env, path) {
  if (path === '/push/vapid') {
    if (request.method !== 'GET') return error('method', 405);
    const keys = await getVapidKeys(env);
    return json({ publicKey: vapidPublicKeyString(keys.publicKey) });
  }
  if (path !== '/push/subscribe') return error('not found', 404);
  if (!env.DB) return error('accounts unavailable', 503);
  const who = await verifyToken(env, request.headers.get('authorization'));
  if (!who) return error('unauthorized', 401);
  const { body, error: bad } = await readJson(request);
  if (bad) return bad;

  if (request.method === 'DELETE') {
    if (typeof body?.endpoint !== 'string') return error('need {endpoint}', 400);
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(body.endpoint, who.uid).run();
    return json({ ok: true });
  }
  if (request.method !== 'POST') return error('method', 405);

  const sub = body?.subscription;
  const hh = Number(body?.hh);
  const mm = Number(body?.mm);
  if (
    typeof sub?.endpoint !== 'string' ||
    !/^https:\/\//.test(sub.endpoint) ||
    typeof sub?.keys?.p256dh !== 'string' ||
    typeof sub?.keys?.auth !== 'string'
  ) {
    return error('bad subscription', 400);
  }
  if (typeof body?.tz !== 'string' || !isValidTimeZone(body.tz)) return error('bad tz', 400);
  if (!Number.isInteger(hh) || hh < 0 || hh > 23 || !Number.isInteger(mm) || mm < 0 || mm > 59) return error('bad time', 400);
  const enabled = body?.enabled === false ? 0 : 1;
  await env.DB.prepare(
    `INSERT INTO push_subs (user_id, endpoint, p256dh, auth, tz, hh, mm, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       tz = excluded.tz, hh = excluded.hh, mm = excluded.mm, enabled = excluded.enabled`,
  )
    .bind(who.uid, sub.endpoint, sub.keys.p256dh, sub.keys.auth, body.tz, hh, mm, enabled, Date.now())
    .run();
  return json({ ok: true, enabled: enabled === 1 });
}

// ---- legacy /<key> sync slot ----
async function handleSlot(request, env, key) {
  if (!KEY_RE.test(key)) return error('bad key', 400);

  if (request.method === 'GET') {
    const stored = await loadSlot(env, key);
    if (!stored) return error('not found', 404);
    return json(stored);
  }

  if (request.method === 'PUT') {
    const { body, error: bad } = await readJson(request);
    if (bad) return bad;
    if (typeof body?.rev !== 'number' || !body?.data) return error('need {rev, data}', 400);
    const current = await loadSlot(env, key);
    const currentRev = current?.rev ?? 0;
    if (body.rev !== currentRev + 1) return json({ conflict: true, rev: currentRev }, 409);
    // brakes: new-slot creation per IP, and per-slot write pace (protects
    // the KV free tier's 1k writes/day from hammering or runaway clients)
    if (currentRev === 0 && limited(`newslot:${clientIp(request)}`, 4, 60 * 60_000)) {
      return error('too many new devices from this network — try later', 429);
    }
    if (limited(`put:${key}`, 20, 60 * 60_000)) return error('rate limited — try again in a few minutes', 429);
    await saveSlot(env, key, { rev: body.rev, updatedAt: Date.now(), data: body.data });
    return json({ rev: body.rev });
  }

  return error('method', 405);
}

// ---- cron: send due reminders ----
export async function runReminders(env, now = new Date(), { fetchImpl = fetch } = {}) {
  if (!env.DB) return { sent: 0, skipped: 0, dropped: 0 };
  const { results: subs } = await env.DB.prepare(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.tz, s.hh, s.mm, s.enabled, s.last_sent_day,
            u.slot_key, p.last_active_day
       FROM push_subs s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN progress p ON p.slot_key = u.slot_key
      WHERE s.enabled = 1`,
  ).all();

  const stats = { sent: 0, skipped: 0, dropped: 0 };
  for (const sub of dueSubs(subs, now)) {
    if (sub.last_active_day === sub.localDay) {
      stats.skipped += 1; // already practised today — no nag
      continue;
    }
    // streak only matters for copy, so parse it just for due subs (in SQLite)
    const row = await env.DB.prepare("SELECT json_extract(data, '$.data.streaks[0].current') AS streak FROM progress WHERE slot_key = ?")
      .bind(sub.slot_key)
      .first();
    const copy = pickCopy(dayOfYear(now), row?.streak ?? 0);
    let status = 0;
    try {
      status = await sendPush(env, sub, { ...copy, url: '/' }, { fetchImpl });
    } catch {
      status = 0;
    }
    if (status === 404 || status === 410) {
      await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id).run();
      stats.dropped += 1;
      continue;
    }
    if (status >= 200 && status < 300) {
      await env.DB.prepare('UPDATE push_subs SET last_sent_day = ? WHERE id = ?').bind(sub.localDay, sub.id).run();
      stats.sent += 1;
    }
  }
  return stats;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);
    try {
      if (pathname.startsWith('/asr/')) return await handleAsr(request, env, pathname.slice(5));
      if (pathname.startsWith('/auth/')) return await handleAuth(request, env, pathname);
      if (pathname.startsWith('/push/')) return await handlePush(request, env, pathname);
      return await handleSlot(request, env, pathname.replace(/^\/+/, ''));
    } catch (err) {
      return error(`server error: ${err.message ?? err}`, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, new Date(event.scheduledTime ?? Date.now())));
  },
};
