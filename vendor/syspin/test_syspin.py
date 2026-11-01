import sys, struct, time
sys.path.insert(0, '.')
from extra import TTSTokenizer, VitsConfig, CharactersConfig, VitsCharacters
import torch, numpy as np

with open("chars.txt") as f:
    letters = f.read().strip('\n')

config = VitsConfig(text_cleaner="multilingual_cleaners",
    characters=CharactersConfig(characters_class=VitsCharacters, pad="<PAD>", eos="<EOS>", bos="<BOS>",
        blank="<BLNK>", characters=letters, punctuations="!¡'(),-.:;¿? ", phonemes=None))
tokenizer, config = TTSTokenizer.init_from_config(config)

def write_wav(path, samples, sr=22050):
    s16 = np.clip(samples, -1, 1)
    s16 = (s16 * 32767).astype('<i2')
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(s16)*2) + b'WAVEfmt ' +
                struct.pack('<IHHIIHH', 16, 1, 1, sr, sr*2, 2, 16) +
                b'data' + struct.pack('<I', len(s16)*2))
        s16.tofile(f)

for voice in ['female', 'male']:
    net = torch.jit.load(f"te_{voice}_vits_30hrs.pt")
    net.eval()
    for i, text in enumerate(["మీరు ఎలా ఉన్నారు?", "నేను బాగున్నాను.", "కూరగాయలు ఎంత? కొంచెం తగ్గించండి."]):
        x = torch.from_numpy(np.array(tokenizer.text_to_ids(text))).unsqueeze(0)
        t0 = time.time()
        with torch.no_grad():
            out = net(x)
        wav = out.squeeze().cpu().numpy()
        write_wav(f"/tmp/sys_{voice}_{i}.wav", wav)
        print(f"{voice} {i}: {len(wav)/22050:.2f}s gen={time.time()-t0:.2f}s")
print("OK")
