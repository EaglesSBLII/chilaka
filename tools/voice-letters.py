# Cuts every letter card down to the LETTER ALONE.
#
# The letter cards were rendered as "letter. example word." ("అ. అమ్మ.") because the voice
# clone says an isolated letter far more reliably with a word after it. The Reading &
# Writing track now teaches every letter on its own first, with no words until later, so
# the card must say only the letter's sound. This keeps the verified take and trims it:
# the clip is force-aligned (tools/lib/mmsalign.py), the letter's own span is cut with
# short fades and a little air around it, and the result goes through the normal
# polish + AAC pass, replacing app/public/audio/v-<voice>/<id>.m4a.
#
# Run it while the unit files still carry the "letter. word." audioTe (it needs that text
# to align); afterwards audioTe is removed from those items.
#
#   vendor/f5-venv/bin/python tools/voice-letters.py --voice female|male|both [--ids a,b] [--dry]
import os, sys, re, json, argparse, tempfile, subprocess
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from mmsalign import ROOT, load_items, word_spans, envelope, letter_split, load16, load24, MIN_SPAN, MAX_DIP

ap = argparse.ArgumentParser(); ap.add_argument('--voice', default='both'); ap.add_argument('--ids', default=None); ap.add_argument('--dry', action='store_true')
args = ap.parse_args()
voices = ['female', 'male'] if args.voice == 'both' else [args.voice]
TE = r'[ఀ-౿]'
cards = {i: t for i, t in load_items().items() if re.fullmatch(rf'{TE}{{1,3}}\. {TE}+\.', t)}
if args.ids: cards = {i: t for i, t in cards.items() if i in set(args.ids.split(','))}
SR = 24000
LEAD, TAIL = 0.06, 0.12  # silence around the letter, seconds

def fade(x, fi, fo):
    x = x.copy(); fi = min(fi, len(x)); fo = min(fo, len(x))
    x[:fi] *= np.linspace(0, 1, fi, endpoint=False); x[len(x)-fo:] *= np.linspace(1, 0, fo, endpoint=False); return x

report = {}
with tempfile.TemporaryDirectory() as tmp:
    for v in voices:
        d = os.path.join(ROOT, 'app/public/audio', f'v-{v}')
        for cid, text in sorted(cards.items()):
            key = f'{v}/{cid}'; path = os.path.join(d, f'{cid}.m4a')
            try:
                a16, _ = load16(path, tmp); a24, _ = load24(path, tmp)
                spoken = re.sub(rf'^({TE}{{1,3}})\. ', r'\1, ', text)
                ws = word_spans(a16, spoken)
                if len(ws) < 2: raise ValueError(f'alignment found {len(ws)} words')
                (_, ls, _, lc), (_, wst, _, _) = ws[0], ws[1]
                env_s, _ = envelope(a16, 16000)
                sep = letter_split(a16, 16000, spoken, cid); le = sep['letter_end']
                clean = sep['letter_span'] >= MIN_SPAN and sep['sep_dip'] <= MAX_DIP
                s = max(0.0, min(env_s, ls) - 0.02); e = min(le + 0.03, wst - 0.01) if wst > le else le
                piece = fade(a24[int(s*SR):int(e*SR)], int(0.010*SR), int(0.050*SR))
                out = np.concatenate([np.zeros(int(LEAD*SR), dtype=np.float32), piece.astype(np.float32), np.zeros(int(TAIL*SR), dtype=np.float32)])
                info = {'ok': True, 'clean': bool(clean), 'letter': text.split('.')[0], 'span': round(float(sep['letter_span']), 3), 'dip_db': round(float(sep['sep_dip']), 1),
                        'gap_to_word': round(float(wst - le), 3), 'conf': round(float(lc), 2), 'out_sec': round(len(out)/SR, 2)}
                if args.dry:
                    report[key] = info; print(f'[{v}] {cid} {info}'); continue
                wav = os.path.join(tmp, f'{v}-{cid}.wav'); sf.write(wav, out, SR, subtype='PCM_16')
                r = subprocess.run(['node', os.path.join(ROOT, 'tools/lib/polish-cli.mjs'), wav, path], capture_output=True, text=True)
                if r.returncode: raise ValueError('polish failed: ' + r.stderr[-200:])
                info['polish'] = r.stdout.strip(); report[key] = info
                print(f'[{v}] {cid} {"✓" if clean else "~"} {info["letter"]} span {info["span"]}s dip {info["dip_db"]} dB gap {info["gap_to_word"]}s → {info["out_sec"]}s')
            except Exception as ex:
                report[key] = {'ok': False, 'why': str(ex)}; print(f'[{v}] {cid} ✗ {ex}')
json.dump(report, open(os.path.join(ROOT, 'tools', 'voice-letters-report.json'), 'w'), indent=1, ensure_ascii=False)
bad = [k for k, r in report.items() if not r.get('ok')]; soft = [k for k, r in report.items() if r.get('ok') and not r.get('clean')]
print(f'\n{len(report)} clips: {len(report)-len(bad)-len(soft)} clean, {len(soft)} cut without a clear pause after the letter, {len(bad)} failed')
if soft: print('check by ear:', ' '.join(soft))
if bad: print('failed:', ' '.join(bad))
