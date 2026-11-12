// GitHub numbers for the repository. Stars and download counts are public;
// page views and clones ("traffic") need a token with read access to the
// repository's administration data, stored as the GITHUB_TOKEN secret.
// GitHub only publishes traffic as daily totals for the last 14 days: there is
// no per-visitor log to show.

const REPO = 'EaglesSBLII/chilaka';
const CACHE_KEY = 'admin:gh';
const CACHE_TTL = 1800;

async function gh(path, token) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'chilaka-admin',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`github ${path} ${res.status}`);
  return res.json();
}

export async function readGithub(env, { fresh = false } = {}) {
  if (!fresh) {
    const cached = await env.VISITS.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  }
  const token = env.GITHUB_TOKEN || '';
  const out = { repo: REPO, fetchedAt: new Date().toISOString(), stars: null, releases: [], traffic: null, trafficNote: '' };
  try {
    const [repo, releases] = await Promise.all([gh('', token), gh('/releases?per_page=10', token)]);
    out.stars = repo.stargazers_count ?? null;
    out.watchers = repo.subscribers_count ?? null;
    out.forks = repo.forks_count ?? null;
    out.releases = releases.map((r) => ({
      tag: r.tag_name,
      published: r.published_at,
      downloads: (r.assets || []).reduce((n, a) => n + (a.download_count || 0), 0),
    }));
  } catch (e) {
    out.error = String(e.message || e);
  }
  if (!token) {
    out.trafficNote = 'not-connected';
  } else {
    try {
      const [views, clones, referrers] = await Promise.all([gh('/traffic/views', token), gh('/traffic/clones', token), gh('/traffic/popular/referrers', token)]);
      out.traffic = {
        views: { count: views.count, uniques: views.uniques, days: (views.views || []).map((d) => ({ day: d.timestamp.slice(0, 10), count: d.count, uniques: d.uniques })) },
        clones: { count: clones.count, uniques: clones.uniques },
        referrers: (referrers || []).slice(0, 8).map((r) => ({ from: r.referrer, count: r.count, uniques: r.uniques })),
      };
    } catch (e) {
      out.trafficNote = String(e.message || e);
    }
  }
  await env.VISITS.put(CACHE_KEY, JSON.stringify(out), { expirationTtl: CACHE_TTL });
  return out;
}
