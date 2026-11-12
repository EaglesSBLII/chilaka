// Reads the visit log written by the website (site/src/worker.js) and the app
// (app/functions/api/visit.js). Keys are "v:<ISO time>:<visitor id>", so they
// sort by time and the day counts need no values at all.

const PAGE = 40; // values fetched per request stay well under the subrequest cap

// Hosting / cloud networks: a visit through one of these is almost never a person.
const DATACENTRE =
  /amazon|aws|google cloud|google llc|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|cloudflare|oracle|alibaba|tencent|m247|datacamp|contabo|vultr|choopa|leaseweb|scaleway|hostinger|hosting|server|datacenter|data center|colo|vps|cdn77|fastly|zscaler|censys|shodan|internet archive|facebook|meta platforms|apple inc|bytedance|huawei cloud|ionos|netcup|gcore|packet|equinix/i;

/** Best guess that a visit was a program, not a person. */
export function isLikelyAutomated(v) {
  if (v.network && DATACENTRE.test(v.network)) return true;
  // no recognisable device or browser: a script or fetcher
  return (v.device === 'other' || !v.device) && (v.browser === 'other' || !v.browser);
}

async function listKeys(kv, prefix) {
  const keys = [];
  let cursor;
  for (let page = 0; page < 5; page++) {
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...res.keys);
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  return keys;
}

async function entryOf(kv, key) {
  // newer visits carry the whole entry as key metadata; older ones need a read
  let v = key.metadata && key.metadata.ts ? key.metadata : null;
  if (!v) {
    try {
      v = JSON.parse((await kv.get(key.name)) || 'null');
    } catch {
      v = null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  return {
    key: key.name,
    ts: String(v.ts || key.name.slice(2, 26)),
    site: v.site === 'app' ? 'app' : 'website',
    page: String(v.page || ''),
    mode: String(v.mode || ''),
    city: String(v.city || ''),
    region: String(v.region || ''),
    country: String(v.country || ''),
    device: String(v.device || ''),
    browser: String(v.browser || ''),
    referrer: String(v.referrer || ''),
    network: String(v.network || ''),
    visitor: String(v.visitor || ''),
    automated: isLikelyAutomated(v),
  };
}

const dayOf = (key) => key.slice(2, 12);

/**
 * `after`  = newest key the page already has → only visits newer than it (the live poll).
 * `before` = oldest key the page has → the next older page.
 * neither  = the newest page, plus visits-per-day for the last 14 days.
 */
export async function readVisits(kv, { after = '', before = '', now = Date.now() } = {}) {
  const valid = (k) => /^v:\d{4}-\d{2}-\d{2}T[\d:.]+Z:[0-9a-f]+$/.test(k);
  if (after && valid(after)) {
    const today = new Date(now).toISOString().slice(0, 10);
    const days = [];
    for (let t = Date.parse(`${dayOf(after)}T00:00:00Z`); days.length < 4 && !Number.isNaN(t); t += 86400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      days.push(d);
      if (d >= today) break;
    }
    const keys = (await Promise.all(days.map((d) => listKeys(kv, `v:${d}`)))).flat();
    const fresh = keys.filter((k) => k.name > after).sort((a, b) => (a.name < b.name ? 1 : -1)).slice(0, PAGE);
    const visits = (await Promise.all(fresh.map((k) => entryOf(kv, k)))).filter(Boolean);
    return { visits };
  }

  const keys = (await listKeys(kv, 'v:')).sort((a, b) => (a.name < b.name ? 1 : -1));
  const pool = before && valid(before) ? keys.filter((k) => k.name < before) : keys;
  const page = pool.slice(0, PAGE);
  const visits = (await Promise.all(page.map((k) => entryOf(kv, k)))).filter(Boolean);
  const out = { visits, more: pool.length > page.length, total: keys.length };
  if (!before) {
    const since = new Date(now - 13 * 86400_000).toISOString().slice(0, 10);
    const perDay = {};
    for (const k of keys) {
      const d = dayOf(k.name);
      if (d >= since) perDay[d] = (perDay[d] || 0) + 1;
    }
    out.perDay = perDay;
  }
  return out;
}
