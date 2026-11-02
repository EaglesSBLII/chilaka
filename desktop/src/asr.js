// Manages a local whisper-server (whisper.cpp) so the ~500MB Telugu model
// loads once and every utterance transcribes in ~1s on Metal.
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** Ask the OS for a free localhost port so multiple app instances never clash. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Decoding settings shared by the app and the QA tools. */
const DECODE = { promptChars: 1500 };

class AsrServer {
  constructor({ binDir, modelPath }) {
    this.binDir = binDir;
    this.modelPath = modelPath;
    this.proc = null;
    this.ready = false;
    this.starting = null;
    this.port = null;
  }

  available() {
    return fs.existsSync(this.modelPath) && fs.existsSync(path.join(this.binDir, 'whisper-server'));
  }

  async warmUp() {
    if (!this.available()) return false;
    await this.ensureRunning();
    return this.ready;
  }

  ensureRunning() {
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const port = await freePort();
      this.port = port;
      await new Promise((resolve, reject) => {
        const bin = path.join(this.binDir, 'whisper-server');
        this.proc = spawn(
          bin,
          [
            '-m', this.modelPath,
            '--host', '127.0.0.1',
            '--port', String(port),
            '-l', 'te',
            '--no-timestamps',
            '-t', String(Math.max(2, os.cpus().length - 2)),
          ],
          { stdio: ['ignore', 'pipe', 'pipe'], cwd: this.binDir },
        );
        this.proc.on('error', (err) => {
          this.starting = null;
          reject(err);
        });
        this.proc.on('exit', () => {
          this.ready = false;
          this.proc = null;
          this.starting = null;
        });
        // poll until the HTTP endpoint answers (model load takes ~5-10s)
        const t0 = Date.now();
        const poll = async () => {
          if (!this.proc) return reject(new Error('speech engine failed to start'));
          try {
            await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' });
            this.ready = true;
            resolve();
          } catch {
            if (Date.now() - t0 > 60_000) {
              reject(new Error('speech engine took too long to start'));
            } else {
              setTimeout(poll, 500);
            }
          }
        };
        setTimeout(poll, 1500);
      });
    })();
    return this.starting;
  }

  /**
   * @param {Buffer} wavBuffer 16 kHz mono 16-bit WAV
   * @param {string} [prompt] lesson context (neighbouring phrases) to bias decoding
   */
  async transcribe(wavBuffer, prompt = '') {
    if (!this.available()) throw new Error('speech model not installed');
    await this.ensureRunning();
    const form = new FormData();
    form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'take.wav');
    form.append('response_format', 'json');
    form.append('language', 'te');
    form.append('temperature', '0.0');
    // Greedy decoding on purpose: on this fine-tuned Telugu model beam search
    // measurably HURT (80.7% vs 92.0% clean on the reference clips, Nov 2026).
    // The lesson-context prompt is what helps: 92.0% → 95.3% clean.
    if (prompt) form.append('prompt', prompt.slice(0, DECODE.promptChars));
    const res = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`speech engine error (${res.status})`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return String(data.text ?? '').trim();
  }

  stop() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
      this.ready = false;
    }
  }
}

module.exports = { AsrServer, DECODE };
