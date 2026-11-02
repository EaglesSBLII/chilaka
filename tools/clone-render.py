# Batch renderer for the cloned native voices (AI4Bharat IndicF5, zero-shot from a
# short reference of a real Telugu speaker). Reads a JSON manifest
# {jobs: [{id, text, seed}]} and writes <out>/<id>.wav at 24 kHz.
#
#   vendor/f5-venv/bin/python tools/clone-render.py manifest.json outdir --ref voice-ref/female.wav --ref-text "…" [--nfe 32] [--speed 0.92]
#
# The reference is preprocessed once (the stock model wrapper redoes it per call);
# generation itself is the same infer_process the wrapper uses.

import sys, os, json, argparse, time
import numpy as np
import soundfile as sf
import torch
from transformers import AutoModel
from f5_tts.infer.utils_infer import preprocess_ref_audio_text, infer_process

ap = argparse.ArgumentParser()
ap.add_argument('manifest'); ap.add_argument('outdir')
ap.add_argument('--ref', required=True); ap.add_argument('--ref-text', required=True)
ap.add_argument('--nfe', type=int, default=32)        # diffusion steps: 32 = model default
ap.add_argument('--speed', type=float, default=1.0)   # <1 slows the delivery (teacher pace)
ap.add_argument('--cfg', type=float, default=2.0)
args = ap.parse_args()
os.makedirs(args.outdir, exist_ok=True)

device = 'mps' if torch.backends.mps.is_available() else 'cpu'
t0 = time.time()
model = AutoModel.from_pretrained('ai4bharat/IndicF5', trust_remote_code=True)
model.ema_model.to(device); model.vocoder.to(device)
ref_audio, ref_text = preprocess_ref_audio_text(args.ref, args.ref_text, show_info=lambda *a, **k: None)
print(f'model ready in {time.time()-t0:.0f}s on {device}; nfe={args.nfe} speed={args.speed}', flush=True)

jobs = json.load(open(args.manifest))['jobs']
for i, job in enumerate(jobs):
    torch.manual_seed(int(job.get('seed', 1234)))
    audio, sr, _ = infer_process(
        ref_audio, ref_text, job['text'], model.ema_model, model.vocoder,
        mel_spec_type='vocos', show_info=lambda *a, **k: None, progress=None,
        nfe_step=args.nfe, cfg_strength=args.cfg, speed=args.speed, device=device,
    )
    audio = np.asarray(audio, dtype=np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * (0.7 / peak)  # headroom; the polish pass sets the final level
    sf.write(os.path.join(args.outdir, job['id'] + '.wav'), audio, sr)
    if (i + 1) % 10 == 0 or i + 1 == len(jobs):
        print(f'  clone {i+1}/{len(jobs)}', flush=True)
print(f'clone done: {len(jobs)}', flush=True)
