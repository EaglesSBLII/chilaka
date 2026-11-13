// Chilaka Owner: the private dashboard (account emails, visitors, developer
// version) as a Mac app that only works on this laptop.
//
// The dashboard server refuses every request that does not carry this laptop's
// device key (a random key kept in this app's folder, made by
// `node tools/owner-app.mjs`). The app adds the key to its own requests; the
// page never sees it. The dashboard password is still asked for on top.
const { app, BrowserWindow, dialog, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'https://chilaka-admin.kandikonda-arnav.workers.dev';
const KEY_FILE = path.join(app.getPath('appData'), 'Chilaka Owner', 'device.key');

function deviceKey() {
  try {
    const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

function open() {
  const key = deviceKey();
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: 'Chilaka Owner',
    backgroundColor: '#FFF8ED',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (!key) {
    void win.loadFile(path.join(__dirname, 'missing.html'));
    return;
  }
  const ses = win.webContents.session;
  // the key goes only to the dashboard's own address, never anywhere else
  ses.webRequest.onBeforeSendHeaders({ urls: [`${ORIGIN}/*`] }, (details, done) => {
    done({ requestHeaders: { ...details.requestHeaders, 'x-chilaka-device': key } });
  });
  // microphone for speaking tests in the developer version; nothing else
  ses.setPermissionRequestHandler((wc, permission, done) => {
    done(permission === 'media' && wc.getURL().startsWith(`${ORIGIN}/`));
  });
  // this window stays on the dashboard; any other link opens in the normal browser
  const outside = (url) => !url.startsWith(`${ORIGIN}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (outside(url) && /^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: outside(url) ? 'deny' : 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (outside(url)) {
      e.preventDefault();
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) dialog.showErrorBox('Could not reach the dashboard', `${desc}\n\nCheck the internet connection and open the app again.`);
  });
  void win.loadURL(`${ORIGIN}/`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.whenReady().then(open);
  app.on('window-all-closed', () => app.quit());
}
