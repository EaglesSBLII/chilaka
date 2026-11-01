// Live Telugu TTS via sherpa-onnx (lazy-loaded; pre-rendered audio covers the
// curriculum, this handles arbitrary text like future features/toasts).
const path = require('node:path');
const fs = require('node:fs');

class LiveTts {
  constructor({ modelDir }) {
    this.modelDir = modelDir;
    this.tts = null;
  }

  ensure() {
    if (this.tts) return this.tts;
    const modelFile = path.join(this.modelDir, 'model.onnx');
    if (!fs.existsSync(modelFile)) return null;
    // require lazily — native module load costs ~100ms and isn't always needed
    const sherpa = require('sherpa-onnx-node');
    this.tts = new sherpa.OfflineTts({
      model: {
        vits: { model: modelFile, tokens: path.join(this.modelDir, 'tokens.txt') },
        numThreads: 2,
        debug: 0,
        provider: 'cpu',
      },
      maxNumSentences: 2,
    });
    this.sherpa = sherpa;
    return this.tts;
  }

  /** Returns WAV bytes (ArrayBuffer) or null. */
  async synthesizeWav(text) {
    const tts = this.ensure();
    if (!tts) return null;
    const clean = String(text).replace(/[.,!?'"‘’“”\-–:;()]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    // Electron's Node disallows N-API external buffers — force a copy.
    const audio = tts.generate({ text: clean, sid: 0, speed: 0.88, enableExternalBuffer: false });
    if (!audio.samples || audio.samples.length === 0) return null;
    return encodeWav(audio.samples, audio.sampleRate);
  }
}

function encodeWav(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

module.exports = { LiveTts };
