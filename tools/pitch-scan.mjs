// Estimates each clip's median fundamental frequency (F0) via autocorrelation.
// Female studio voice ≈ 170-260 Hz; the old MMS voice ≈ 100-150 Hz. Flags any
// clip whose pitch says "male/old voice".

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(__dirname, '../app/public/audio');
const tmp = mkdtempSync(join(tmpdir(), 'pitch-'));

function readWav(path) {
  const buf = readFileSync(path);
  let o = 12, dataOff = 44, dataLen = buf.length - 44, sr = 16000;
  while (o < buf.length - 8) {
    const id = buf.toString('ascii', o, o + 4);
    const sz = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(o + 12);
    if (id === 'data') { dataOff = o + 8; dataLen = sz; break; }
    o += 8 + sz;
  }
  const n = Math.floor(dataLen / 2);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return { s, sr };
}

/** median F0 over voiced 40ms frames using normalized autocorrelation */
function medianF0(s, sr) {
  const frame = Math.floor(sr * 0.04);
  const hop = Math.floor(sr * 0.02);
  const minLag = Math.floor(sr / 400); // 400 Hz
  const maxLag = Math.floor(sr / 70); // 70 Hz
  const f0s = [];
  for (let start = 0; start + frame < s.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < frame; i++) energy += s[start + i] ** 2;
    if (energy / frame < 0.001) continue; // unvoiced/silence
    let bestLag = 0, bestR = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let r = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < frame - lag; i++) {
        r += s[start + i] * s[start + i + lag];
        e1 += s[start + i] ** 2;
        e2 += s[start + i + lag] ** 2;
      }
      const nr = r / Math.sqrt(e1 * e2 + 1e-9);
      if (nr > bestR) { bestR = nr; bestLag = lag; }
    }
    if (bestR > 0.5 && bestLag > 0) f0s.push(sr / bestLag);
  }
  if (f0s.length === 0) return 0;
  f0s.sort((a, b) => a - b);
  return f0s[Math.floor(f0s.length / 2)];
}

const files = readdirSync(AUDIO).filter((f) => f.endsWith('.m4a')).sort();
const rows = [];
for (const f of files) {
  const wav = join(tmp, 'p.wav');
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', join(AUDIO, f), wav], { stdio: 'pipe' });
  const { s, sr } = readWav(wav);
  const f0 = medianF0(s, sr);
  rows.push({ id: f.replace('.m4a', ''), f0: Math.round(f0) });
}
const male = rows.filter((r) => r.f0 > 0 && r.f0 < 165);
const female = rows.filter((r) => r.f0 >= 165);
const unvoiced = rows.filter((r) => r.f0 === 0);
console.log(`clips: ${rows.length} | female-pitch (≥165Hz): ${female.length} | male-pitch (<165Hz): ${male.length} | undetected: ${unvoiced.length}`);
const avg = (a) => (a.length ? Math.round(a.reduce((x, r) => x + r.f0, 0) / a.length) : 0);
console.log(`avg F0 — female group: ${avg(female)}Hz, male group: ${avg(male)}Hz`);
console.log('\nmale-pitched clips by unit:');
const byUnit = {};
for (const r of male) {
  const u = r.id.slice(0, 3);
  byUnit[u] = (byUnit[u] ?? 0) + 1;
}
console.log(JSON.stringify(byUnit));
console.log('\nfirst 20 male-pitched:', male.slice(0, 20).map((r) => `${r.id}(${r.f0}Hz)`).join(' '));
writeFileSync(join(__dirname, 'pitch-report.json'), JSON.stringify(rows, null, 1));
