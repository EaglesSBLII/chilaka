// Chilaka owner dashboard (page side). All text is written with textContent:
// visit fields come from strangers' browsers and are never treated as HTML.
'use strict';

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const s of ['loading', 'setup', 'login', 'dash']) $(s).hidden = s !== id;
};
const POLL_MS = 30_000;
const state = { visits: [], emails: [], newest: '', oldest: '', more: false, timer: 0, perDay: {} };

async function api(path, opts) {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opts });
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/api/login') { stop(); show('login'); throw new Error('auth'); }
  if (res.status === 503 && body.error === 'setup') { stop(); show('setup'); throw new Error('setup'); }
  if (!res.ok) throw Object.assign(new Error(body.error || String(res.status)), { status: res.status });
  return body;
}

// The password never leaves this page: it is stretched here and only the result is sent.
async function deriveKey(password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('chilaka-admin-v1'), iterations: 600000 }, base, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function when(ts) {
  const d = new Date(ts);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const rel = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return `${d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${rel}`;
}

function renderEmails() {
  const q = $('email-filter').value.trim().toLowerCase();
  const list = $('emails');
  list.replaceChildren(...state.emails.filter((e) => e.toLowerCase().includes(q)).map((e) => el('li', e)));
  $('emails-empty').hidden = state.emails.length > 0;
  $('t-accounts').textContent = String(state.emails.length);
}

function renderVisits(fresh = new Set()) {
  const realOnly = $('real-only').checked;
  const rows = state.visits.filter((v) => !realOnly || !v.automated).map((v) => {
    const tr = el('tr', undefined, [v.automated ? 'auto' : '', fresh.has(v.key) ? 'new' : ''].join(' ').trim());
    tr.append(el('td', when(v.ts), 'when'));
    const where = el('td');
    where.append(el('span', v.site === 'app' ? 'App' : 'Website', `chip ${v.site === 'app' ? 'app' : ''}`));
    tr.append(where);
    const what = el('td', v.site === 'app' ? `Opened (${v.mode === 'installed' ? 'installed' : 'in browser'})` : v.page || '/');
    if (v.referrer) what.append(el('div', `from ${v.referrer}`, 'muted small'));
    tr.append(what);
    tr.append(el('td', [v.city, v.region, v.country].filter(Boolean).join(', ') || 'Unknown'));
    tr.append(el('td', [v.device, v.browser].filter((x) => x && x !== 'other').join(' · ') || 'Unknown'));
    const net = el('td', v.network || '—');
    if (v.automated) net.append(document.createTextNode(' '), el('span', 'automated', 'chip bot'));
    tr.append(net);
    return tr;
  });
  $('visits').replaceChildren(...rows);
  $('visits-empty').hidden = rows.length > 0;
  $('older').hidden = !state.more;

  // real people = distinct visitor ids among non-automated visits (ids change daily)
  const today = new Date().toDateString();
  const weekAgo = Date.now() - 7 * 86400_000;
  const real = state.visits.filter((v) => !v.automated);
  const uniq = (list) => new Set(list.map((v) => `${v.ts.slice(0, 10)}|${v.visitor}`)).size;
  $('t-today').textContent = String(uniq(real.filter((v) => new Date(v.ts).toDateString() === today)));
  const weekLoaded = !state.more || (state.oldest && Date.parse(state.oldest.slice(2, 26)) < weekAgo);
  $('t-week').textContent = uniq(real.filter((v) => Date.parse(v.ts) >= weekAgo)) + (weekLoaded ? '' : '+');
  const hidden = state.visits.length - real.length;
  $('visit-note').textContent = `${state.visits.length} visits loaded` + (hidden ? `, ${hidden} look automated (data-centre networks or no real browser).` : '.') + ' A visitor is counted once per day.';
}

function renderGithub(g) {
  const box = $('gh');
  box.replaceChildren();
  const grid = el('div', undefined, 'gh-grid');
  const tile = (num, lbl) => { const t = el('div', undefined, 'tile'); t.append(el('div', String(num ?? '–'), 'num'), el('div', lbl, 'lbl')); return t; };
  const downloads = (g.releases || []).reduce((n, r) => n + r.downloads, 0);
  $('t-downloads').textContent = String(downloads);
  grid.append(tile(g.stars, 'Stars'), tile(downloads, 'Downloads (last 10 releases)'));
  if (g.traffic) grid.append(tile(g.traffic.views.uniques, 'Unique page visitors, 14 days'), tile(g.traffic.views.count, 'Page views, 14 days'), tile(g.traffic.clones.uniques, 'Unique cloners, 14 days'));
  box.append(grid);
  if (g.releases && g.releases.length) {
    const ul = el('ul', undefined, 'gh-list');
    for (const r of g.releases) { const li = el('li'); li.append(el('span', `${r.tag} · ${new Date(r.published).toLocaleDateString()}`), el('span', `${r.downloads} downloads`)); ul.append(li); }
    box.append(ul);
  }
  if (g.traffic && g.traffic.referrers.length) {
    const ul = el('ul', undefined, 'gh-list');
    for (const r of g.traffic.referrers) { const li = el('li'); li.append(el('span', `from ${r.from}`), el('span', `${r.uniques} people · ${r.count} views`)); ul.append(li); }
    box.append(ul);
  }
  const note = g.trafficNote === 'not-connected'
    ? 'Repository page views are not connected. GitHub only shares them with a token: see docs/ADMIN.md. GitHub gives daily totals only, never individual visitors.'
    : g.trafficNote ? `GitHub traffic could not be read (${g.trafficNote}).` : 'GitHub gives daily totals only, never individual visitors.';
  box.append(el('p', `${note} Updated ${when(g.fetchedAt)}.`, 'muted small'));
  if (g.error) box.append(el('p', `GitHub could not be reached (${g.error}).`, 'error small'));
}

async function loadVisits() {
  const r = await api('/api/visits');
  state.visits = r.visits;
  state.more = Boolean(r.more);
  state.newest = r.visits[0]?.key || '';
  state.oldest = r.visits[r.visits.length - 1]?.key || '';
  renderVisits();
}

async function poll() {
  if (document.hidden) return;
  try {
    if (!state.newest) { await loadVisits(); return; }
    const r = await api(`/api/visits?after=${encodeURIComponent(state.newest)}`);
    if (r.visits.length) {
      const have = new Set(state.visits.map((v) => v.key));
      const fresh = r.visits.filter((v) => !have.has(v.key));
      state.visits = [...fresh, ...state.visits];
      state.newest = state.visits[0].key;
      renderVisits(new Set(fresh.map((v) => v.key)));
    } else {
      renderVisits(); // keeps the "x min ago" labels moving
    }
    setLive(true);
  } catch (e) {
    if (e.message !== 'auth' && e.message !== 'setup') setLive(false);
  }
}

function setLive(on) {
  $('live').classList.toggle('off', !on);
  $('live-text').textContent = on ? 'Live' : 'Reconnecting';
}
function stop() { clearInterval(state.timer); state.timer = 0; }

// The developer version: what build is up, and what it adds to the released app.
async function loadDev() {
  const info = $('dev-info');
  const notes = $('dev-notes');
  notes.hidden = true;
  try {
    const res = await fetch('/dev/build.json', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const b = await res.json();
    const extra = b.unpublished
      ? `Version ${b.version}, with changes that are NOT in the released app yet.`
      : `Version ${b.version}, identical to the released app.`;
    info.textContent = `${extra} Built ${when(b.builtAt)}. It uses your real account and progress if you sign in, so treat it as a preview, not a sandbox.`;
    if (b.unpublished && Array.isArray(b.notes) && b.notes.length) {
      notes.replaceChildren(...b.notes.map((n) => el('li', n)));
      notes.hidden = false;
    }
  } catch {
    info.textContent = 'No developer version has been uploaded yet.';
  }
}

async function openDash() {
  if (new URLSearchParams(location.search).get('next') === 'dev') { location.replace('/dev/'); return; }
  show('dash');
  void loadDev();
  const [emails] = await Promise.all([api('/api/emails'), loadVisits()]);
  state.emails = emails.emails;
  renderEmails();
  api('/api/github').then(renderGithub).catch(() => {});
  stop();
  state.timer = setInterval(poll, POLL_MS);
  setLive(true);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  const err = $('login-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  try {
    const authKey = await deriveKey($('pw').value);
    $('pw').value = '';
    await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authKey }) });
    await openDash();
  } catch (ex) {
    if (ex.message === 'setup') return;
    err.textContent = ex.status === 429 ? 'Too many attempts. Wait 15 minutes.' : ex.status === 401 ? 'Wrong password.' : 'Could not sign in. Check your connection.';
    err.hidden = false;
    show('login');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
});
$('logout').addEventListener('click', async () => {
  stop();
  try { await api('/api/logout', { method: 'POST' }); } catch { /* locked either way */ }
  state.visits = []; state.emails = [];
  $('emails').replaceChildren(); $('visits').replaceChildren(); $('gh').replaceChildren();
  show('login');
});
$('email-filter').addEventListener('input', renderEmails);
$('real-only').addEventListener('change', () => renderVisits());
$('copy-emails').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.emails.join('\n')); $('copy-emails').textContent = 'Copied'; } catch { $('copy-emails').textContent = 'Copy failed'; }
  setTimeout(() => { $('copy-emails').textContent = 'Copy all'; }, 1500);
});
$('older').addEventListener('click', async () => {
  if (!state.oldest) return;
  const r = await api(`/api/visits?before=${encodeURIComponent(state.oldest)}`);
  state.visits = [...state.visits, ...r.visits];
  state.more = Boolean(r.more);
  state.oldest = state.visits[state.visits.length - 1]?.key || state.oldest;
  renderVisits();
});
$('gh-refresh').addEventListener('click', () => api('/api/github?fresh=1').then(renderGithub).catch(() => {}));
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.timer) void poll(); });

api('/api/me').then(openDash).catch((e) => { if (e.message !== 'setup') show('login'); });
