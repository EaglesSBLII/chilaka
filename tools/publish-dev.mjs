// Build the DEVELOPER VERSION of the app and put it behind the owner dashboard
// password at https://chilaka-admin.kandikonda-arnav.workers.dev/dev/
//
//   node tools/publish-dev.mjs --note "Letter tracing" --note "Another change"
//   node tools/publish-dev.mjs --no-deploy      # build + stage only (CI does the upload)
//
// It builds whatever is in this folder right now (committed or not), so the
// developer version = the released app + the changes still waiting for approval.
// Nothing is pushed to GitHub and the released app is not touched.
// Publishing for everyone stays a separate, later step: push to main + release.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
const out = join(root, 'admin-worker/public/dev');
const args = process.argv.slice(2);
const notes = args.flatMap((a, i) => (a === '--note' && args[i + 1] ? [args[i + 1]] : []));
const deploy = !args.includes('--no-deploy');

const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const run = (cmd, a, cwd, env = {}) => {
  const res = spawnSync(cmd, a, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (res.status !== 0) {
    console.error(`\n${cmd} ${a.join(' ')} failed. The developer version was NOT updated.`);
    process.exit(res.status ?? 1);
  }
};

console.log('Building the developer version…');
run('npx', ['tsc', '-b'], app);
run('npx', ['vite', 'build'], app, { CHILAKA_CHANNEL: 'dev' });
if (!existsSync(join(app, 'dist-dev/index.html'))) {
  console.error('The build produced no index.html. The developer version was NOT updated.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(app, 'dist-dev'), out, { recursive: true });

// what this build adds to the released app (origin/main is what everyone has)
const ahead = git('log', '--format=%s', 'origin/main..HEAD').split('\n').filter(Boolean);
const dirty = git('status', '--porcelain', '--untracked-files=normal', '--', 'app', 'sync-worker').split('\n').filter((l) => l && !l.includes('tsconfig.tsbuildinfo')).length > 0;
const build = {
  version: JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version,
  builtAt: new Date().toISOString(),
  commit: git('rev-parse', '--short', 'HEAD'),
  released: git('rev-parse', '--short', 'origin/main'),
  unpublished: ahead.length > 0 || dirty,
  notes: notes.length ? notes : ahead,
};
writeFileSync(join(out, 'build.json'), JSON.stringify(build, null, 2));
console.log(`Staged ${build.version} (${build.unpublished ? 'with unpublished changes' : 'same as released'}) in admin-worker/public/dev`);

if (deploy) {
  console.log('Uploading behind the owner dashboard password…');
  run('npx', ['--yes', 'wrangler', 'deploy'], join(root, 'admin-worker'), { CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'a45e4bea84463476d41f6ce73ae2476a' });
  console.log('\nDeveloper version is up: https://chilaka-admin.kandikonda-arnav.workers.dev/dev/');
}
