# Trims the held-out final vowel that reads as an extra syllable. The male reference
# speaker releases his last vowel slowly and the clone copies it — on some clips the
# sound runs 0.15–0.4 s past where the aligner places the last character. Rather than
# re-rolling until the model happens to stop in time, cut every clip whose tail runs
# past --max-tail down to --keep seconds after its last character (gentle fade), then
# polish + encode again so lead-in, tail silence and loudness stay identical.
#
#   vendor/f5-venv/bin/python tools/voice-trim.py --voice male [--max-tail 0.12] [--keep 0.10] [--ids ...] [--dry]
import os, sys, json, argparse, tempfile, subprocess
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from mmsalign import ROOT, load_items, measure, load16, load24

ap = argparse.ArgumentParser(); ap.add_argument('--voice', required=True); ap.add_argument('--max-tail', type=float, default=None); ap.add_argument('--keep', type=float, default=0.10)
ap.add_argument('--ids', default=None); ap.add_argument('--dry', action='store_true')
args = ap.parse_args()
# corpus medians: female tails sit at 0.006 s, male at 0.063 s; anything past these reads as a held syllable
MAX_TAIL = args.max_tail if args.max_tail is not None else (0.12 if args.voice == 'male' else 0.10)
items = load_items(); d = os.path.join(ROOT, 'app/public/audio', f'v-{args.voice}')
ids = sorted(f[:-4] for f in os.listdir(d) if f.endswith('.m4a')) if not args.ids else args.ids.split(',')
SR = 24000; FADE = 0.06
report = {}; trimmed = 0
with tempfile.TemporaryDirectory() as tmp:
    for k, cid in enumerate(ids):
        te = items.get(cid)
        if te is None: continue
        path = os.path.join(d, f'{cid}.m4a')
        a16, _ = load16(path, tmp)
        m = measure(a16, 16000, te, cid)
        if m['tail_extra'] <= MAX_TAIL: continue
        a24, _ = load24(path, tmp)
        end = int((m['last_char'] + args.keep) * SR)
        if end >= len(a24): continue
        out = a24[:end].copy(); n = min(int(FADE * SR), len(out))
        out[len(out)-n:] *= np.linspace(1, 0, n, endpoint=False)
        wav = os.path.join(tmp, f'{cid}.wav'); sf.write(wav, out, SR, subtype='PCM_16')
        if args.dry:
            print(f'{cid} tail {m["tail_extra"]:.3f} → would cut at {m["last_char"]+args.keep:.2f}s (env end {m["env"][1]:.2f}s)  {te}'); continue
        r = subprocess.run(['node', os.path.join(ROOT, 'tools/lib/polish-cli.mjs'), wav, path], capture_output=True, text=True)
        if r.returncode: print(f'{cid} ✗ polish failed: {r.stderr[-200:]}'); continue
        b16, _ = load16(path, tmp); after = measure(b16, 16000, te, cid)
        report[cid] = {'te': te, 'tail_before': m['tail_extra'], 'tail_after': after['tail_extra'], 'conf_before': m['conf'], 'conf_after': after['conf']}
        trimmed += 1
        print(f'{cid} tail {m["tail_extra"]:.3f} → {after["tail_extra"]:.3f}  conf {m["conf"]:.2f} → {after["conf"]:.2f}  {te}')
        if (k+1) % 100 == 0: print(f'  {k+1}/{len(ids)}', flush=True)
print(f'[{args.voice}] trimmed {trimmed} clips past {MAX_TAIL}s')
json.dump(report, open(os.path.join(ROOT, 'tools', f'voice-trim-{args.voice}-report.json'), 'w'), indent=1, ensure_ascii=False)
