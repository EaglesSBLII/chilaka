// Post-production pass over every rendered clip, so all 1,157 reference
// recordings sound like the polished lesson-1 set:
//   • the voice never cuts in on the first sample — a short silent lead-in
//     (LEAD_S) lets the player settle before the first syllable
//   • a longer tail (TAIL_S) so the phrase lands and breathes instead of
//     being chopped at the last consonant
//   • matched loudness: every clip is brought to the same integrated level
//     (TARGET_LUFS) with a true-peak ceiling, so no phrase is suddenly louder
//     or quieter than the one before it
//   • re-encoded with the same max-quality AAC settings the render gate uses
//
// Idempotent: reads the ORIGINAL takes (audio-src/ at the repo root, created on
// the first run from the current clips) and writes app/public/audio/, so
// running it twice never stacks two lead-ins.
//
//   node tools/polish-audio.mjs [--only u05] [--dry]

import { readdirSync, readFileSync, mkdirSync, existsSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'app/public/audio');
const SRC_DIR = join(ROOT, 'audio-src'); // outside app/public so it never ships

import { TARGET_LUFS, TRUE_PEAK_DB, polishWav, encodeM4a } from './lib/audio.mjs';

const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
const dry = process.argv.includes('--dry');

const tmp = join(tmpdir(), `polish-${process.pid}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(SRC_DIR, { recursive: true });

const ids = readdirSync(OUT_DIR).filter((f) => f.endsWith('.m4a')).map((f) => f.slice(0, -4)).filter((id) => !only || id.startsWith(only));
// First run: the current clips become the untouched source set.
let seeded = 0;
for (const id of ids) {
  const src = join(SRC_DIR, `${id}.m4a`);
  if (!existsSync(src)) { copyFileSync(join(OUT_DIR, `${id}.m4a`), src); seeded++; }
}
if (seeded) console.log(`kept ${seeded} original takes in audio-src/`);

const stats = [];
let done = 0;
for (const id of ids) {
  const src = join(SRC_DIR, `${id}.m4a`);
  const final = join(tmp, 'final.wav');
  const r = polishWav(src, final, tmp);
  stats.push({ id, before: r.before, after: r.after, secs: Number(r.secs.toFixed(2)) });
  if (!dry) encodeM4a(final, join(OUT_DIR, `${id}.m4a`));
  done++;
  if (done % 100 === 0) console.log(`  …${done}/${ids.length}`);
}
rmSync(tmp, { recursive: true, force: true });

const spread = (arr) => `${Math.min(...arr).toFixed(1)} … ${Math.max(...arr).toFixed(1)}`;
console.log(`\n${done} clips polished${dry ? ' (dry run — nothing written)' : ''}`);
console.log(`loudness before: ${spread(stats.map((s) => s.before))} LUFS`);
console.log(`loudness after:  ${spread(stats.map((s) => s.after))} LUFS   (target ${TARGET_LUFS}, peak ceiling ${TRUE_PEAK_DB} dBTP)`);
writeFileSync(join(__dirname, 'polish-report.json'), JSON.stringify(stats, null, 1));
