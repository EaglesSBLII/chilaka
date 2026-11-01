// Serves the built PWA on your local network so you can preview Chilaka on
// your iPhone's browser over Wi-Fi. Prints the LAN URL + a scannable QR code.
//
// NOTE: iOS only lets a PWA install to the Home Screen (with offline support)
// over HTTPS. Plain-HTTP LAN preview lets you SEE the app on your phone, but to
// truly "install" it you need the HTTPS hosting path in docs/IPHONE.md. This
// server is for a quick look and for desktop-browser testing.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '../app/dist');
const PORT = 4180;

if (!existsSync(DIST)) {
  console.error('Build first:  npm run build -w app');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/') path = '/index.html';
  let file = join(DIST, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // SPA fallback
  try {
    const body = readFileSync(file);
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Service-Worker-Allowed', '/');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  const url = `http://${ips[0] ?? 'localhost'}:${PORT}`;
  console.log('\n  Chilaka is serving on your local network:\n');
  console.log(`    ${url}\n`);
  printQR(url);
  console.log('\n  On your iPhone (same Wi-Fi): open that URL in Safari.');
  console.log('  For a true installable, offline Home-Screen app, see docs/IPHONE.md.\n');
  console.log('  Press Ctrl+C to stop.\n');
});

// Minimal QR (numeric/byte, version-4 ECC-L) is complex; instead shell out to a
// tiny inline generator only if the optional dep is present, else skip.
function printQR(text) {
  try {
    const mod = require('qrcode-terminal');
    mod.generate(text, { small: true });
  } catch {
    // qrcode-terminal not installed — the URL above is enough
    console.log('  (install qrcode-terminal for a scannable code, or just type the URL)');
  }
}
