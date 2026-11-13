// Chilaka Owner: the private dashboard as a Mac app that works on THIS laptop only.
//
//   node tools/owner-app.mjs            build the app, install it in /Applications, turn the lock on
//   node tools/owner-app.mjs --unlock   turn the lock off (the dashboard opens in any browser again)
//   node tools/owner-app.mjs --no-lock  build and install only
//   node tools/owner-app.mjs --lock-only  turn the lock on for the app already installed
//
// How the lock works: a random device key is made once and kept in
// ~/Library/Application Support/Chilaka Owner/device.key (readable only by
// you). Cloudflare gets a one-way hash of it (secret ADMIN_DEVICE_HASH). The
// dashboard then answers "Not found" to anything that does not send the key:
// every browser, phone and other computer. The app sends it; the dashboard
// password is still asked for on top. The key is never printed or uploaded.
// New laptop or lost key: run this again there (it makes a new key and
// replaces the old one, so the old laptop stops working).

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cf = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'a45e4bea84463476d41f6ce73ae2476a' };
const worker = join(root, 'admin-worker');
const run = (cmd, a, opts = {}) => {
  const res = spawnSync(cmd, a, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    console.error(`\n${cmd} ${a.slice(0, 3).join(' ')} failed. Stopped; nothing after this step was changed.`);
    process.exit(res.status ?? 1);
  }
};

if (args.includes('--unlock')) {
  run('npx', ['--yes', 'wrangler', 'secret', 'delete', 'ADMIN_DEVICE_HASH'], { cwd: worker, env: cf, input: 'y\n', stdio: ['pipe', 'inherit', 'inherit'] });
  console.log('\nLock off: the dashboard opens in a browser again (password still needed).');
  process.exit(0);
}

// 1. this laptop's key
const dir = join(homedir(), 'Library/Application Support/Chilaka Owner');
const keyFile = join(dir, 'device.key');
mkdirSync(dir, { recursive: true, mode: 0o700 });
if (!existsSync(keyFile) || !/^[0-9a-f]{64}$/.test(readFileSync(keyFile, 'utf8').trim())) {
  writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  console.log('Made a new device key for this laptop.');
}
chmodSync(keyFile, 0o600);

// 2. build + install the app
if (!args.includes('--lock-only')) {
  const appDir = join(root, 'owner-app');
  rmSync(join(appDir, 'dist-electron'), { recursive: true, force: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  run('npx', ['electron-builder', '--mac', 'dir', '--projectDir', appDir], { cwd: join(root, 'desktop'), env });
  const built = join(appDir, 'dist-electron/mac-arm64/Chilaka Owner.app');
  run('codesign', ['--force', '--deep', '--sign', '-', built]);
  const target = '/Applications/Chilaka Owner.app';
  rmSync(target, { recursive: true, force: true });
  cpSync(built, target, { recursive: true, verbatimSymlinks: true });
  console.log(`Installed ${target}`);
}

// 3. lock the dashboard to this laptop
if (!args.includes('--no-lock')) {
  const hash = createHash('sha256').update(`device|${readFileSync(keyFile, 'utf8').trim()}`).digest('hex');
  run('npx', ['--yes', 'wrangler', 'secret', 'put', 'ADMIN_DEVICE_HASH'], { cwd: worker, env: cf, input: hash, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log('\nLock on: the dashboard now only opens in the Chilaka Owner app on this laptop.');
}
