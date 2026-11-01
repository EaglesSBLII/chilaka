# Batch TTS worker: AI4Bharat vits_rasa_13 — Telugu Female (speaker 19),
# conversational style (CONV=4). Expressive studio voice, 24kHz.
# Reads a JSON manifest {jobs: [{id, text, seed}]}, writes <out>/<id>.wav.
# Sentences are generated separately and joined with a short pause; a longer
# trailing pad guards against VITS end-clipping.
#
#   python rasa-render.py manifest.json outdir

import sys, os, json, re, struct, math
import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

SPEAKER_ID = 19  # TEL_F
STYLE_ID = 4     # CONV — conversational
SR = 24000
TAIL_PAD = np.zeros(int(SR * 0.18), dtype=np.float32)

# Teacher-pace prosody ("T4" profile, Aug 2026 A/B round 2). Modeled on
# learner-directed speech research: ~15-20% below native conversational rate,
# steady intonation (teachers slow down, they don't add pitch drama), longer
# breath pauses. Won the lab on clarity too: 0.995 mean ASR fold-similarity
# (vs 0.970 for the faster/liver profiles) with ~5.2 syl/sec — the pace of a
# careful native speaker.
NOISE_SCALE = 0.70           # near-default prosody variation — calm, not flat
NOISE_SCALE_DURATION = 0.85  # slight rhythm life (default 0.8)
BASE_RATE = 0.75             # ~19% slower than native-speed synthesis
RATE_JITTER = 0.015          # barely-there tempo drift between sentences

model = AutoModel.from_pretrained("ai4bharat/vits_rasa_13", trust_remote_code=True)
tok = AutoTokenizer.from_pretrained("ai4bharat/vits_rasa_13", trust_remote_code=True)
model.eval()

def write_wav(path, samples):
    s16 = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(s16) * 2) + b'WAVEfmt ' +
                struct.pack('<IHHIIHH', 16, 1, 1, SR, SR * 2, 2, 16) +
                b'data' + struct.pack('<I', len(s16) * 2))
        s16.tofile(f)

def sentences(text):
    parts = re.split(r'(?<=[.?!])\s+', text.strip())
    return [p.strip() for p in parts if re.search(r'[ఀ-౿]', p)]

def det_jitter(seed, idx, amount):
    # deterministic pseudo-random in [-amount, amount] (reproducible per seed)
    v = math.sin(seed * 12.9898 + idx * 78.233) * 43758.5453
    return ((v - math.floor(v)) * 2 - 1) * amount

def gap_secs(prev_sentence, seed, idx):
    # teaching pace: real breath pauses; questions hang a touch longer
    base = 0.36 if prev_sentence.endswith('?') else 0.30
    return max(0.2, base + det_jitter(seed, idx + 100, 0.03))

def synth(text, seed, style=STYLE_ID):
    torch.manual_seed(seed)
    chunks = []
    sents = sentences(text)
    for i, sent in enumerate(sents):
        model.noise_scale = NOISE_SCALE
        model.noise_scale_duration = NOISE_SCALE_DURATION
        model.speaking_rate = BASE_RATE * (1 + det_jitter(seed, i, RATE_JITTER))
        inputs = tok(text=sent, return_tensors="pt")
        with torch.no_grad():
            out = model(inputs['input_ids'], speaker_id=SPEAKER_ID, emotion_id=style)
        chunks.append(out.waveform.squeeze().numpy().astype(np.float32))
        if i < len(sents) - 1:
            chunks.append(np.zeros(int(SR * gap_secs(sent, seed, i)), dtype=np.float32))
    if not chunks:
        return np.zeros(100, dtype=np.float32)
    return np.concatenate(chunks + [TAIL_PAD])

manifest_path, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
jobs = json.load(open(manifest_path))['jobs']
for i, job in enumerate(jobs):
    wav = synth(job['text'], job.get('seed', 1234), job.get('style', STYLE_ID))
    write_wav(os.path.join(outdir, job['id'] + '.wav'), wav)
    if (i + 1) % 25 == 0:
        print(f"  tts {i+1}/{len(jobs)}", flush=True)
print(f"tts done: {len(jobs)}", flush=True)
