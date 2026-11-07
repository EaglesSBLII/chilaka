// Updater regression: inside Electron, fs treats app.asar as a directory, so
// fs.rmSync(recursive) on a backup bundle dies with ENOTDIR (the 0.2.1/0.3.0
// "Update failed" bug). removeBundle must delete such a bundle cleanly.
import { test, expect, _electron as electron } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(__dirname, '..');

test.setTimeout(120_000);

test('removeBundle deletes a bundle that contains an app.asar', async () => {
  const env = { ...process.env, CHILAKA_SMOKE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [DESKTOP], env });
  try {
    const result = await app.evaluate(async ({ app: electronApp }, desktop) => {
      // evaluate() runs outside any CommonJS module: build a require rooted at desktop/src
      const { createRequire } = process.getBuiltinModule('node:module');
      const require = createRequire(desktop + '/src/');
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');
      const { execFileSync } = require('node:child_process');
      const { removeBundle } = require(path.join(desktop, 'src', 'updater.js'));
      // a tiny but valid asar archive, built with the real packer
      const { createPackage } = require('@electron/asar');
      const src = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-src-'));
      fs.writeFileSync(path.join(src, 'main.js'), '// stub\n');
      const asar = path.join(src, 'app.asar');
      await createPackage(src, asar);
      const mk = () => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rmtest-'));
        const bundle = path.join(d, 'Chilaka.app.previous');
        fs.mkdirSync(path.join(bundle, 'Contents', 'Resources'), { recursive: true });
        execFileSync('cp', [asar, path.join(bundle, 'Contents', 'Resources', 'app.asar')]);
        return bundle;
      };
      let oldCode = 'no error';
      const b1 = mk();
      try {
        fs.rmSync(b1, { recursive: true, force: true });
      } catch (e) {
        oldCode = e.code;
      }
      const b2 = mk();
      removeBundle(b2);
      return { oldCode, removed: !fs.existsSync(b2), running: Boolean(electronApp.isReady()) };
    }, DESKTOP);
    expect(result.running).toBe(true);
    // the bug we are guarding against really exists in this Electron
    expect(result.oldCode).toBe('ENOTDIR');
    expect(result.removed).toBe(true);
  } finally {
    await app.close();
  }
});
