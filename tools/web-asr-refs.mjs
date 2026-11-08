#!/usr/bin/env node
// What the WEB recognizer (Workers AI whisper-large-v3-turbo behind the sync
// worker's /asr route) hears in our own reference clips. The phone grades a
// learner against this as well as the target text, so a learner who matches
// the recognizer's own hearing of the native clip passes.
//
//   node tools/web-asr-refs.mjs --units u01,u02 [--voice female|male|both]
//
// Writes app/src/content/reference-transcripts-web-<voice>.json (merged, sorted).
// The route is rate limited (30 clips / 10 min per key, 4 new keys per hour),
// so this rotates keys and paces itself; a full run over many units is slow.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const units = opt('units', 'u01,u02').split(',');
const voices = opt('voice', 'both') === 'both' ? ['female', 'male'] : [opt('voice')];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EP = readFileSync(path.join(ROOT, 'app/src/sync-config.ts'), 'utf8').match(/SYNC_ENDPOINT = '([^']+)'/)[1];
const tmp = mkdtempSync(path.join(tmpdir(), 'webrefs-'));

// Probe slots are cached between runs: the worker allows only 4 new slots per
// hour per network, so throwing keys away would stall every rerun.
const KEYS_FILE = process.env.WEBREFS_KEYS ?? path.join(process.env.HOME ?? tmpdir(), '.cache', 'chilaka', 'webrefs-keys.json');
const keys = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')).map((key) => ({ key, used: 0, since: 0 })) : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function newKey() {
  const key = randomBytes(28).toString('hex');
  const r = await fetch(`${EP}/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: 1, data: { probe: 'web-asr-refs' } }) });
  if (!r.ok) return null;
  keys.push({ key, used: 0, since: Date.now() });
  mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  writeFileSync(KEYS_FILE, JSON.stringify(keys.map((k) => k.key)));
  return keys[keys.length - 1];
}
async function pickKey() {
  for (;;) {
    for (const k of keys) {
      if (Date.now() - k.since > 10 * 60_000) { k.used = 0; k.since = Date.now(); }
      if (k.used < 28) return k;
    }
    if (keys.length < 4) {
      const k = await newKey();
      if (k) return k;
      if (keys.length === 0) { console.log('  no probe slot yet (new-slot limit) — retrying in 5 min'); await sleep(5 * 60_000); continue; }
    }
    const soonest = Math.max(0, Math.min(...keys.map((k) => k.since + 10 * 60_000 - Date.now())));
    console.log(`  pacing: waiting ${Math.ceil(soonest / 1000)}s for the rate limit`);
    await sleep(soonest + 1000);
  }
}
async function hear(wavPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const k = await pickKey();
    k.used++;
    const res = await fetch(`${EP}/asr/${k.key}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: readFileSync(wavPath) });
    if (res.status === 429) { k.used = 99; continue; }
    if (!res.ok) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    const j = await res.json();
    return String(j.text ?? '').trim();
  }
  return null;
}

for (const voice of voices) {
  const out = path.join(ROOT, `app/src/content/reference-transcripts-web-${voice}.json`);
  const refs = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  for (const uid of units) {
    const unit = JSON.parse(readFileSync(path.join(ROOT, `app/content/units/${uid}.json`), 'utf8'));
    for (const item of unit.items) {
      const m4a = path.join(ROOT, `app/public/audio/v-${voice}/${item.id}.m4a`);
      if (!existsSync(m4a)) continue;
      const wav = path.join(tmp, `${voice}-${item.id}.wav`);
      execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', m4a, wav]);
      const text = await hear(wav);
      if (text === null) { console.log(`✗ ${voice} ${item.id} (no answer)`); continue; }
      refs[item.id] = text;
      console.log(`${voice.padEnd(6)} ${item.id}  ${item.audioTe ?? item.te}  →  ${text}`);
      writeFileSync(out, JSON.stringify(Object.fromEntries(Object.entries(refs).sort()), null, 2) + '\n');
    }
  }
  console.log(`wrote ${out} (${Object.keys(refs).length} items)`);
}
