# Voice-cloning audition with AI4Bharat IndicF5: take a short reference of a real
# Telugu speaker (plus its transcript), speak a handful of lesson phrases in that
# voice, and write WAVs for listening + recognizer QA. Nothing in the app changes;
# this only produces samples.
#
#   vendor/f5-venv/bin/python tools/clone-voice-test.py <ref.wav> "<ref transcript>" <outdir> [phrase...]
#
# Needs: Hugging Face login with access to the gated ai4bharat/IndicF5 repo.

import sys, os, json, time
import numpy as np
import soundfile as sf
import torch
from transformers import AutoModel

ref_audio, ref_text, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
phrases = sys.argv[4:] or [
    "మీరు ఎలా ఉన్నారు?",
    "నేను బాగున్నాను. మీరు?",
    "రండి రండి! ఎన్నాళ్ళకు చూశాను మిమ్మల్ని!",
    "భోజనం చేశావా? ఆకలిగా ఉందా?",
    "ఇది వంద రూపాయలు. ఇంకేమైనా కావాలా?",
    "రేపు సాయంత్రం కలుద్దామా?",
]
os.makedirs(outdir, exist_ok=True)

device = "mps" if torch.backends.mps.is_available() else "cpu"
t0 = time.time()
model = AutoModel.from_pretrained("ai4bharat/IndicF5", trust_remote_code=True)
try:
    model = model.to(device)
except Exception:
    device = "cpu"
print(f"model loaded in {time.time()-t0:.0f}s on {device}", flush=True)

report = []
for i, text in enumerate(phrases, 1):
    t1 = time.time()
    audio = model(text, ref_audio_path=ref_audio, ref_text=ref_text)
    audio = np.asarray(audio)
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    path = os.path.join(outdir, f"clone-{i:02d}.wav")
    sf.write(path, audio, samplerate=24000)
    secs = len(audio) / 24000
    print(f"  {i}. {secs:.1f}s in {time.time()-t1:.1f}s  {text}", flush=True)
    report.append({"i": i, "text": text, "wav": path, "secs": round(secs, 2)})
json.dump(report, open(os.path.join(outdir, "report.json"), "w"), ensure_ascii=False, indent=1)
print("done", flush=True)
