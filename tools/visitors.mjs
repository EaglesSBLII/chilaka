// Visitor report for the Chilaka website. Reads the visit log the site worker writes to KV.
//
//   node tools/visitors.mjs            # last 30 days
//   node tools/visitors.mjs 7          # last 7 days
//   node tools/visitors.mjs 30 --raw   # every visit, newest first
//
// Needs the Cloudflare login Wrangler already holds (same account as the app).

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NS = 'c7cc9dca8cc643548a74f6d7fd05f839';
const SITE = join(dirname(fileURLToPath(import.meta.url)), '../site');
const days = Number(process.argv[2]) || 30;
const raw = process.argv.includes('--raw');
const since = new Date(Date.now() - days * 86400_000).toISOString();

function wrangler(args, attempt = 1) {
  // account pinned so wrangler never tries to prompt (no terminal here)
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'a45e4bea84463476d41f6ce73ae2476a' };
  try {
    return execFileSync('npx', ['--yes', 'wrangler', ...args], { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  } catch (e) {
    // First call after a while can fail once while wrangler refreshes its OAuth token; retry before giving up.
    if (attempt < 3) { execFileSync('sleep', ['2']); return wrangler(args, attempt + 1); }
    const detail = ((e.stderr || '') + (e.stdout || '')).trim().split('\n').slice(-8).join('\n');
    console.error(`wrangler ${args.slice(0, 3).join(' ')} failed after ${attempt} attempts:\n${detail}`);
    console.error('If it says you are logged out, run: npx wrangler login');
    process.exit(1);
  }
}

// wrangler sometimes prints a banner or notice before the JSON; parse from the first bracket/brace.
function json(text) {
  const i = Math.min(...['[', '{'].map((c) => text.indexOf(c)).filter((n) => n >= 0));
  if (!Number.isFinite(i)) throw new Error(`no JSON in wrangler output:\n${text.slice(0, 400)}`);
  return JSON.parse(text.slice(i));
}

const keys = json(wrangler(['kv', 'key', 'list', '--namespace-id', NS, '--prefix', 'v:', '--remote']))
  .map((k) => k.name)
  .filter((k) => k.slice(2, 26) >= since)
  .sort()
  .reverse();

if (keys.length === 0) {
  console.log(`No visits in the last ${days} days.`);
  process.exit(0);
}

// Fetch values (one call each; fine for a personal site).
const visits = keys.map((k) => {
  try { return json(wrangler(['kv', 'key', 'get', '--namespace-id', NS, k, '--remote'])); } catch { return null; }
}).filter(Boolean);

const count = (f) => {
  const m = new Map();
  for (const v of visits) { const k = f(v) || '(unknown)'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const people = new Set(visits.map((v) => v.visitor)).size;
const place = (v) => [v.city, v.region, v.country].filter(Boolean).join(', ');

console.log(`Chilaka website · last ${days} days`);
console.log(`${visits.length} page views from ${people} visitors\n`);

const table = (title, rows) => {
  console.log(title);
  for (const [k, n] of rows.slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log('');
};
table('By place', count(place));
table('By country', count((v) => v.country));
table('By page', count((v) => v.page));
table('By device', count((v) => v.device));
table('By browser', count((v) => v.browser));
table('Came from', count((v) => v.referrer || '(direct / link)'));
table('By day', count((v) => v.ts.slice(0, 10)).sort((a, b) => (a[0] < b[0] ? 1 : -1)));

if (raw) {
  console.log('Every visit, newest first');
  for (const v of visits) console.log(`  ${v.ts.replace('T', ' ').slice(0, 16)}  ${v.page.padEnd(18)} ${place(v).padEnd(32)} ${v.device}/${v.browser}  ${v.referrer || ''}  [${v.visitor}]`);
}
