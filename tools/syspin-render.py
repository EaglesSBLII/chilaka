# Batch TTS worker: SYSPIN Telugu Female (Coqui-VITS TorchScript).
# Reads a JSON manifest {jobs: [{id, text, seed}]}, writes <out>/<id>.wav @22050.
# Sentences are generated separately and joined with a short pause (the model
# truncates multi-sentence inputs).
#
#   python syspin-render.py manifest.json outdir

import sys, os, json, re, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../vendor/syspin'))
from extra import TTSTokenizer, VitsConfig, CharactersConfig, VitsCharacters
import torch
import numpy as np

SYSPIN_DIR = os.path.join(os.path.dirname(__file__), '../vendor/syspin')
SR = 22050
GAP = np.zeros(int(SR * 0.28), dtype=np.float32)

with open(os.path.join(SYSPIN_DIR, 'chars.txt')) as f:
    letters = f.read().strip('\n')

config = VitsConfig(
    text_cleaner="multilingual_cleaners",
    characters=CharactersConfig(
        characters_class=VitsCharacters, pad="<PAD>", eos="<EOS>", bos="<BOS>",
        blank="<BLNK>", characters=letters, punctuations="!¡'(),-.:;¿? ", phonemes=None))
tokenizer, config = TTSTokenizer.init_from_config(config)

net = torch.jit.load(os.path.join(SYSPIN_DIR, 'te_female_vits_30hrs.pt'))
net.eval()

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

def synth(text, seed):
    torch.manual_seed(seed)
    chunks = []
    for sent in sentences(text):
        x = torch.from_numpy(np.array(tokenizer.text_to_ids(sent))).unsqueeze(0)
        with torch.no_grad():
            out = net(x)
        chunks.append(out.squeeze().cpu().numpy().astype(np.float32))
        chunks.append(GAP)
    if not chunks:
        return np.zeros(100, dtype=np.float32)
    return np.concatenate(chunks[:-1])  # drop trailing gap

manifest_path, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
jobs = json.load(open(manifest_path))['jobs']
for i, job in enumerate(jobs):
    wav = synth(job['text'], job.get('seed', 1234))
    write_wav(os.path.join(outdir, job['id'] + '.wav'), wav)
    if (i + 1) % 25 == 0:
        print(f"  tts {i+1}/{len(jobs)}", flush=True)
print(f"tts done: {len(jobs)}", flush=True)
