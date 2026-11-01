// Chilaka sync server — a Cloudflare Worker + KV.
// One route: /<key> where key is a 48-64 hex-char secret only your devices
// know. GET returns {rev, updatedAt, data}; PUT {rev, data} succeeds only when
// rev === currentRev + 1 (optimistic concurrency; clients merge and retry on
// 409). Free tier is far beyond one learner's needs.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const MAX_BYTES = 4 * 1024 * 1024; // plenty for years of progress JSON
const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~60s of 16k mono WAV

// ---- lightweight in-memory rate limiting (no KV writes burned) ----
// Per-isolate sliding windows: resets when the isolate recycles, which is
// fine — the goal is stopping hammering/abuse, not accounting.
const windows = new Map();
function limited(bucket, max, windowMs) {
  const now = Date.now();
  let w = windows.get(bucket);
  if (!w || now - w.start > windowMs) {
    w = { start: now, n: 0 };
    windows.set(bucket, w);
  }
  w.n += 1;
  if (windows.size > 5000) windows.clear(); // memory guard
  return w.n > max;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    // ---- /asr/<key>: phone speech scoring via Workers AI Whisper ----
    if (url.pathname.startsWith('/asr/')) {
      const asrKey = url.pathname.slice(5);
      if (!/^[a-f0-9]{48,64}$/.test(asrKey)) {
        return new Response(JSON.stringify({ error: 'bad key' }), { status: 400, headers: CORS });
      }
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers: CORS });
      }
      // the key must belong to a real sync slot (stops strangers using your AI quota)
      const slot = await env.SYNC.get(`sync:${asrKey}`);
      if (!slot) {
        return new Response(JSON.stringify({ error: 'unpaired key' }), { status: 403, headers: CORS });
      }
      // abuse brakes: a real learner sends a few clips a minute at most
      if (
        limited(`asr:${asrKey}`, 30, 10 * 60_000) ||
        limited(`asrday:${asrKey}`, 250, 24 * 60 * 60_000) ||
        limited('asr:global', 300, 10 * 60_000)
      ) {
        return new Response(JSON.stringify({ error: 'rate limited — try again in a few minutes' }), {
          status: 429,
          headers: CORS,
        });
      }
      const audio = await request.arrayBuffer();
      if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
        return new Response(JSON.stringify({ error: 'bad audio size' }), { status: 413, headers: CORS });
      }
      try {
        // base64 the WAV for whisper-large-v3-turbo
        const bytes = new Uint8Array(audio);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
          audio: btoa(bin),
          language: 'te',
        });
        const text = String(result?.text ?? '').trim();
        return new Response(JSON.stringify({ text }), {
          headers: { ...CORS, 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: `asr failed: ${err.message ?? err}` }), {
          status: 502,
          headers: CORS,
        });
      }
    }

    const key = url.pathname.replace(/^\/+/, '');
    if (!/^[a-f0-9]{48,64}$/.test(key)) {
      return new Response(JSON.stringify({ error: 'bad key' }), { status: 400, headers: CORS });
    }
    const kvKey = `sync:${key}`;

    if (request.method === 'GET') {
      const stored = await env.SYNC.get(kvKey);
      if (!stored) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS });
      return new Response(stored, { headers: { ...CORS, 'content-type': 'application/json' } });
    }

    if (request.method === 'PUT') {
      let body;
      try {
        const text = await request.text();
        if (text.length > MAX_BYTES) {
          return new Response(JSON.stringify({ error: 'too large' }), { status: 413, headers: CORS });
        }
        body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: CORS });
      }
      if (typeof body?.rev !== 'number' || !body?.data) {
        return new Response(JSON.stringify({ error: 'need {rev, data}' }), { status: 400, headers: CORS });
      }
      const current = await env.SYNC.get(kvKey, 'json');
      const currentRev = current?.rev ?? 0;
      if (body.rev !== currentRev + 1) {
        return new Response(JSON.stringify({ conflict: true, rev: currentRev }), { status: 409, headers: CORS });
      }
      // brakes: new-slot creation per IP, and per-slot write pace (protects
      // the KV free tier's 1k writes/day from hammering or runaway clients)
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      if (currentRev === 0 && limited(`newslot:${ip}`, 4, 60 * 60_000)) {
        return new Response(JSON.stringify({ error: 'too many new devices from this network — try later' }), {
          status: 429,
          headers: CORS,
        });
      }
      if (limited(`put:${key}`, 20, 60 * 60_000)) {
        return new Response(JSON.stringify({ error: 'rate limited — try again in a few minutes' }), {
          status: 429,
          headers: CORS,
        });
      }
      await env.SYNC.put(kvKey, JSON.stringify({ rev: body.rev, updatedAt: Date.now(), data: body.data }));
      return new Response(JSON.stringify({ rev: body.rev }), { headers: { ...CORS, 'content-type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers: CORS });
  },
};
