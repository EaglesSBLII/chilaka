// Chilaka desktop shell: window + tray + reminders + ASR/TTS IPC.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, powerMonitor, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { AsrServer } = require('./asr');
const { LiveTts } = require('./tts');
const { ReminderScheduler } = require('./reminders');
const { writeBackup } = require('./backup');
const { AppleMusic } = require('./applemusic');

let appleMusicActive = false; // we started playback → pause it on quit

const isDev = !app.isPackaged;
const RESOURCES = isDev ? path.join(__dirname, '../resources') : process.resourcesPath;

let win = null;
let tray = null;
let quitting = false;

const asr = new AsrServer({
  binDir: path.join(RESOURCES, 'bin'),
  modelPath: path.join(RESOURCES, 'models', 'ggml-telugu-medium-q5_0.bin'),
});
const tts = new LiveTts({ modelDir: path.join(RESOURCES, 'models', 'vits-mms-tel') });
const scheduler = new ReminderScheduler({
  storePath: () => path.join(app.getPath('userData'), 'reminders.json'),
  onFire: (reminder) => {
    const n = new Notification({
      title: `🦜 ${reminder.label || 'Telugu time!'}`,
      body: 'Chikki is waiting — keep your streak alive with a quick lesson.',
      silent: false,
    });
    n.on('click', () => showWindow());
    n.show();
  },
});

function appUrl() {
  if (process.env.CHILAKA_DEV_URL) return process.env.CHILAKA_DEV_URL;
  return `file://${path.join(__dirname, '../../app/dist/index.html')}`;
}

function packagedIndex() {
  return path.join(__dirname, '../web/index.html');
}

function showWindow() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 420,
    minHeight: 640,
    title: 'Chilaka',
    backgroundColor: '#FFF8ED',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (!isDev && fs.existsSync(packagedIndex())) {
    win.loadFile(packagedIndex());
  } else if (process.env.CHILAKA_DEV_URL) {
    win.loadURL(process.env.CHILAKA_DEV_URL);
  } else {
    win.loadURL(appUrl());
  }
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide(); // stay alive in the tray so reminders still fire
    }
  });
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildTray() {
  const iconPath = path.join(RESOURCES, 'icons', 'trayTemplate.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Chilaka — Telugu');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Chilaka', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: 'separator' },
    {
      label: 'Quit Chilaka',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
}

// ---- IPC bridge ----
ipcMain.handle('asr:available', async () => asr.available());
ipcMain.handle('asr:transcribe', async (_e, wavBuf) => {
  try {
    const text = await asr.transcribe(Buffer.from(wavBuf));
    return { ok: true, text };
  } catch (err) {
    return { ok: false, text: '', error: String(err.message || err) };
  }
});
ipcMain.handle('tts:speak', async (_e, text) => {
  try {
    return await tts.synthesizeWav(text);
  } catch {
    return null;
  }
});
ipcMain.handle('reminders:set', async (_e, reminders) => {
  scheduler.setReminders(reminders);
  return true;
});
ipcMain.handle('backup:save', async (_e, json) => {
  const file = writeBackup(path.join(app.getPath('userData'), 'backups'), json);
  return file;
});
// ---- Apple Music link (AppleScript remote control) ----
ipcMain.handle('amusic:playlists', async () => {
  try {
    return { ok: true, playlists: await AppleMusic.playlists() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('amusic:play', async (_e, playlist, volume) => {
  try {
    await AppleMusic.play(playlist, volume);
    appleMusicActive = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('amusic:pause', async () => {
  try {
    await AppleMusic.pause();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('amusic:resume', async () => {
  try {
    await AppleMusic.resume();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('amusic:volume', async (_e, volume) => {
  try {
    await AppleMusic.setVolume(volume);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('amusic:stop', async () => {
  appleMusicActive = false;
  await AppleMusic.stop();
  return { ok: true };
});

app.whenReady().then(() => {
  showWindow();
  buildTray();
  scheduler.start();
  powerMonitor.on('resume', () => scheduler.checkNow(20));
  // Warm the ASR model in the background so the first speaking exercise is fast.
  setTimeout(() => void asr.warmUp().catch(() => {}), 4000);
});

app.on('activate', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
  asr.stop();
  if (appleMusicActive) void AppleMusic.stop();
});
app.on('window-all-closed', () => {
  // keep running in tray (reminders); real quit comes from tray menu / Cmd+Q
});
