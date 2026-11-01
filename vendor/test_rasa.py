import time, sys
import numpy as np
import soundfile as sf
from transformers import AutoModel, AutoTokenizer

t0 = time.time()
model = AutoModel.from_pretrained("ai4bharat/vits_rasa_13", trust_remote_code=True)
tok = AutoTokenizer.from_pretrained("ai4bharat/vits_rasa_13", trust_remote_code=True)
print(f"load: {time.time()-t0:.1f}s, sr={model.config.sampling_rate}")

tests = [
    ("rasa_conv_1", "మీరు ఎలా ఉన్నారు?", 4),
    ("rasa_conv_2", "నేను బాగున్నాను. మీరు ఎలా ఉన్నారు?", 4),
    ("rasa_conv_3", "కూరగాయలు ఎంత? కొంచెం తగ్గించండి.", 4),
    ("rasa_conv_4", "ఇంట్లో అందరూ బాగున్నారా?", 4),
    ("rasa_happy_1", "చాలా రోజుల తరువాత కలిశాము!", 8),
    ("rasa_book_1", "అ. అమ్మ.", 3),
]
for name, text, style in tests:
    t0 = time.time()
    inputs = tok(text=text, return_tensors="pt")
    out = model(inputs['input_ids'], speaker_id=19, emotion_id=style)
    wav = out.waveform.squeeze().detach().numpy()
    sf.write(f"/tmp/{name}.wav", wav, model.config.sampling_rate)
    print(f"{name}: {len(wav)/model.config.sampling_rate:.2f}s audio in {time.time()-t0:.2f}s")
print("RASA_OK")
