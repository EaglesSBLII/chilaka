// node tools/lib/polish-cli.mjs in.wav out.m4a — the render's polish pass (trim, fades,
// lead-in/tail, loudness match) + max-quality AAC, for clips assembled outside render-voice.mjs.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { polishWav, encodeM4a } from './audio.mjs';
const [inWav, outM4a] = process.argv.slice(2);
if (!inWav || !outM4a) { console.error('usage: polish-cli.mjs in.wav out.m4a'); process.exit(2); }
const tmp = mkdtempSync(join(tmpdir(), 'polish-'));
try {
  const polished = join(tmp, 'final.wav');
  const r = polishWav(inWav, polished, tmp);
  encodeM4a(polished, outM4a);
  console.log(JSON.stringify({ secs: Number(r.secs.toFixed(2)), lufs: Number(r.after.toFixed(1)) }));
} finally { rmSync(tmp, { recursive: true, force: true }); }
