# Shared alignment helpers for the voice QA tools (voice-align.py, voice-stitch.py,
# voice-trim.py): Meta's MMS forced aligner (torchaudio MMS_FA) over a romanized
# form of the Telugu text, plus the envelope / buzz measurements the gate uses.
import os, re, json, subprocess, warnings
warnings.filterwarnings('ignore')
import numpy as np, soundfile as sf, torch, torchaudio
import torchaudio.functional as F

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# --- Telugu → aligner alphabet (a-z only), mirror of the app's romanizer with retroflex marks dropped
V = {'అ':'a','ఆ':'aa','ఇ':'i','ఈ':'ii','ఉ':'u','ఊ':'uu','ఋ':'ru','ఎ':'e','ఏ':'ee','ఐ':'ai','ఒ':'o','ఓ':'oo','ఔ':'au'}
C = {'క':'k','ఖ':'kh','గ':'g','ఘ':'gh','ఙ':'ng','చ':'ch','ఛ':'chh','జ':'j','ఝ':'jh','ఞ':'ny','ట':'t','ఠ':'th','డ':'d','ఢ':'dh','ణ':'n','త':'t','థ':'th','ద':'d','ధ':'dh','న':'n','ప':'p','ఫ':'ph','బ':'b','భ':'bh','మ':'m','య':'y','ర':'r','ల':'l','వ':'v','శ':'sh','ష':'sh','స':'s','హ':'h','ళ':'l','ఱ':'r'}
MA = {'ా':'aa','ి':'i','ీ':'ii','ు':'u','ూ':'uu','ృ':'ru','ె':'e','ే':'ee','ై':'ai','ొ':'o','ో':'oo','ౌ':'au'}
LAB = {'ప','ఫ','బ','భ','మ'}
def roman(t):
    c = list(t); o = ''; i = 0
    while i < len(c):
        x = c[i]
        if x in C:
            o += C[x]; n = c[i+1] if i+1 < len(c) else ''
            if n == '్': i += 1
            elif n in MA: o += MA[n]; i += 1
            else: o += 'a'
        elif x in V: o += V[x]
        elif x == 'ం': n = c[i+1] if i+1 < len(c) else ''; o += 'm' if (n not in C or n in LAB) else 'n'
        elif x == 'ః': o += 'h'
        elif x.isspace(): o += ' '
        elif re.match(r'[a-zA-Z]', x): o += x.lower()
        i += 1
    return re.sub(r'\s+', ' ', o).strip()

def load_items():
    """id → spoken text (audioTe when the card says more than it shows, else te)."""
    items = {}
    d = os.path.join(ROOT, 'app/content/units')
    for f in sorted(os.listdir(d)):
        if f.endswith('.json'):
            u = json.load(open(os.path.join(d, f)))
            for it in u['items']: items[it['id']] = it.get('audioTe') or it['te']
    return items

bundle = torchaudio.pipelines.MMS_FA
model = bundle.get_model(with_star=False).eval()
labels = bundle.get_labels(star=None); dic = {c:i for i,c in enumerate(labels)}
device = 'cpu'  # MPS lacks some ops used by the aligner; CPU is ~0.3 s/clip

def envelope(a, sr, hop=0.005, win=0.02):
    h = int(sr*hop); w = int(sr*win); n = max(1,(len(a)-w)//h)
    rms = np.array([np.sqrt(np.mean(a[i*h:i*h+w]**2)) for i in range(n)])
    db = 20*np.log10(rms+1e-9); on = np.where(db > db.max()-32)[0]
    return on[0]*hop, (on[-1]+1)*hop

def align(a16, text):
    """[(token, start_s, end_s, score)] for every a-z character of `text` (spaces skipped)."""
    tokens = [dic[c] for c in text.replace(' ', '') if c in dic]
    with torch.inference_mode():
        em, _ = model(torch.from_numpy(a16)[None].to(device))
        em = torch.log_softmax(em, dim=-1)
    targets = torch.tensor([tokens], dtype=torch.int32)
    path, scores = F.forced_align(em, targets, blank=0)
    spans = F.merge_tokens(path[0], scores[0].exp())
    ratio = a16.shape[0] / em.shape[1] / 16000
    return [(s.token, s.start*ratio, s.end*ratio, float(s.score)) for s in spans]

def word_spans(a16, text):
    """Alignment grouped by the words of the romanized text: [(word, start_s, end_s, mean_score)]."""
    words = roman(text).split(' ')
    spans = align(a16, ' '.join(words)); out = []; k = 0
    for w in words:
        n = len([c for c in w if c in dic])
        if n == 0: continue
        seg = spans[k:k+n]; k += n
        out.append((w, seg[0][1], seg[-1][2], float(np.mean([s[3] for s in seg]))))
    return out

def f0_track(a, sr, win=0.03, hop=0.01):
    w = int(sr*win); h = int(sr*hop); lo, hi = int(sr/400), int(sr/70); out = []
    for i in range(0, max(1, len(a)-w), h):
        x = a[i:i+w]; x = x - x.mean(); e = np.dot(x, x)
        if e < 1e-6: out.append((0.0, 0.0)); continue
        ac = np.correlate(x, x, 'full')[w-1:]; seg = ac[lo:hi] / (e + 1e-9); k = int(np.argmax(seg))
        out.append((sr/(lo+k), float(seg[k])))
    return np.array(out)

def buzz_spans(a, sr):
    """Stretches where the model collapsed into a machine buzz: pitch frozen to the same
    autocorrelation lag (within 0.3 %) for 120 ms or more (tools/voice-buzz.py)."""
    tr = f0_track(a, sr); n = len(tr); spans = []; i = 0
    # only frames carrying voice count: room tone in a pause is 'periodic' at ~90 Hz too (within 35 dB of the peak frame)
    w = int(sr*0.03); h = int(sr*0.01)
    rms = np.array([np.sqrt(np.mean(a[k*h:k*h+w]**2)) for k in range(n)]); loud = rms > rms.max() * 10**(-35/20)
    while i < n:
        j = i
        while j < n and loud[j] and tr[j,1] > 0.3 and tr[j,0] > 0 and abs(tr[j,0]-tr[i,0])/tr[i,0] < 0.003: j += 1
        if (j-i)*0.01 >= 0.12: spans.append((round(i*0.01,2), round(j*0.01,2), round(float(tr[i,0]),1)))
        i = max(j, i+1)
    return spans

# a letter card says its letter on its own: at least this long, then a pause this deep before the word
MIN_SPAN = 0.08; MAX_DIP = -25.0
LETTER_CARD = re.compile(r'^([\u0c00-\u0c7f]{1,3}), ([\u0c00-\u0c7f]+)\.$')

def db_envelope(a, sr, hop=0.005, win=0.02):
    """Frame loudness in dB relative to the clip's peak frame."""
    h = int(sr*hop); w = int(sr*win)
    rms = np.array([np.sqrt(np.mean(a[i*h:i*h+w]**2)) for i in range(max(1,(len(a)-w)//h))])
    return 20*np.log10(rms+1e-9) - 20*np.log10(rms.max()+1e-9)

def letter_split(a, sr, te):
    """For a letter card ("అ, అమ్మ."): where the spoken letter ends and how deep the pause
    before the word is. The aligner pins a lone vowel to a couple of frames, so the end is
    the energy dip: the first frame 35 dB under the peak between letter and word, else the
    quietest one. Returns {'letter_end', 'letter_span', 'sep_dip'} or None (not a letter card)."""
    if not LETTER_CARD.match(te): return None
    ws = word_spans(a, te)
    if len(ws) < 2: return {'letter_end': 0.0, 'letter_span': 0.0, 'sep_dip': 0.0}
    ls = ws[0][1]; wst = ws[1][1]; hop = 0.005
    db = db_envelope(a, sr, hop)
    lo = int((ls+0.06)/hop); hi = max(lo+1, int(wst/hop)); reg = db[lo:hi]
    quiet = np.where(reg < -35)[0]
    k = int(quiet[0]) if len(quiet) else int(np.argmin(reg))
    le = (lo + k) * hop
    return {'letter_end': round(le,3), 'letter_span': round(le-ls,3), 'sep_dip': round(float(reg.min()),1)}

def measure(a, sr, te):
    txt = roman(te)
    spans = align(a, txt)
    env_s, env_e = envelope(a, sr)
    first_s = spans[0][1]; last_s = spans[-1][1]
    out = {'buzz': buzz_spans(a, sr),'te':te,'roman':txt,'env':[round(env_s,3),round(env_e,3)],'first_char':round(first_s,3),'last_char':round(last_s,3),
            'head_extra':round(first_s-env_s,3),'tail_extra':round(env_e-last_s,3),'conf':round(float(np.mean([s[3] for s in spans])),3),
            'min_conf':round(float(min(s[3] for s in spans)),3)}
    sep = letter_split(a, sr, te)
    if sep: out.update(sep)
    return out

def load16(path, tmp):
    """Decode any clip (m4a/wav) to mono float32 at the aligner's 16 kHz."""
    wav = os.path.join(tmp,'c.wav')
    subprocess.run(['afconvert','-f','WAVE','-d','LEF32@16000','-c','1',path,wav],check=True,capture_output=True)
    a, sr = sf.read(wav, dtype='float32'); return (a if a.ndim==1 else a.mean(1)), sr

def load24(path, tmp):
    """Decode to the render sample rate (24 kHz) for editing."""
    wav = os.path.join(tmp,'c24.wav')
    subprocess.run(['afconvert','-f','WAVE','-d','LEF32@24000','-c','1',path,wav],check=True,capture_output=True)
    a, sr = sf.read(wav, dtype='float32'); return (a if a.ndim==1 else a.mean(1)), sr
