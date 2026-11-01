// M0 spike: synthesize Telugu speech with sherpa-onnx + MMS Telugu VITS.
const sherpa = require('sherpa-onnx-node');

const tts = new sherpa.OfflineTts({
  model: {
    vits: {
      model: './vits-mms-tel/model.onnx',
      tokens: './vits-mms-tel/tokens.txt',
    },
    numThreads: 2,
    debug: 1,
    provider: 'cpu',
  },
  maxNumSentences: 1,
});

const tests = [
  ['test-1.wav', 'మీరు ఎలా ఉన్నారు? నేను బాగున్నాను.'],
  ['test-2.wav', 'కూరగాయలు ఎంత? కొంచెం తగ్గించండి.'],
  ['test-3.wav', 'నాకు తెలుగు నేర్చుకోవాలని ఉంది.'],
];

for (const [file, text] of tests) {
  const t0 = Date.now();
  const audio = tts.generate({ text, sid: 0, speed: 0.9 });
  sherpa.writeWave(file, { samples: audio.samples, sampleRate: audio.sampleRate });
  console.log(`${file}: ${audio.samples.length} samples @ ${audio.sampleRate}Hz, ${((audio.samples.length / audio.sampleRate)).toFixed(2)}s, generated in ${Date.now() - t0}ms`);
}
console.log('TTS SPIKE OK');
