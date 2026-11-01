import time, sys
import numpy as np
import soundfile as sf
from transformers import AutoModel

t0 = time.time()
model = AutoModel.from_pretrained("ai4bharat/IndicF5", trust_remote_code=True)
print(f"load: {time.time()-t0:.1f}s")

# reference prompt: a clean SYSPIN clip + its exact text (keeps a female Telugu voice seed)
ref_audio = "/Users/Arnav/Downloads/Claude Code test/app/public/audio/u01-i09.m4a"
# convert to wav for the pipeline
import subprocess
subprocess.run(["afconvert","-f","WAVE","-d","LEI16@24000",ref_audio,"/tmp/ref.wav"],check=True)
ref_text = "ఇంట్లో అందరూ బాగున్నారా?"

tests = [
    ("f5_1", "మీరు ఎలా ఉన్నారు?"),
    ("f5_2", "కూరగాయలు ఎంత? కొంచెం తగ్గించండి."),
    ("f5_3", "చాలా రోజుల తరువాత కలిశాము!"),
]
for name, text in tests:
    t0 = time.time()
    audio = model(text, ref_audio_path="/tmp/ref.wav", ref_text=ref_text)
    audio = np.asarray(audio, dtype=np.float32)
    if audio.max() > 1.5:  # int16 scale
        audio = audio / 32768.0
    sf.write(f"/tmp/{name}.wav", audio, 24000)
    print(f"{name}: {len(audio)/24000:.2f}s audio in {time.time()-t0:.1f}s")
print("F5_OK")
