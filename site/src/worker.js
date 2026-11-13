// Chilaka website: serves the static pages and records one line per page visit.
// Stored per visit: time, page, country / region / city and network name (from Cloudflare's edge), device and
// browser family, referrer, and a per-day visitor id derived from a one-way hash of IP + browser
// so repeat views by the same person are grouped without keeping their IP. Bots are skipped.
// Entries expire after 180 days. Read them with `node tools/visitors.mjs`.

const DAYS = 180;

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/download/mac') {
      if (request.method === 'GET') ctx.waitUntil(record(request, env).catch(() => {}));
      return Response.redirect(await macDownloadUrl(), 302);
    }
    const response = await env.ASSETS.fetch(request);
    // Record after the page is sent, so logging never slows a visitor down.
    if (request.method === 'GET' && response.ok) ctx.waitUntil(record(request, env).catch(() => {}));
    return response;
  },
};

// /download/mac always hands out the newest Mac app. GitHub's "latest" link
// redirects to the newest release tag (v1.2.3); the file in it is named
// Chilaka-1.2.3-arm64.dmg. If anything is off, send people to the release page.
const RELEASES = 'https://github.com/EaglesSBLII/chilaka/releases';
let latest = { url: '', at: 0 };
export async function macDownloadUrl(fetcher = fetch, now = Date.now()) {
  if (latest.url && now - latest.at < 10 * 60_000) return latest.url;
  try {
    const res = await fetcher(`${RELEASES}/latest`, { redirect: 'manual', headers: { 'user-agent': 'chilaka-site' } });
    const tag = /\/releases\/tag\/v(\d+\.\d+\.\d+)$/.exec(res.headers.get('location') || '');
    if (!tag) return `${RELEASES}/latest`;
    const url = `${RELEASES}/download/v${tag[1]}/Chilaka-${tag[1]}-arm64.dmg`;
    const head = await fetcher(url, { method: 'HEAD', redirect: 'manual' });
    if (head.status >= 400) return `${RELEASES}/latest`;
    latest = { url, at: now };
    return url;
  } catch {
    return `${RELEASES}/latest`;
  }
}

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
  // the entry rides along as key metadata too, so the owner dashboard can read a whole page of visits in one list call
  await env.VISITS.put(key, JSON.stringify(entry), { expirationTtl: DAYS * 86400, metadata: entry });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
