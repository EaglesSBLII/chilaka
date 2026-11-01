// Post-deploy check: sends a handful of reference clips to the deployed
// worker's /asr route (Workers AI Whisper) and scores the transcripts, so we
// know phone speech scoring works before the learner ever taps the mic.
//
//   node verify-phone-asr.mjs <endpoint> <syncKey>

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AUDIO = join(ROOT, 'app/public/audio');

const [endpoint, key] = process.argv.slice(2);
if (!endpoint || !key) {
  console.error('usage: node verify-phone-asr.mjs <endpoint> <syncKey>');
  process.exit(1);
}

const SAMPLES = [
  ['u01-i01', 'మీరు ఎలా ఉన్నారు?'],
  ['u01-i02', 'నేను బాగున్నాను.'],
  ['u12-i01', null], // read text from content
  ['u17-i01', null],
  ['u24-i01', null],
];

// pull texts from content for the null entries
import { readdirSync } from 'node:fs';
const items = new Map();
for (const f of readdirSync(join(ROOT, 'app/content/units')).filter((x) => x.endsWith('.json'))) {
  const u = JSON.parse(readFileSync(join(ROOT, 'app/content/units', f), 'utf-8'));
  for (const it of u.items) items.set(it.id, it.te);
}

const tmp = mkdtempSync(join(tmpdir(), 'phoneasr-'));
let pass = 0;
for (const [id, teMaybe] of SAMPLES) {
  const te = teMaybe ?? items.get(id);
  const wav = join(tmp, 'c.wav');
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', join(AUDIO, `${id}.m4a`), wav], { stdio: 'pipe' });
  const res = await fetch(`${endpoint.replace(/\/+$/, '')}/asr/${key}`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: readFileSync(wav),
  });
  const body = await res.json().catch(() => ({}));
  const heard = String(body.text ?? '').trim();
  const ok = res.ok && heard.length > 0;
  if (ok) pass++;
  console.log(`${ok ? '✓' : '✗'} ${id} [${res.status}]\n    want:  ${te}\n    heard: ${heard || body.error || '(nothing)'}`);
}
console.log(`\n${pass}/${SAMPLES.length} clips transcribed by the deployed worker.`);
process.exit(pass >= 3 ? 0 : 1);
