// Set (or change) the password of the private owner dashboard (admin-worker/).
//
//   node tools/admin-password.mjs
//
// Asks for a password without showing it, stretches it exactly like the
// dashboard's sign-in page does, and stores only a salted one-way hash as the
// ADMIN_PASSWORD_HASH secret of the chilaka-admin worker. The password itself
// is never written anywhere. Needs `npx wrangler login` on this Mac, and the
// chilaka-admin worker to have been deployed once (it deploys on push to main).

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSecret } from '../admin-worker/src/lib/auth.js';

function ask(label) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('Run this in a terminal window (it needs to ask for the password).'));
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let text = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          return resolve(text);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
        else text += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await ask('New dashboard password (at least 12 characters, not shown): ');
if (password.length < 12) {
  console.error('Too short: use at least 12 characters. Nothing was changed.');
  process.exit(1);
}
if ((await ask('Type it again: ')) !== password) {
  console.error('The two did not match. Nothing was changed.');
  process.exit(1);
}

// must match deriveKey() in admin-worker/public/app.js
const authKey = pbkdf2Sync(password, 'chilaka-admin-v1', 600000, 32, 'sha256').toString('hex');
const secret = await makeSecret(authKey, randomBytes(16).toString('hex'));

const cwd = join(dirname(fileURLToPath(import.meta.url)), '../admin-worker');
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'a45e4bea84463476d41f6ce73ae2476a' };
const res = spawnSync('npx', ['--yes', 'wrangler', 'secret', 'put', 'ADMIN_PASSWORD_HASH'], { cwd, env, input: secret, stdio: ['pipe', 'inherit', 'inherit'] });
if (res.status !== 0) {
  console.error('\nCloudflare did not accept the secret. If it says you are logged out, run `npx wrangler login` and try again.');
  process.exit(res.status ?? 1);
}
console.log('\nPassword set. Open https://chilaka-admin.kandikonda-arnav.workers.dev and unlock it.');
console.log('Anyone signed in before this change has been signed out.');
