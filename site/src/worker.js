// Chilaka website: serves the static pages and records one line per page visit.
// Stored per visit: time, page, country / region / city and network name (from Cloudflare's edge), device and
// browser family, referrer, and a per-day visitor id derived from a one-way hash of IP + browser
// so repeat views by the same person are grouped without keeping their IP. Bots are skipped.
// Entries expire after 180 days. Read them with `node tools/visitors.mjs`.

const DAYS = 180;

export default {
  async fetch(request, env, ctx) {
    const response = await env.ASSETS.fetch(request);
    // Record after the page is sent, so logging never slows a visitor down.
    if (request.method === 'GET' && response.ok) ctx.waitUntil(record(request, env).catch(() => {}));
    return response;
  },
};

async function record(request, env) {
  const ua = request.headers.get('user-agent') || '';
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python-requests|headless/i.test(ua)) return;
  const url = new URL(request.url);
  const cf = request.cf || {};
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const visitor = (await sha256(`${day}|${ip}|${ua}`)).slice(0, 12);   // same person, same day → same id
  const entry = {
    ts: now.toISOString(),
    site: 'web',
    page: url.pathname,
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
  await env.VISITS.put(key, JSON.stringify(entry), { expirationTtl: DAYS * 86400 });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
