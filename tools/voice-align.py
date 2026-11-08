# Forced-alignment audit of the rendered clips: Meta's MMS aligner (torchaudio
# MMS_FA, 1,100+ languages, romanized text) pins every character of the item's
# Telugu text to a moment in the clip. Audio that no character claims is what a
# learner hears as a stray syllable — before the first character (head) or after
# the last (tail). Also reports the mean per-character alignment confidence,
# which drops when the voice slurs or warbles.
#
#   vendor/f5-venv/bin/python tools/voice-align.py [--voice female|male] [--only u65] [--out tools/voice-align-report.json]
#   vendor/f5-venv/bin/python tools/voice-align.py --batch takes.json   # [{id, wav, text}] → JSON rows (render QA gate)
import os, sys, json, argparse, tempfile
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from mmsalign import ROOT, roman, load_items, measure, load16  # noqa: E402 (shared with voice-stitch / voice-trim)
ap = argparse.ArgumentParser(); ap.add_argument('--voice', default='both'); ap.add_argument('--only', default=None); ap.add_argument('--out', default=os.path.join(ROOT,'tools','voice-align-report.json')); ap.add_argument('--batch', default=None)
args = ap.parse_args()
voices = ['female','male'] if args.voice=='both' else [args.voice]
items = load_items()

if args.batch:
    jobs = json.load(open(args.batch)); out = {}
    with tempfile.TemporaryDirectory() as tmp:
        for j in jobs:
            try:
                a, sr = load16(j['wav'], tmp); out[j['id']] = measure(a, sr, j['text'])
            except Exception as e:
                out[j['id']] = {'error': str(e)[:120]}
    print(json.dumps(out, ensure_ascii=False)); sys.exit(0)

report = {}
with tempfile.TemporaryDirectory() as tmp:
    for v in voices:
        d = os.path.join(ROOT,'app/public/audio',f'v-{v}'); rows = {}
        files = sorted(x for x in os.listdir(d) if x.endswith('.m4a') and (not args.only or x.startswith(args.only)))
        for k,fn in enumerate(files):
            cid = fn[:-4]; te = items.get(cid)
            if te is None: continue
            try:
                a, sr = load16(os.path.join(d,fn), tmp); rows[cid] = measure(a, sr, te)
            except Exception as e:
                rows[cid] = {'te':te,'error':str(e)[:80]}; continue
            if (k+1)%100==0: print(f'  {v} {k+1}/{len(files)}', flush=True)
        report[v] = rows
        te_ = np.array([r['tail_extra'] for r in rows.values() if 'tail_extra' in r]); he_ = np.array([r['head_extra'] for r in rows.values() if 'head_extra' in r])
        print(f'[{v}] {len(rows)} clips  tail_extra median {np.median(te_):.3f} p90 {np.percentile(te_,90):.3f} p99 {np.percentile(te_,99):.3f} max {te_.max():.3f} | head_extra p99 {np.percentile(he_,99):.3f} max {he_.max():.3f}', flush=True)
json.dump(report, open(args.out,'w'), indent=1, ensure_ascii=False)
print('wrote', args.out)
