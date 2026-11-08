# Artifact scan over the rendered clips (both voices). Flags, per clip:
#   tail-burst   a short isolated burst after the last real syllable (hallucinated extra syllable)
#   head-burst   the same before the first syllable (the old male stray syllable)
#   word-gap     a silent gap inside a single-word item (one word has no pauses)
#   too-long     speech far longer than the text needs (sec per syllable outlier)
#   pitch        voiced frames jumping octaves / out of the voice's range (wobble, glitch)
# Reports only; writes tools/voice-scan-report.json.
#
#   vendor/f5-venv/bin/python tools/voice-scan.py [--voice female|male] [--only u65] [--pitch]
import sys, os, json, argparse, subprocess, tempfile, re, warnings
warnings.filterwarnings('ignore')
import numpy as np, soundfile as sf
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--voice', default='both'); ap.add_argument('--only', default=None); ap.add_argument('--pitch', action='store_true'); ap.add_argument('--out', default=os.path.join(ROOT,'tools','voice-scan-report.json'))
args = ap.parse_args()
voices = ['female','male'] if args.voice=='both' else [args.voice]
if args.pitch: import librosa

# items + syllable counts (Telugu: one nucleus per independent vowel or consonant without virama)
items = {}
for f in sorted(os.listdir(os.path.join(ROOT,'app/content/units'))):
    if not f.endswith('.json'): continue
    u = json.load(open(os.path.join(ROOT,'app/content/units',f)))
    for it in u['items']: items[it['id']] = it.get('audioTe') or it['te']
def syllables(te):
    s = te; n = 0; chars = list(s)
    for i,ch in enumerate(chars):
        cp = ord(ch)
        if 0x0C05 <= cp <= 0x0C14: n += 1                     # independent vowel
        elif 0x0C15 <= cp <= 0x0C39 or cp in (0x0C3D,):       # consonant
            nxt = chars[i+1] if i+1 < len(chars) else ''
            if nxt != '్': n += 1                        # not killed by virama
    return max(n,1)

def decode(m4a, tmp):
    wav = os.path.join(tmp, 'c.wav')
    subprocess.run(['afconvert','-f','WAVE','-d','LEF32@24000','-c','1',m4a,wav],check=True,capture_output=True)
    a, sr = sf.read(wav, dtype='float32'); return (a if a.ndim==1 else a.mean(1)), sr

HOP = 0.005
def segments(a, sr):
    hop = int(sr*HOP); win = int(sr*0.02)
    n = max(1,(len(a)-win)//hop)
    rms = np.array([np.sqrt(np.mean(a[i*hop:i*hop+win]**2)) for i in range(n)])
    db = 20*np.log10(rms+1e-9); peak = db.max()
    on = db > peak - 32
    segs=[]; start=None
    for i,v in enumerate(on):
        if v and start is None: start=i
        if not v and start is not None: segs.append([start*HOP,i*HOP]); start=None
    if start is not None: segs.append([start*HOP,n*HOP])
    # merge gaps shorter than 50 ms (plosive closures etc.)
    merged=[]
    for s in segs:
        if merged and s[0]-merged[-1][1] < 0.05: merged[-1][1]=s[1]
        else: merged.append(s)
    return [s for s in merged if s[1]-s[0] >= 0.03], db

def pitch_flags(a, sr):
    f0, vf, _ = librosa.pyin(a, fmin=70, fmax=400, sr=sr, frame_length=1024)
    f = f0[vf & ~np.isnan(f0)]
    if len(f) < 10: return None
    jumps = np.abs(np.diff(np.log2(f))); octave = float(np.mean(jumps > 0.6))
    return {'f0_med': float(np.median(f)), 'f0_std_semi': float(np.std(12*np.log2(f/np.median(f)))), 'octave_jumps': octave}

report = {}
with tempfile.TemporaryDirectory() as tmp:
    for v in voices:
        d = os.path.join(ROOT,'app/public/audio',f'v-{v}'); spsy=[]
        rows = {}
        files = sorted(x for x in os.listdir(d) if x.endswith('.m4a') and (not args.only or x.startswith(args.only)))
        for k,fn in enumerate(files):
            cid = fn[:-4]; te = items.get(cid)
            if te is None: continue
            a, sr = decode(os.path.join(d,fn), tmp)
            segs, db = segments(a, sr)
            if not segs: rows[cid] = {'flags':['silent']}; continue
            speech = segs[-1][1]-segs[0][0]; voiced = sum(s[1]-s[0] for s in segs)
            syl = syllables(te); words = len(te.split())
            flags=[]; info={'te':te,'syl':syl,'words':words,'speech':round(speech,2),'segs':[[round(s[0],2),round(s[1],2)] for s in segs],'sec_per_syl':round(voiced/syl,3)}
            if len(segs) >= 2:
                gap_t = segs[-1][0]-segs[-2][1]; last = segs[-1][1]-segs[-1][0]
                if gap_t >= 0.10 and last <= 0.38 and (segs[-2][1]-segs[0][0]) >= 0.25: flags.append('tail-burst')
                gap_h = segs[1][0]-segs[0][1]; first = segs[0][1]-segs[0][0]
                if gap_h >= 0.10 and first <= 0.30: flags.append('head-burst')
                if words == 1 and any(segs[i+1][0]-segs[i][1] >= 0.09 for i in range(len(segs)-1)): flags.append('word-gap')
            if args.pitch:
                p = pitch_flags(a, sr)
                if p:
                    info.update(p)
                    if p['octave_jumps'] > 0.06: flags.append('pitch')
            info['flags']=flags; rows[cid]=info; spsy.append(voiced/syl)
            if (k+1)%100==0: print(f'  {v} {k+1}/{len(files)}', flush=True)
        # too-long: sec/syllable outliers (per voice)
        arr=np.array(spsy); med=np.median(arr); mad=np.median(np.abs(arr-med))*1.4826
        for cid,r in rows.items():
            if 'sec_per_syl' in r and r['sec_per_syl'] > med + 3.5*mad and r['syl']>=2: r['flags'].append('too-long')
        report[v] = {'sec_per_syl_median': round(float(med),3), 'clips': rows}
        n = len(rows); fl = {c:r for c,r in rows.items() if r.get('flags')}
        print(f'[{v}] {n} clips, {len(fl)} flagged', flush=True)
        from collections import Counter
        print('  ', dict(Counter(f for r in fl.values() for f in r['flags'])), flush=True)
json.dump(report, open(args.out,'w'), indent=1, ensure_ascii=False)
print('wrote', args.out)
