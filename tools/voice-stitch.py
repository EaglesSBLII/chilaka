# Assembles the alphabet "row" items (అ, ఆ, ఇ … / క, చ, ట, త, ప / క, కా, కి …) from the
# verified single-letter clips instead of asking the voice model to read a bare list —
# the clone collapses on lists of isolated letters (u86-i12 came out as three vowels of
# twelve), while the letter+word cards ("అ. అమ్మ.") render the letter cleanly.
#
# For every letter in the row, the letter+word card that starts with it is force-aligned
# (tools/lib/mmsalign.py); the letter's own span (first word of "అ, అమ్మ.") is cut with
# short fades, the pieces are joined with a pause (comma 0.28 s, full stop 0.5 s) and the
# result goes through the normal polish + AAC pass. A letter whose card doesn't actually
# say it (letter span < 80 ms or no pause before the word) fails the row.
#
#   vendor/f5-venv/bin/python tools/voice-stitch.py --voice female|male|both [--ids u86-i12,u86-i13] [--dry]
import os, sys, re, json, argparse, tempfile, subprocess
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from mmsalign import ROOT, load_items, word_spans, envelope, letter_split, load16, load24, MIN_SPAN, MAX_DIP

ap = argparse.ArgumentParser(); ap.add_argument('--voice', default='both'); ap.add_argument('--ids', default=None); ap.add_argument('--dry', action='store_true')
args = ap.parse_args()
voices = ['female','male'] if args.voice == 'both' else [args.voice]
items = load_items()
TE = r'[ఀ-౿]'
# a row: only letters (1–3 Telugu code points each) separated by commas / full stops
is_row = lambda t: re.fullmatch(rf'(?:{TE}{{1,3}}[,.] ?)+', t) is not None and len(re.findall(rf'{TE}{{1,3}}', t)) >= 3
rows = {i: t for i, t in items.items() if is_row(t)}
if args.ids: rows = {i: t for i, t in rows.items() if i in set(args.ids.split(','))}
# letter → the card that says "letter. word."
card_for = {}
for i, t in items.items():
    m = re.fullmatch(rf'({TE}{{1,3}})\. ({TE}+)\.', t)
    if m and m.group(1) not in card_for: card_for[m.group(1)] = i
SR = 24000
PAUSE = {',': 0.28, '.': 0.50}
def fade(x, fi, fo):
    x = x.copy(); fi = min(fi, len(x)); fo = min(fo, len(x))
    x[:fi] *= np.linspace(0, 1, fi, endpoint=False); x[len(x)-fo:] *= np.linspace(1, 0, fo, endpoint=False); return x

report = {}
with tempfile.TemporaryDirectory() as tmp:
    for v in voices:
        d = os.path.join(ROOT, 'app/public/audio', f'v-{v}'); cache = {}
        def letter_piece(letter):
            if letter in cache: return cache[letter]
            cid = card_for.get(letter)
            if not cid: cache[letter] = (None, f'no card for {letter}'); return cache[letter]
            path = os.path.join(d, f'{cid}.m4a')
            a16, _ = load16(path, tmp); a24, _ = load24(path, tmp)
            spoken = re.sub(rf'^({TE}{{1,3}})\. ', r'\1, ', items[cid])
            ws = word_spans(a16, spoken)
            if len(ws) < 2: cache[letter] = (None, f'{cid}: alignment found {len(ws)} words'); return cache[letter]
            (lw, ls, le, lc), (ww, wst, _, _) = ws[0], ws[1]
            env_s, _ = envelope(a16, 16000)
            sep = letter_split(a16, 16000, spoken); le = sep['letter_end']; gap = wst - le
            if sep['letter_span'] < MIN_SPAN or sep['sep_dip'] > MAX_DIP:
                cache[letter] = (None, f'{cid}: letter {letter} not spoken separately (span {sep["letter_span"]:.2f}s, dip {sep["sep_dip"]:.0f} dB)'); return cache[letter]
            s = max(0.0, min(env_s, ls) - 0.02); e = le
            piece = fade(a24[int(s*SR):int(e*SR)], int(0.010*SR), int(0.045*SR))
            cache[letter] = (piece, f'{cid} {ls:.2f}-{le:.2f}s pause {gap:.2f}s conf {lc:.2f}')
            return cache[letter]
        for rid, text in sorted(rows.items()):
            toks = re.findall(rf'({TE}{{1,3}})([,.])', text)
            parts = []; notes = []; bad = None
            for k, (letter, sep) in enumerate(toks):
                piece, note = letter_piece(letter); notes.append(f'{letter}: {note}')
                if piece is None: bad = note; break
                parts.append(piece)
                if k < len(toks) - 1: parts.append(np.zeros(int(PAUSE[sep] * SR), dtype=np.float32))
            if bad:
                report[f'{v}/{rid}'] = {'ok': False, 'why': bad}; print(f'[{v}] {rid} ✗ {bad}'); continue
            out = np.concatenate(parts)
            wav = os.path.join(tmp, f'{v}-{rid}.wav'); sf.write(wav, out, SR, subtype='PCM_16')
            if args.dry:
                print(f'[{v}] {rid} would build {len(toks)} letters, {len(out)/SR:.2f}s'); continue
            r = subprocess.run(['node', os.path.join(ROOT, 'tools/lib/polish-cli.mjs'), wav, os.path.join(d, f'{rid}.m4a')], capture_output=True, text=True)
            if r.returncode: report[f'{v}/{rid}'] = {'ok': False, 'why': r.stderr[-200:]}; print(f'[{v}] {rid} ✗ polish failed: {r.stderr[-200:]}'); continue
            report[f'{v}/{rid}'] = {'ok': True, 'letters': notes, 'polish': r.stdout.strip()}
            print(f'[{v}] {rid} ✓ {len(toks)} letters → {r.stdout.strip()}')
            for n in notes: print('     ', n)
json.dump(report, open(os.path.join(ROOT, 'tools', 'voice-stitch-report.json'), 'w'), indent=1, ensure_ascii=False)
