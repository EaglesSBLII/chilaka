// Electron smoke: real main process, real preload bridge, real whisper ASR.
import { test, expect, _electron as electron } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(__dirname, '..');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let app;
let win;

test.beforeAll(async () => {
  // The CLI host sets ELECTRON_RUN_AS_NODE, which would boot Electron as
  // plain Node and break the launch — strip it.
  const env = { ...process.env, CHILAKA_SMOKE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [DESKTOP],
    env,
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('window loads the app with the bridge exposed', async () => {
  await expect(win.locator('#root')).toBeVisible();
  const hasBridge = await win.evaluate(() => Boolean(window.chilakaBridge));
  expect(hasBridge).toBe(true);
});

test('ASR is available and transcribes a Telugu fixture', async () => {
  const available = await win.evaluate(() => window.chilakaBridge.asrAvailable());
  expect(available).toBe(true);

  const wavPath = join(DESKTOP, '../vendor/tts-spike/test-2.wav');
  const wavB64 = readFileSync(wavPath).toString('base64');
  const result = await win.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return window.chilakaBridge.transcribe(bytes.buffer);
  }, wavB64);
  expect(result.ok).toBe(true);
  expect(result.text).toContain('కూరగాయలు'); // "vegetables" — from the fixture
});

test('live TTS synthesizes arbitrary Telugu', async () => {
  const size = await win.evaluate(async () => {
    const wav = await window.chilakaBridge.speak('మీరు ఎలా ఉన్నారు?');
    return wav ? wav.byteLength : 0;
  });
  expect(size).toBeGreaterThan(20_000); // non-trivial audio
});

test('reminders persist through the bridge', async () => {
  await win.evaluate(() =>
    window.chilakaBridge.setReminders([{ hh: 19, mm: 30, enabled: true, label: 'Telugu time' }]),
  );
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const stored = JSON.parse(readFileSync(join(userData, 'reminders.json'), 'utf-8'));
  expect(stored).toHaveLength(1);
  expect(stored[0].hh).toBe(19);
});

test('backup writes to the backups folder', async () => {
  await win.evaluate(() => window.chilakaBridge.saveBackup(JSON.stringify({ probe: true })));
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const dir = join(userData, 'backups');
  expect(existsSync(dir)).toBe(true);
  const files = readdirSync(dir).filter((f) => f.startsWith('chilaka-backup-'));
  expect(files.length).toBeGreaterThan(0);
});
