// Rasterizes the Chikki SVG into all needed icons: PWA PNGs, macOS .icns,
// and the menu-bar template icon. Uses Playwright's bundled Chromium.

import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICONS = join(ROOT, 'app/public/icons');
const DESK_ICONS = join(ROOT, 'desktop/resources/icons');
mkdirSync(ICONS, { recursive: true });
mkdirSync(DESK_ICONS, { recursive: true });

const appSvg = readFileSync(join(ICONS, 'favicon.svg'), 'utf-8');

// Monochrome silhouette for the macOS menu bar (template image: black + alpha).
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <path d="M38 78 Q20 96 14 112 Q34 104 46 92 Z" fill="#000"/>
  <ellipse cx="62" cy="70" rx="30" ry="34" fill="#000"/>
  <ellipse cx="88" cy="70" rx="12" ry="22" fill="#000"/>
  <circle cx="58" cy="34" r="24" fill="#000"/>
  <path d="M78 32 Q96 36 90 46 Q80 50 75 42 Z" fill="#000"/>
  <path d="M52 12 Q56 2 64 8 Q60 12 60 16 Q56 12 52 12" fill="#000"/>
</svg>`;

// Maskable icon: extra padding so the safe zone survives rounding.
const maskableSvg = appSvg.replace('viewBox="0 0 120 120"', 'viewBox="-24 -24 168 168"').replace(
  '<rect width="120" height="120" rx="28"',
  '<rect x="-24" y="-24" width="168" height="168" rx="0"',
);

async function raster(svg, size, outPath, transparent = false) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const bg = transparent ? 'transparent' : 'white';
  await page.setContent(
    `<style>*{margin:0;padding:0}body{background:${bg}}</style><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`,
  );
  await page.screenshot({ path: outPath, omitBackground: transparent });
  await page.close();
}

const browser = await chromium.launch();

// PWA icons
await raster(appSvg, 192, join(ICONS, 'icon-192.png'), true);
await raster(appSvg, 512, join(ICONS, 'icon-512.png'), true);
await raster(maskableSvg, 512, join(ICONS, 'icon-512-maskable.png'), true);

// Tray template (16 + @2x)
await raster(traySvg, 16, join(DESK_ICONS, 'trayTemplate.png'), true);
await raster(traySvg, 32, join(DESK_ICONS, 'trayTemplate@2x.png'), true);

// macOS .icns via iconutil
const iconset = join(DESK_ICONS, 'app.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const [size, name] of [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]) {
  await raster(appSvg, size, join(iconset, name), true);
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(DESK_ICONS, 'app.icns')]);
rmSync(iconset, { recursive: true, force: true });

await browser.close();
console.log('icons done');
