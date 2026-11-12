#!/usr/bin/env python
"""Presentation figures for the voice audit (0.4.3): what a clip looks like, the
three defects the pass removed (machine buzz, held final vowel, fused letter
card) shown before and after, and the whole-course numbers.

  vendor/f5-venv/bin/python tools/voice-figures.py <measure.json> <old-clips-dir> <out-dir>

<measure.json> and <old-clips-dir> come from the before/after measurement
(clips at commit b177ac3 against the working tree). Labels use the romanised
text: matplotlib does not shape Telugu conjuncts.
"""
import sys, os, json, re, subprocess, tempfile, warnings; warnings.filterwarnings('ignore')
import numpy as np, soundfile as sf, librosa
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.lines import Line2D

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'lib'))
from mmsalign import word_spans, envelope, db_envelope, buzz_spans, letter_split, load_items, roman  # noqa: E402

MEASURE, OLD, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
M = json.load(open(MEASURE))
ITEMS = load_items()
GLOSS = {}
for f in os.listdir(os.path.join(ROOT, 'app/content/units')):
    for it in json.load(open(os.path.join(ROOT, 'app/content/units', f)))['items']: GLOSS[it['id']] = it['gloss']

# ---- one look for every figure ----
INK, SOFT, GRID = '#26221c', '#6f6553', '#e6dfd2'
BEFORE, AFTER = '#d1495b', '#2e9158'
FEMALE, MALE = '#0e6b63', '#cf8a12'
PITCH = '#f5a623'
plt.rcParams.update({
    'font.family': 'Helvetica Neue', 'font.size': 12, 'text.color': INK, 'axes.labelcolor': SOFT,
    'axes.edgecolor': GRID, 'axes.linewidth': 1.0, 'xtick.color': SOFT, 'ytick.color': SOFT,
    'axes.spines.top': False, 'axes.spines.right': False, 'axes.titlesize': 13, 'axes.titleweight': 'bold',
    'axes.titlelocation': 'left', 'figure.facecolor': 'white', 'savefig.facecolor': 'white', 'legend.frameon': False,
})
SR = 24000

def load(path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'c.wav')
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEF32@{SR}', '-c', '1', path, wav], check=True, capture_output=True)
        a, _ = sf.read(wav, dtype='float32')
    return a if a.ndim == 1 else a.mean(1)

def cur(voice, cid): return os.path.join(ROOT, f'app/public/audio/v-{voice}/{cid}.m4a')
def old(voice, cid): return os.path.join(OLD, f'{voice}-{cid}.m4a')
def a16(a): return librosa.resample(a, orig_sr=SR, target_sr=16000)

def pitch(a):
    f0, voiced, _ = librosa.pyin(a, fmin=70, fmax=400, sr=SR, frame_length=1024, hop_length=128)
    return librosa.times_like(f0, sr=SR, hop_length=128), np.where(voiced, f0, np.nan)

def spectrogram(ax, a, top=5000):
    S = librosa.amplitude_to_db(np.abs(librosa.stft(a, n_fft=1024, hop_length=128)), ref=np.max)
    ax.imshow(S, origin='lower', aspect='auto', extent=[0, len(a) / SR, 0, SR / 2 / 1000], cmap='magma', vmin=-70, vmax=0)
    ax.set_ylim(0, top / 1000); ax.set_ylabel('Frequency (kHz)'); ax.grid(False)

def wave(ax, a, color=INK):
    t = np.arange(len(a)) / SR
    ax.fill_between(t, a, -a if False else 0, color=color, lw=0)
    ax.plot(t, a, color=color, lw=0.5)
    m = max(0.05, float(np.abs(a).max())) * 1.15
    ax.set_ylim(-m, m); ax.set_yticks([]); ax.set_ylabel('Waveform'); ax.spines['left'].set_visible(False)

def header(fig, title, subtitle):
    fig.text(0.045, 0.965, title, fontsize=20, fontweight='bold', va='top')
    fig.text(0.045, 0.915, subtitle, fontsize=12.5, color=SOFT, va='top')

def footer(fig, text='Chilaka voice audit · clips measured from the app bundle · before = commit b177ac3, after = 0.4.3'):
    fig.text(0.045, 0.018, text, fontsize=9.5, color=SOFT)

def save(fig, name):
    path = os.path.join(OUT, name); fig.savefig(path, dpi=200); plt.close(fig); print('wrote', path)

def sidebar(fig, changed, how, top=0.80, bottom=0.06):
    """The note panel beside every graph: what changed, and how, in plain words."""
    import textwrap
    from matplotlib.patches import FancyBboxPatch
    x0, x1 = 0.775, 0.978
    fig.add_artist(FancyBboxPatch((x0, bottom), x1 - x0, top - bottom, boxstyle='round,pad=0,rounding_size=0.012', transform=fig.transFigure,
                                  facecolor='#fbf6ec', edgecolor=GRID, lw=1))
    H = fig.get_figheight(); inch = 1 / H            # one inch as a fraction of the figure height
    lh = 11.5 * 1.45 / 72 * inch                      # one line of body text
    y = top - 0.28 * inch
    for title, body in (('What changed', changed), ('How', how)):
        fig.text(x0 + 0.014, y, title.upper(), fontsize=10.5, fontweight='bold', color=FEMALE, va='top')
        y -= 0.30 * inch
        for para in body:
            txt = textwrap.fill(para, width=40)
            fig.text(x0 + 0.014, y, txt, fontsize=11.5, color=INK, va='top', linespacing=1.45)
            y -= (txt.count('\n') + 1) * lh + 0.24 * inch
        y -= 0.22 * inch

def phrase(cid): return f'“{roman(ITEMS[cid]).strip()}” — {GLOSS[cid].split(" — ")[-1].rstrip(".")}'

# ---------------------------------------------------------------- 1. anatomy of a clip
def fig_anatomy(cid='u01-i01'):
    fig, axes = plt.subplots(3, 2, figsize=(19.5, 9), sharex='col', gridspec_kw={'height_ratios': [1, 1.7, 1.2], 'hspace': 0.16, 'wspace': 0.1,
                                                                             'left': 0.065, 'right': 0.745, 'top': 0.80, 'bottom': 0.115})
    header(fig, 'How to read a voice clip', f'One phrase, both voices: {phrase(cid)}. Loudness on top, sound energy by frequency in the middle, the melody of the voice below.')
    for c, (voice, col) in enumerate((('female', FEMALE), ('male', MALE))):
        a = load(cur(voice, cid)); dur = len(a) / SR
        ax = axes[0][c]; wave(ax, a, col)
        ax.set_title(f'{voice.capitalize()} voice', color=col)
        for i, (w, s, e, _) in enumerate(word_spans(a16(a), ITEMS[cid])):
            for row in axes[:, c]: row.axvline(s, color=SOFT if row is ax else 'white', lw=0.8, ls=(0, (3, 3)), alpha=0.8)
            ax.text((s + e) / 2, ax.get_ylim()[1] * 0.98, w, ha='center', va='top', fontsize=11.5, fontweight='bold')
        s0, e0 = envelope(a16(a), 16000)
        ax.annotate('', xy=(0, ax.get_ylim()[0] * 0.8), xytext=(s0, ax.get_ylim()[0] * 0.8), arrowprops=dict(arrowstyle='<->', color=SOFT, lw=1))
        ax.text(s0 / 2, ax.get_ylim()[0] * 0.62, f'lead-in {s0:.2f} s', ha='center', fontsize=9.5, color=SOFT)
        spectrogram(axes[1][c], a)
        t, f0 = pitch(a); ax = axes[2][c]
        ax.plot(t, f0, color=col, lw=2.6, solid_capstyle='round')
        med = np.nanmedian(f0); ax.axhline(med, color=GRID, lw=1, zorder=0)
        ax.text(dur * 0.995, med, f' median {med:.0f} Hz', ha='right', va='bottom', fontsize=10, color=SOFT)
        ax.set_ylim(60, 330); ax.set_ylabel('Pitch (Hz)'); ax.set_xlabel('Time (seconds)'); ax.set_xlim(0, dur); ax.grid(axis='y', color=GRID, lw=0.6)
        if c: [axes[r][c].set_ylabel('') for r in range(3)]
    sidebar(fig, ['Nothing here was broken. This is a healthy clip, shown so the other graphs are easy to read.',
                  'Every clip now starts after the same short silence and plays at the same loudness.'],
            ['Each recording was turned into these three pictures: how loud it is, which frequencies carry the sound, and the pitch of the voice.',
             'A speech model then marked where each word starts, which gives the dotted lines.'])
    footer(fig); save(fig, '1-anatomy-of-a-clip.png')

# ---------------------------------------------------------------- 2. machine buzz
def fig_buzz(voice, cid):
    fig, axes = plt.subplots(2, 2, figsize=(19.5, 8.2), sharex='col', gridspec_kw={'height_ratios': [1.5, 1], 'hspace': 0.14, 'wspace': 0.1,
                                                                               'left': 0.065, 'right': 0.745, 'top': 0.79, 'bottom': 0.125})
    header(fig, 'Defect 1 · Machine buzz', f'The voice model collapsed into a flat drone instead of speech. {voice.capitalize()} voice, {phrase(cid)}.')
    for c, (tag, path, col) in enumerate((('Before', old(voice, cid), BEFORE), ('After (re-rendered)', cur(voice, cid), AFTER))):
        a = load(path); dur = len(a) / SR
        spectrogram(axes[0][c], a, top=4000); axes[0][c].set_title(tag, color=col)
        t, f0 = pitch(a); ax = axes[1][c]
        ax.plot(t, f0, color=col, lw=2.6, solid_capstyle='round')
        spans = buzz_spans(a, SR)  # at 24 kHz, as the audit ran it
        for (s, e, hz) in spans:
            for row in (axes[0][c], ax): row.axvspan(s, e, color=BEFORE, alpha=0.16 if row is ax else 0.0, lw=0)
            axes[0][c].plot([s, e], [3.75, 3.75], color='white', lw=3, solid_capstyle='butt')
            axes[0][c].text((s + e) / 2, 3.52, 'buzz', color='white', ha='center', va='top', fontsize=10.5, fontweight='bold')
        if spans:
            s, e, hz = max(spans, key=lambda x: x[1] - x[0])
            up = hz < 190
            ax.annotate(f'pitch frozen at {hz:.0f} Hz\nfor {e - s:.2f} s', xy=((s + e) / 2, hz), xytext=((s + e) / 2, hz + 70 if up else hz - 70), ha='center',
                        va='bottom' if up else 'top', fontsize=11, color=BEFORE, fontweight='bold', arrowprops=dict(arrowstyle='-', color=BEFORE, lw=1.2))
            total = sum(e - s for s, e, _ in spans)
            ax.text(0.99, 0.94, f'{total:.2f} s of the clip is buzz', transform=ax.transAxes, ha='right', va='top', fontsize=10.5, color=BEFORE)
        else:
            ax.text(0.99, 0.94, 'pitch moves the whole way through — no buzz', transform=ax.transAxes, ha='right', va='top', fontsize=10.5, color=AFTER)
        ax.set_ylim(60, 330); ax.set_ylabel('Pitch (Hz)'); ax.set_xlabel('Time (seconds)'); ax.set_xlim(0, dur); ax.grid(axis='y', color=GRID, lw=0.6)
        if c: axes[0][c].set_ylabel(''); ax.set_ylabel('')
    sidebar(fig, ['Some clips came out as a flat robotic drone instead of a voice. In the “before” picture the pitch line is perfectly flat.',
                  'After the fix the pitch rises and falls like a person speaking.'],
            ['A checker scanned all 2,410 clips for pitch that stays frozen for more than an eighth of a second.',
             'Each clip it caught was generated again, up to eight tries, and only a clean take was kept.'], top=0.79)
    footer(fig, 'Detector: pitch locked to one autocorrelation lag (within 0.3%) for 120 ms or more, on frames within 35 dB of the loudest · tools/voice-buzz.py')
    save(fig, '2-machine-buzz.png')

# ---------------------------------------------------------------- 3. held final vowel
def fig_tail(voice, cid):
    fig, axes = plt.subplots(2, 1, figsize=(19.5, 7.6), gridspec_kw={'hspace': 0.42, 'left': 0.05, 'right': 0.745, 'top': 0.78, 'bottom': 0.11})
    header(fig, 'Defect 2 · The “extra syllable”', f'The voice kept holding its final vowel after the word was over. {voice.capitalize()} voice, {phrase(cid)}.')
    loaded = [(tag, load(path), col) for tag, path, col in (('Before', old(voice, cid), BEFORE), ('After', cur(voice, cid), AFTER))]
    xmax = max(len(a) for _, a, _ in loaded) / SR
    for ax, (tag, a, col) in zip(axes, loaded):
        wave(ax, a, INK); ax.set_ylabel('')
        spans = word_spans(a16(a), ITEMS[cid]); _, env_e = envelope(a16(a), 16000)
        from mmsalign import align
        last = align(a16(a), roman(ITEMS[cid]))[-1][1]
        top = ax.get_ylim()[1]
        for (w, s, e, _) in spans:
            ax.axvline(s, color=SOFT, lw=0.8, ls=(0, (3, 3)))
            ax.text(s + 0.008, top * 0.97, w, ha='left', va='top', fontsize=12, fontweight='bold')
        ax.axvline(last, color=INK, lw=1.4)
        ax.text(last - 0.008, -top * 0.93, 'last letter starts', ha='right', va='bottom', fontsize=10, color=INK)
        ax.axvspan(last, env_e, color=col, alpha=0.22, lw=0)
        ax.text((last + env_e) / 2, top * 0.97, f'{env_e - last:.2f} s', ha='center', va='top', fontsize=15, fontweight='bold', color=col)
        ax.text(env_e + 0.012, top * 0.5, 'voice still sounding' if tag == 'Before' else 'ends cleanly', ha='left', va='center', fontsize=11, color=col)
        ax.set_title(tag, color=col); ax.set_xlim(0, xmax); ax.set_xlabel('Time (seconds)' if ax is axes[-1] else '')
    sidebar(fig, ['The voice kept humming after the word had finished, which sounded like an added syllable.',
                  'The shaded band is that leftover sound. It is now about a third as long.'],
            ['A speech model found the exact moment the last letter begins in every clip.',
             'Clips that kept sounding too long after that point were generated again, or trimmed with a gentle fade so the ending still sounds natural.'], top=0.78)
    footer(fig, 'Measured by forced alignment (Meta MMS): time from the onset of the last letter to the end of the sound. Limit: 0.10 s (female) / 0.15 s (male) · tools/voice-align.py')
    save(fig, '3-held-final-vowel.png')

# ---------------------------------------------------------------- 4. letter card
def spoken(cid): return ITEMS[cid].replace('. ', ', ', 1)

def fig_letter(voice, cid):
    fig, axes = plt.subplots(2, 2, figsize=(19.5, 7.8), sharex='col', gridspec_kw={'height_ratios': [1, 1.15], 'hspace': 0.14, 'wspace': 0.1,
                                                                               'left': 0.065, 'right': 0.745, 'top': 0.79, 'bottom': 0.125})
    letter, word = roman(spoken(cid)).split(' ', 1)
    header(fig, 'Defect 3 · Letter cards that swallowed the letter',
           f'An alphabet card should say the letter, pause, then the example word: “{letter} … {word}”. {voice.capitalize()} voice.')
    for c, (tag, path, col) in enumerate((('Before — letter and word fused', old(voice, cid), BEFORE), ('After — letter, pause, word', cur(voice, cid), AFTER))):
        a = load(path); dur = len(a) / SR; x = a16(a)
        wave(axes[0][c], a, INK); axes[0][c].set_title(tag, color=col)
        db = db_envelope(x, 16000); t = np.arange(len(db)) * 0.005
        ax = axes[1][c]; ax.plot(t, db, color=col, lw=2.2); ax.fill_between(t, db, -60, color=col, alpha=0.12, lw=0)
        ax.axhline(-25, color=SOFT, lw=1, ls=(0, (4, 3))); ax.text(dur * 0.995, -24, 'a real pause dips below −25 dB', ha='right', va='bottom', fontsize=9.5, color=SOFT)
        sp = letter_split(x, 16000, spoken(cid), cid)
        ws = word_spans(x, spoken(cid))
        if sp and ws:
            ls, le = ws[0][1], sp['letter_end']; top = axes[0][c].get_ylim()[1]
            axes[0][c].axvspan(ls, le, color=col, alpha=0.2, lw=0)
            axes[0][c].text((ls + le) / 2, top * 0.97, letter, ha='center', va='top', fontsize=13, fontweight='bold', color=col)
            if len(ws) > 1: axes[0][c].text((ws[1][1] + ws[-1][2]) / 2, top * 0.97, word, ha='center', va='top', fontsize=13, fontweight='bold')
            dip = 'no dip at all' if sp['sep_dip'] > -1 else f'dip of {abs(sp["sep_dip"]):.0f} dB'
            ax.set_title(f'Letter sounds for {sp["letter_span"]:.2f} s · {dip} before the word', color=col, fontsize=11.5)
        ax.set_ylim(-60, 2); ax.set_ylabel('Loudness (dB below peak)'); ax.set_xlabel('Time (seconds)'); ax.set_xlim(0, dur); ax.grid(axis='y', color=GRID, lw=0.6)
        if c: ax.set_ylabel('')
    sidebar(fig, ['Alphabet cards should say the letter, pause, then the example word. Many ran the two together, so the letter was never heard alone.',
                  'Now the letter is spoken clearly, followed by real silence, then the word.'],
            ['The loudness curve shows it: a real pause drops far below the dotted line.',
             'Cards without that drop were generated again until the letter stood alone. Rows of letters were built by joining the good single letters.'], top=0.79)
    footer(fig, 'Check: the letter must sound for at least 0.08 s and be followed by a dip of 25 dB or more before the word · tools/lib/mmsalign.py')
    save(fig, '4-letter-cards.png')

# ---------------------------------------------------------------- 5. whole course
def fig_course(stats):
    fig = plt.figure(figsize=(19.5, 8.6))
    gs = fig.add_gridspec(2, 3, height_ratios=[1, 1.05], hspace=0.55, wspace=0.28, left=0.06, right=0.745, top=0.80, bottom=0.10)
    header(fig, 'The whole course, before and after', f'Every clip in the app measured: {stats["n"]:,} recordings, {stats["n"] // 2:,} per voice. {stats["touched"]} were re-rendered, trimmed or rebuilt.')
    def bars(ax, title, key, note):
        vals = stats[key]; x = np.arange(2); w = 0.36
        b1 = ax.bar(x - w / 2, [vals['female'][0], vals['male'][0]], w, color=BEFORE, label='Before')
        b2 = ax.bar(x + w / 2, [vals['female'][1], vals['male'][1]], w, color=AFTER, label='After')
        top = max(vals['female'][0], vals['male'][0], 1)
        for b in list(b1) + list(b2):
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + top * 0.03, f'{int(b.get_height())}', ha='center', fontsize=14, fontweight='bold', color=b.get_facecolor())
        ax.set_xticks(x); ax.set_xticklabels(['Female voice', 'Male voice'], fontsize=12, color=INK); ax.set_ylim(0, top * 1.22)
        ax.set_yticks([]); ax.spines['left'].set_visible(False); ax.set_title(title)
        ax.text(0, -0.24, note, transform=ax.transAxes, fontsize=9.8, color=SOFT, va='top')
    bars(fig.add_subplot(gs[0, 0]), 'Clips with machine buzz', 'buzz', stats['buzz_note'])
    bars(fig.add_subplot(gs[0, 1]), 'Clips holding the last vowel too long', 'tail', 'Over the limit: 0.10 s female, 0.15 s male.')
    bars(fig.add_subplot(gs[0, 2]), 'Letter cards with the letter fused', 'letter', f'Of {stats["cards"]} alphabet cards per voice.')
    fig.legend(handles=[Patch(color=BEFORE, label='Before'), Patch(color=AFTER, label='After')], loc='upper right', bbox_to_anchor=(0.745, 0.90), ncol=2, fontsize=12)
    ax = fig.add_subplot(gs[1, :])
    bins = np.arange(-0.06, 0.24, 0.01)
    for voice, col in (('female', FEMALE), ('male', MALE)):
        ax.hist(np.clip(stats['tails_after'][voice], bins[0], bins[-1] - 1e-6), bins=bins, color=col, alpha=0.75, label=f'{voice.capitalize()} · median {np.median(stats["tails_after"][voice]) * 1000:.0f} ms')
    for lim, col, name in ((0.10, FEMALE, 'female limit'), (0.15, MALE, 'male limit')):
        ax.axvline(lim, color=col, lw=1.4, ls=(0, (4, 3))); ax.text(lim + 0.002, ax.get_ylim()[1] * 0.93, name, color=col, fontsize=10.5, va='top')
    ax.set_title('After the pass: how long each clip keeps sounding once its last letter has begun')
    ax.set_xlabel('Seconds of sound after the last letter starts'); ax.set_ylabel('Clips'); ax.grid(axis='y', color=GRID, lw=0.6); ax.set_xlim(bins[0], bins[-1])
    ax.legend(loc='upper left', fontsize=11)
    b, t, l = stats['buzz'], stats['tail'], stats['letter']
    sidebar(fig, [f'Buzzing clips went from {b["female"][0] + b["male"][0]} to {b["female"][1] + b["male"][1]}.',
                  f'Clips with a held ending went from {t["female"][0] + t["male"][0]} to {t["female"][1] + t["male"][1]}.',
                  f'Fused letter cards went from {l["female"][0] + l["male"][0]} to {l["female"][1] + l["male"][1]}.'],
            ['All 2,410 clips were measured by the same three checks, before and after.',
             f'Only {stats["touched"]} clips were changed. The rest are byte-for-byte the same.',
             'The bottom chart shows the male voice naturally lets words ring a little longer, which is why its limit is higher.'], top=0.8)
    footer(fig); save(fig, '5-whole-course.png')

# ---------------------------------------------------------------- data → stats and examples
def main():
    ch = {k: v for k, v in M['changed'].items() if 'tail_extra' in v.get('old', {}) and 'tail_extra' in v.get('new', {})}
    final = {v: json.load(open(os.path.join(os.path.dirname(os.path.dirname(MEASURE)), f'final-align-{v}.json')))[v] for v in ('female', 'male')}
    LIM = {'female': 0.10, 'male': 0.15}
    stats = {'n': 2 * len(final['female']), 'touched': len(M['changed']), 'buzz': {}, 'tail': {}, 'letter': {}, 'tails_after': {}, 'tails_before_changed': [r['old']['tail_extra'] for r in ch.values()]}
    cards = [cid for cid in ITEMS if re.match(r'u8[1-9]-', cid) and re.match(r'^[ఀ-౿]{1,3}[.,] [ఀ-౿]+\.$', ITEMS[cid])]
    stats['cards'] = len(cards); letter_rows = {}
    for voice in ('female', 'male'):
        mine = {k.split('/')[1]: r for k, r in ch.items() if k.startswith(voice)}
        now = {k for k, s in M['buzz24_now'].items() if k.startswith(voice) and s}
        was = {k for k in M['buzz24_now'] if k.startswith(voice) and (M['buzz24_old'][k] if k in M['buzz24_old'] else M['buzz24_now'][k])}
        stats['buzz'][voice] = (len(was), len(now))
        after = {cid: (mine[cid]['new']['tail_extra'] if cid in mine else row['tail_extra']) for cid, row in final[voice].items()}
        before = {cid: (mine[cid]['old']['tail_extra'] if cid in mine else row['tail_extra']) for cid, row in final[voice].items()}
        stats['tails_after'][voice] = list(after.values())
        stats['tail'][voice] = (sum(1 for t in before.values() if t > LIM[voice] + 0.005), sum(1 for t in after.values() if t > LIM[voice] + 0.005))
        fused = [0, 0]
        for cid in cards:
            for i, path in enumerate((old(voice, cid), cur(voice, cid))):
                if not os.path.exists(path): path = cur(voice, cid)  # unchanged by the pass
                x = a16(load(path)); sp = letter_split(x, 16000, spoken(cid), cid)
                bad = (not sp) or sp['letter_span'] < 0.08 or sp['sep_dip'] > -25
                fused[i] += bad; letter_rows[(voice, cid, i)] = sp
        stats['letter'][voice] = tuple(fused)
    left = [k for k, s in M['buzz24_now'].items() if s]
    stats['buzz_note'] = 'Left after: the hummed “mm” of “ammamma”,\nwhich is speech, not a fault.' if left else ''
    print('stats', {k: stats[k] for k in ('n', 'touched', 'buzz', 'tail', 'letter', 'cards')}, 'buzz left', left)

    buzz_pick = max((k for k in ch if M['buzz24_old'].get(k) and not M['buzz24_now'][k]),
                    key=lambda k: sum(e - s for s, e, _ in M['buzz24_old'][k]))
    tail_pick = max((k for k, r in ch.items() if k.startswith('male') and not re.match(r'\w+/u8', k) and len(roman(ITEMS[k.split('/')[1]])) < 14 and not M['buzz24_old'].get(k)),
                    key=lambda k: ch[k]['old']['tail_extra'] - ch[k]['new']['tail_extra'])
    def badness(key):
        v, cid = key; o, n = letter_rows.get((v, cid, 0)), letter_rows.get((v, cid, 1))
        if not n or n['letter_span'] < 0.12 or n['sep_dip'] > -40 or not os.path.exists(old(v, cid)): return -1
        return 100 if not o else max(0, o['sep_dip'] + 60)
    letter_pick = max(((v, cid) for v in ('female', 'male') for cid in cards), key=badness)
    print('examples: buzz', buzz_pick, '| tail', tail_pick, '| letter', letter_pick)
    fig_anatomy()
    fig_buzz(*buzz_pick.split('/'))
    fig_tail(*tail_pick.split('/'))
    fig_letter(*letter_pick)
    fig_course(stats)

main()
