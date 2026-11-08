# Finds clips (or stretches inside clips) where the voice model collapsed into a
# machine buzz: a perfectly periodic tone with no pitch movement and a flat
# harmonic comb up to the top of the band. Real speech, even cloned, never holds
# its pitch within 0.3 % for 120 ms. Writes tools/voice-buzz-report.json.
#   vendor/f5-venv/bin/python tools/voice-buzz.py [--voice female|male]
import os, sys, json, argparse, subprocess, tempfile, warnings; warnings.filterwarnings('ignore')
import numpy as np, soundfile as sf
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--voice', default='both'); ap.add_argument('--out', default=os.path.join(ROOT,'tools','voice-buzz-report.json')); ap.add_argument('--files', nargs='*')
args = ap.parse_args()

def f0_track(a, sr, win=0.03, hop=0.01):
    w = int(sr*win); h = int(sr*hop); lo, hi = int(sr/400), int(sr/70)
    out = []
    for i in range(0, max(1, len(a)-w), h):
        x = a[i:i+w]; x = x - x.mean()
        e = np.dot(x, x)
        if e < 1e-6: out.append((0.0, 0.0)); continue
        ac = np.correlate(x, x, 'full')[w-1:]
        seg = ac[lo:hi] / (e + 1e-9)
        k = int(np.argmax(seg)); out.append((sr/(lo+k), float(seg[k])))
    return np.array(out)

def buzz_spans(a, sr):
    tr = f0_track(a, sr); n = len(tr); spans = []; i = 0
    # only frames carrying voice count: room tone in a pause is 'periodic' at ~90 Hz too (within 35 dB of the peak frame)
    w = int(sr*0.03); h = int(sr*0.01)
    rms = np.array([np.sqrt(np.mean(a[k*h:k*h+w]**2)) for k in range(n)]); loud = rms > rms.max() * 10**(-35/20)
    while i < n:
        j = i
        # run of frames: periodic and pitch frozen (within 0.3 %, i.e. the same autocorrelation lag)
        while j < n and loud[j] and tr[j,1] > 0.3 and tr[j,0] > 0 and abs(tr[j,0]-tr[i,0])/tr[i,0] < 0.003: j += 1
        if (j-i)*0.01 >= 0.12: spans.append((round(i*0.01,2), round(j*0.01,2), round(float(tr[i,0]),1)))
        i = max(j, i+1)
    return spans

def check(path, tmp):
    wav = os.path.join(tmp,'c.wav')
    subprocess.run(['afconvert','-f','WAVE','-d','LEF32@24000','-c','1',path,wav],check=True,capture_output=True)
    a, sr = sf.read(wav, dtype='float32'); a = a if a.ndim==1 else a.mean(1)
    return buzz_spans(a, sr)

report = {}
with tempfile.TemporaryDirectory() as tmp:
    if args.files:
        for f in args.files: print(f, check(f, tmp))
        sys.exit(0)
    for v in (['female','male'] if args.voice=='both' else [args.voice]):
        d = os.path.join(ROOT,'app/public/audio',f'v-{v}'); rows = {}
        for fn in sorted(x for x in os.listdir(d) if x.endswith('.m4a')):
            s = check(os.path.join(d,fn), tmp)
            if s: rows[fn[:-4]] = s
        report[v] = rows
        print(f'[{v}] {len(rows)} clips with buzz: {" ".join(sorted(rows))}', flush=True)
json.dump(report, open(args.out,'w'), indent=1)
print('wrote', args.out)
