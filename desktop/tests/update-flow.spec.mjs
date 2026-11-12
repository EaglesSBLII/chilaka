// Update flow as the learner sees it: a newer release is announced in the banner,
// Update starts the download, the bar shows a real percentage, and Restart appears
// once the bundle is staged. Served from a local fake release feed (a tiny dmg,
// throttled so the progress is observable); nothing is installed.
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(__dirname, '..');

test.setTimeout(180_000);

test('banner: available → Update → percentage → ready', async () => {
  // a fake installer: Chilaka.app with ~24 MB of incompressible padding inside a real dmg
  const work = mkdtempSync(join(tmpdir(), 'chilaka-fake-release-'));
  const src = join(work, 'src', 'Chilaka.app', 'Contents', 'MacOS');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'padding.bin'), randomBytes(24 * 1024 * 1024));
  const dmg = join(work, 'Chilaka-9.9.9-arm64.dmg');
  execFileSync('hdiutil', ['create', '-quiet', '-srcfolder', join(work, 'src'), '-volname', 'Chilaka', '-format', 'UDZO', dmg]);
  const bytes = readFileSync(dmg);
  const size = statSync(dmg).size;

  // release feed + throttled download (~8 MB/s → a few seconds of visible progress)
  const server = createServer((req, res) => {
    if (req.url === '/latest') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          tag_name: 'v9.9.9',
          body: 'Test release',
          assets: [{ name: 'Chilaka-9.9.9-arm64.dmg', size, browser_download_url: `http://127.0.0.1:${server.address().port}/dmg` }],
        }),
      );
      return;
    }
    if (req.url === '/dmg') {
      res.setHeader('content-length', String(size));
      let off = 0;
      const tick = () => {
        if (off >= size) return res.end();
        res.write(bytes.subarray(off, (off += 512 * 1024)));
        setTimeout(tick, 60);
      };
      tick();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const feed = `http://127.0.0.1:${server.address().port}/latest`;

  const env = { ...process.env, CHILAKA_SMOKE: '1', CHILAKA_UPDATE_TEST: '0.0.1', CHILAKA_UPDATE_FEED: feed };
  delete env.ELECTRON_RUN_AS_NODE;
  // own data folder, so the test never fights the installed app over its database
  const app = await electron.launch({ args: [DESKTOP, `--user-data-dir=${join(work, 'userData')}`], env });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // the first check runs 15 s after launch
    const banner = win.getByTestId('update-banner');
    await expect(banner).toHaveAttribute('data-phase', 'available', { timeout: 60_000 });
    await expect(banner).toContainText('Chilaka 9.9.9 is available');
    await win.screenshot({ path: join(DESKTOP, 'test-results', 'update-1-available.png') });

    await banner.getByRole('button', { name: 'Update' }).click();
    await expect(banner).toHaveAttribute('data-phase', 'downloading', { timeout: 10_000 });
    const seen = new Set();
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      const phase = await banner.getAttribute('data-phase');
      if (phase !== 'downloading') break;
      const pct = Number((await win.getByTestId('update-percent').textContent())?.replace('%', ''));
      seen.add(pct);
      if (seen.size === 3) await win.screenshot({ path: join(DESKTOP, 'test-results', 'update-2-downloading.png') });
      await win.waitForTimeout(150);
    }
    // the percentage really moved and never went backwards past the full range
    const pcts = [...seen];
    expect(pcts.length).toBeGreaterThan(2);
    expect(Math.max(...pcts)).toBeGreaterThanOrEqual(50);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));

    await expect(banner).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    await expect(banner).toContainText('Chilaka 9.9.9 is ready');
    await expect(banner.getByRole('button', { name: 'Restart' })).toBeVisible();
    await win.screenshot({ path: join(DESKTOP, 'test-results', 'update-3-ready.png') });
    // staged, not installed: the running bundle is untouched
    const staged = await app.evaluate(({ app: a }) => a.getVersion());
    expect(staged).toBe(JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version);
  } finally {
    await app.close();
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
