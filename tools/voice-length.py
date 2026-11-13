# Makes long vowels LONG and short vowels SHORT in the letter cards.
#
# The voice clone says an isolated ఇ and ఈ (or కి and కీ) at the same length, and
# sometimes the "long" one comes out shorter. In Telugu the length IS the
# difference, so this re-times each card: the steady middle of the vowel is
# stretched or tightened with WSOLA (waveform-similarity overlap-add: whole
# pitch periods are repeated or dropped, so the pitch and the vowel colour stay
# as recorded), leaving the start (consonant, onset) and the natural fade-out
# untouched. Targets: a short vowel sounds for at most SHORT_MAX, a long vowel or
# diphthong for at least RATIO x its short partner and at least LONG_MIN.
# Then the alphabet rows that list these letters are rebuilt from the new cards,
# so a row and its cards always agree.
#
# Works from pristine copies kept in audio-src/length-orig/ (made on first run),
# so running it twice never stretches a clip twice.
#
#   vendor/f5-venv/bin/python tools/voice-length.py --voice female|male|both [--dry]
import os, sys, json, shutil, argparse, tempfile, subprocess
import numpy as np, soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--voice', default='both'); ap.add_argument('--dry', action='store_true')
args = ap.parse_args()
voices = ['female', 'male'] if args.voice == 'both' else [args.voice]
SR = 24000
SHORT_MAX, LONG_MIN, RATIO = 0.23, 0.52, 2.3
LEAD, TAIL = 0.06, 0.12

# (short card, long card, starts with a consonant)
PAIRS = [('u81-i01', 'u81-i02', False), ('u81-i03', 'u81-i04', False), ('u81-i05', 'u81-i06', False),
         ('u82-i01', 'u82-i02', False), ('u82-i04', 'u82-i05', False),
         ('u83-i01', 'u87-i01', True), ('u87-i02', 'u87-i03', True), ('u87-i04', 'u87-i05', True),
         ('u88-i01', 'u88-i02', True), ('u88-i04', 'u88-i05', True)]
# diphthongs are long by nature: (card, starts with a consonant)
LONG_ONLY = [('u82-i03', False), ('u82-i06', False), ('u88-i03', True), ('u88-i06', True)]
# rows rebuilt from the cards: id -> [(card, pause after it in seconds)]
C, F = 0.30, 0.52
ROWS = {
    'u81-i12': [('u81-i01', C), ('u81-i02', F), ('u81-i03', C), ('u81-i04', F), ('u81-i05', C), ('u81-i06', 0)],
    'u82-i15': [('u82-i01', C), ('u82-i02', F), ('u82-i03', F), ('u82-i04', C), ('u82-i05', F), ('u82-i06', 0)],
    'u86-i12': [(f'u81-i0{n}', C) for n in range(1, 7)] + [(f'u82-i0{n}', C) for n in range(1, 6)] + [('u82-i06', 0)],
    'u87-i06': [('u83-i01', C), ('u87-i01', C), ('u87-i02', C), ('u87-i03', C), ('u87-i04', C), ('u87-i05', 0)],
}

def decode(path, tmp):
    wav = os.path.join(tmp, 'd.wav')
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEF32@{SR}', '-c', '1', path, wav], check=True, capture_output=True)
    a, _ = sf.read(wav, dtype='float32'); return a if a.ndim == 1 else a.mean(1)

def active(a, drop=25):
    """(start, end) in seconds of the part within `drop` dB of the peak."""
    h, w = int(SR * 0.005), int(SR * 0.02); n = max(1, (len(a) - w) // h)
    db = 20 * np.log10(np.array([np.sqrt(np.mean(a[i*h:i*h+w] ** 2)) for i in range(n)]) + 1e-9)
    on = np.where(db > db.max() - drop)[0]
    return on[0] * 0.005, (on[-1] + 1) * 0.005 + 0.015

def voice_of(a):
    """(pitch in Hz, how periodic 0..1) of the sounding part, by autocorrelation on 50 ms
    frames. Used only to CHECK the result: the pitch must not move and the voice must stay
    as smooth (periodic) as it was."""
    b, e = active(a); x = a[int(b * SR):int(e * SR)].astype(np.float64)
    n = int(0.05 * SR); f0s, strengths = [], []
    for i in range(0, max(1, len(x) - n), int(0.01 * SR)):
        fr = x[i:i + n] - np.mean(x[i:i + n])
        if len(fr) < n or np.sqrt(np.mean(fr ** 2)) < 0.01: continue
        ac = np.correlate(fr, fr, mode='full')[n - 1:]; ac = ac / (ac[0] + 1e-12)
        lo, hi = int(SR / 400), int(SR / 75); lag = lo + int(np.argmax(ac[lo:hi]))
        f0s.append(SR / lag); strengths.append(ac[lag])
    if not f0s: return 0.0, 0.0
    return float(np.median(f0s)), float(np.median(strengths))

def wsola(x, tmap, out_len, low_hz):
    """Re-time x. tmap(t_out_samples) -> t_in_samples (monotonic). Frames of a few pitch
    periods are placed every half frame; each is taken from where the input best continues
    the previous frame. The search reaches a full period of the lowest pitch this voice
    uses (low_hz), so a matching period is always in range and the pitch is kept."""
    tol = int(SR / low_hz); N = int(3.2 * tol) // 2 * 2; Hs = N // 2
    win = np.hanning(N + 1)[:N].astype(np.float64)
    pad = N + tol + 1
    xp = np.concatenate([np.zeros(pad), x.astype(np.float64), np.zeros(pad + N)])
    y = np.zeros(out_len + 2 * N); norm = np.zeros(out_len + 2 * N)
    prev = None; k = 0
    while k * Hs < out_len + Hs:
        ideal = int(round(tmap(k * Hs))) + pad - Hs  # frame centred on the mapped time
        if prev is None: start = ideal
        else:
            want = xp[prev + Hs: prev + Hs + N]  # what would follow naturally
            lo = max(0, ideal - tol); hi = min(len(xp) - N - 1, ideal + tol)
            if hi <= lo: start = max(0, min(ideal, len(xp) - N - 1))
            else:
                seg = xp[lo: hi + N]
                corr = np.correlate(seg, want, mode='valid')
                energy = np.sqrt(np.convolve(seg ** 2, np.ones(N), mode='valid')) + 1e-9
                start = lo + int(np.argmax(corr / energy))
        o = k * Hs
        y[o:o + N] += xp[start:start + N] * win; norm[o:o + N] += win
        prev = start; k += 1
    y = y / np.maximum(norm, 1e-3)
    return y[Hs:Hs + out_len].astype(np.float32)

def retime(a, target, consonant, low_hz):
    """Stretch/tighten the steady middle of the sounding part to last `target` seconds."""
    b, e = active(a); dur = e - b
    if abs(target - dur) < 0.012: return a, dur, dur, 1.0
    on = 0.055 if consonant else 0.025      # onset kept as recorded
    off = min(0.05, max(0.03, dur * 0.2))   # release kept as recorded
    mid = dur - on - off
    if mid < 0.03: on, off = dur * 0.3, dur * 0.25; mid = dur - on - off
    new_mid = target - on - off; factor = new_mid / mid
    m0, m1 = (b + on) * SR, (b + on + mid) * SR; n1 = m0 + new_mid * SR
    def tmap(t):
        if t <= m0: return t
        if t >= n1: return m1 + (t - n1)
        return m0 + (t - m0) / factor
    out_len = int(len(a) + (new_mid - mid) * SR)
    y = wsola(a, tmap, out_len, low_hz)
    return y, dur, active(y)[1] - active(y)[0], factor

def piece(a):
    b, e = active(a, drop=40); s = max(0, int((b - 0.015) * SR)); t = min(len(a), int((e + 0.03) * SR))
    p = a[s:t].copy(); fi, fo = int(0.006 * SR), int(0.03 * SR)
    p[:fi] *= np.linspace(0, 1, fi); p[-fo:] *= np.linspace(1, 0, fo); return p

def write(wave, path, tmp, tag):
    wav = os.path.join(tmp, f'{tag}.wav'); sf.write(wav, wave, SR, subtype='PCM_16')
    r = subprocess.run(['node', os.path.join(ROOT, 'tools/lib/polish-cli.mjs'), wav, path], capture_output=True, text=True)
    if r.returncode: raise RuntimeError('polish failed: ' + r.stderr[-200:])

report = {}
with tempfile.TemporaryDirectory() as tmp:
    for v in voices:
        live = os.path.join(ROOT, 'app/public/audio', f'v-{v}'); orig = os.path.join(ROOT, 'audio-src/length-orig', f'v-{v}')
        os.makedirs(orig, exist_ok=True)
        ids = sorted({i for s, l, _ in PAIRS for i in (s, l)} | {i for i, _ in LONG_ONLY} | set(ROWS))
        for i in ids:  # pristine copies, made once
            if not os.path.exists(os.path.join(orig, f'{i}.m4a')): shutil.copy2(os.path.join(live, f'{i}.m4a'), os.path.join(orig, f'{i}.m4a'))
        src = lambda i: decode(os.path.join(orig, f'{i}.m4a'), tmp)
        done = {}
        def emit(i, target, consonant, kind):
            a = src(i); y, was, now, factor = retime(a, target, consonant, 130 if v == 'female' else 85)
            (f_was, p_was), (f_now, p_now) = voice_of(a), voice_of(y)
            cents = 1200 * np.log2(f_now / f_was) if f_was and f_now else 0.0
            b, e = active(y, drop=40); body = y[max(0, int((b - 0.02) * SR)):int((e + 0.06) * SR)]
            out = np.concatenate([np.zeros(int(LEAD * SR), np.float32), body, np.zeros(int(TAIL * SR), np.float32)])
            done[i] = out
            report[f'{v}/{i}'] = {'kind': kind, 'was': round(was, 3), 'now': round(now, 3), 'stretch': round(factor, 2), 'f0_was': round(f_was, 1), 'f0_now': round(f_now, 1), 'pitch_shift_cents': round(float(cents)), 'smooth_was': round(p_was, 2), 'smooth_now': round(p_now, 2)}
            flag = '' if abs(cents) <= 60 and p_now >= p_was - 0.08 else '   <-- CHECK'
            print(f'[{v}] {i} {kind:5} {was:.2f}s -> {now:.2f}s (middle x{factor:.2f})  pitch {f_was:.0f} -> {f_now:.0f} Hz ({cents:+.0f} cents)  smooth {p_was:.2f} -> {p_now:.2f}{flag}')
            if not args.dry: write(out, os.path.join(live, f'{i}.m4a'), tmp, f'{v}-{i}')
            return now
        for s, l, cons in PAIRS:
            ds = active(src(s))[1] - active(src(s))[0]
            short_now = emit(s, min(ds, SHORT_MAX) if ds >= 0.15 else 0.16, cons, 'short')
            emit(l, max(LONG_MIN, RATIO * short_now), cons, 'long')
        for i, cons in LONG_ONLY:
            d = active(src(i))[1] - active(src(i))[0]
            emit(i, max(d, LONG_MIN), cons, 'long')
        for rid, parts in ROWS.items():
            chunks = [np.zeros(int(LEAD * SR), np.float32)]
            for cid, pause in parts:
                chunks += [piece(done[cid]), np.zeros(int(pause * SR), np.float32)]
            row = np.concatenate(chunks + [np.zeros(int(TAIL * SR), np.float32)])
            report[f'{v}/{rid}'] = {'kind': 'row', 'secs': round(len(row) / SR, 2), 'letters': len(parts)}
            print(f'[{v}] {rid} row of {len(parts)} letters, {len(row)/SR:.1f}s')
            if not args.dry: write(row, os.path.join(live, f'{rid}.m4a'), tmp, f'{v}-{rid}')
json.dump(report, open(os.path.join(ROOT, 'tools', 'voice-length-report.json'), 'w'), indent=1, ensure_ascii=False)
