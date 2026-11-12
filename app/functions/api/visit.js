// chilaka.pages.dev: records one line per app open, like site/src/worker.js does for the website.
// The app is a PWA, so after the first visit the page itself comes from the phone's cache and the
// server never sees it; instead the app sends a tiny beacon to POST /api/visit each time it starts
// (app/src/main.tsx). Stored: time, country / region / city and network name (from Cloudflare's edge), device and
// browser family, whether it runs installed on the Home Screen or in a browser tab, and a per-day
// visitor id from a one-way hash of IP + browser (no IP kept). Bots are skipped. Entries expire
// after 180 days and share the website's KV namespace, so `node tools/visitors.mjs` shows both.

const DAYS = 180;

export async function onRequestPost({ request, env }) {
  try { await record(request, env); } catch { /* never let logging break the app */ }
  return new Response(null, { status: 204 });
}

async function record(request, env) {
  const ua = request.headers.get('user-agent') || '';
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python-requests|headless/i.test(ua)) return;
  let body = {};
  try { body = await request.json(); } catch { /* beacon without a body */ }
  const cf = request.cf || {};
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const visitor = (await sha256(`${day}|${ip}|${ua}`)).slice(0, 12);   // same person, same day → same id
  const entry = {
    ts: now.toISOString(),
    site: 'app',
    page: '/app',
    mode: body.standalone ? 'installed' : 'browser',
    country: cf.country || '',
    region: cf.region || '',
    city: cf.city || '',
    tz: cf.timezone || '',
    // network the visit came through ("Verizon", "DigitalOcean", …): tells a home or office
    // connection from a data centre without keeping the address
    network: String(cf.asOrganization || '').slice(0, 80),
    asn: cf.asn || 0,
    device: /iPhone|iPad|Android/i.test(ua) ? 'phone' : /Macintosh/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'other',
    browser: /Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'chrome' : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? 'safari' : /Firefox\//.test(ua) ? 'firefox' : /Edg\//.test(ua) ? 'edge' : 'other',
    referrer: (request.headers.get('referer') || '').replace(/^https?:\/\//, '').split('/')[0].slice(0, 80),
    visitor,
  };
  const key = `v:${now.toISOString()}:${visitor}`;
  // the entry rides along as key metadata too, so the owner dashboard can read a whole page of visits in one list call
  await env.VISITS.put(key, JSON.stringify(entry), { expirationTtl: DAYS * 86400, metadata: entry });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
