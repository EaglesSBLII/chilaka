// Self-updater for the Mac app. Checks the GitHub release feed on launch and
// every few hours and tells the app window when a newer version exists. The
// learner presses Update in the app (or the tray menu): the installer downloads
// with live progress, the new bundle is staged, and a Restart button swaps it
// in. With "Download updates automatically" on, the download starts by itself
// and only the restart is manual. No code-signing identity is needed: the app
// is ad-hoc signed, and a bundle copied into place by the app itself carries no
// quarantine flag.
//
// State pushed to the window (onState): { phase, version, notes, size, received,
// percent, error } with phase one of idle | checking | up-to-date | available |
// downloading | ready | error.
//
// Settings live in <userData>/updater.json: { auto: false }.
// QA: CHILAKA_UPDATE_TEST=0.0.1 makes the build think it is that old;
// CHILAKA_UPDATE_FEED=<url> reads the release JSON from somewhere else.

const { app, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

/** Remove a bundle the way Finder would. Node's fs inside Electron treats
 *  app.asar as a directory, so fs.rmSync(recursive) fails with ENOTDIR on it. */
function removeBundle(p) {
  if (!fs.existsSync(p)) return;
  require('node:child_process').execFileSync('rm', ['-rf', p]);
}
const REPO = 'EaglesSBLII/chilaka';
const FEED = process.env.CHILAKA_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function cmp(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

class Updater {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'updater.json');
    this.settings = { auto: false };
    try {
      this.settings = { ...this.settings, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      /* first run */
    }
    this.available = null; // { version, url, size, notes }
    this.staged = null; // path to the new Chilaka.app, ready to swap in
    this.busy = false;
    this.timer = null;
    this.onState = () => {};
    this.state = { phase: 'idle' };
  }

  get auto() {
    return this.settings.auto === true;
  }

  /** Replace the public state and tell the window. */
  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
    return this.state;
  }
  setAuto(on) {
    this.settings.auto = Boolean(on);
    fs.writeFileSync(this.file, JSON.stringify(this.settings));
    if (on) void this.check();
  }

  /** The running bundle (…/Chilaka.app), wherever the learner keeps it. */
  bundlePath() {
    const exe = app.getPath('exe'); // …/Chilaka.app/Contents/MacOS/Chilaka
    return path.resolve(exe, '..', '..', '..');
  }

  start() {
    if (process.platform !== 'darwin' || (!app.isPackaged && !process.env.CHILAKA_UPDATE_TEST)) return;
    setTimeout(() => void this.check(), 15_000);
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  /** Version of the bundle on disk — newer than the running process when an
   *  update was swapped in but the app never relaunched. */
  installedVersion() {
    try {
      const plist = fs.readFileSync(path.join(this.bundlePath(), 'Contents', 'Info.plist'), 'utf8');
      return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] || null;
    } catch {
      return null;
    }
  }

  /** Look for a newer release. manual=true also reports "up to date". */
  async check(manual = false) {
    if (this.busy) return;
    this.busy = true;
    if (this.state.phase !== 'ready') this.setState({ phase: 'checking', error: undefined });
    try {
      // (packaged only: in a dev launch the bundle on disk is Electron itself)
      const onDisk = app.isPackaged ? this.installedVersion() : null;
      if (onDisk && cmp(onDisk, app.getVersion()) > 0) {
        // the new app is already installed under this (old) process: just restart
        const { response } = await dialog.showMessageBox({
          type: 'info',
          message: `Chilaka ${onDisk} is installed`,
          detail: 'Restart to finish updating. Your progress is kept.',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) {
          app.relaunch({ execPath: path.join(this.bundlePath(), 'Contents', 'MacOS', 'Chilaka') });
          app.exit(0);
        }
        return;
      }
      const res = await fetch(FEED, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'chilaka-updater' } });
      if (!res.ok) throw new Error(`release feed ${res.status}`);
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      const asset = (rel.assets || []).find((a) => /\.dmg$/i.test(a.name));
      if (!version || !asset) throw new Error('no installer in the latest release');
      // CHILAKA_UPDATE_TEST=0.0.1 makes a build think it is that old (manual QA of the update path)
      const current = process.env.CHILAKA_UPDATE_TEST || app.getVersion();
      if (cmp(version, current) <= 0) {
        this.available = null;
        this.setState({ phase: 'up-to-date', version: app.getVersion() });
        if (manual) {
          dialog.showMessageBox({ type: 'info', message: `Chilaka ${app.getVersion()} is up to date.` });
        }
        return;
      }
      if (this.staged && this.stagedVersion === version) {
        this.setState({ phase: 'ready', version, notes: String(rel.body || '') });
        return;
      }
      this.available = { version, url: asset.browser_download_url, size: asset.size, notes: String(rel.body || '') };
      this.setState({ phase: 'available', version, notes: this.available.notes, size: asset.size, received: 0, percent: 0 });
    } catch (err) {
      this.setState({ phase: 'error', error: String(err.message || err) });
      if (manual) dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates.', detail: String(err.message || err) });
    } finally {
      this.busy = false;
    }
    if (this.state.phase === 'available' && this.auto) void this.download();
  }

  /** Learner pressed Update (or auto-download is on): fetch and stage the new version. */
  async download() {
    if (this.busy) return;
    if (!this.available) return this.check(true); // "Try again" after a failed check

    this.busy = true;
    try {
      await this.downloadAndStage();
      this.setState({ phase: 'ready', version: this.stagedVersion, percent: 100 });
    } catch (err) {
      this.setState({ phase: 'error', error: String(err.message || err) });
    } finally {
      this.busy = false;
    }
  }

  /** Download the dmg to a temp folder and copy the app bundle out of it. */
  async downloadAndStage() {
    const u = this.available;
    if (!u || (this.staged && this.stagedVersion === u.version)) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chilaka-update-'));
    const dmg = path.join(dir, `Chilaka-${u.version}.dmg`);
    const res = await fetch(u.url, { headers: { 'user-agent': 'chilaka-updater' } });
    if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
    const total = u.size || Number(res.headers.get('content-length')) || 0;
    this.setState({ phase: 'downloading', version: u.version, size: total, received: 0, percent: 0 });
    const out = fs.createWriteStream(dmg);
    const reader = res.body.getReader();
    let got = 0;
    let lastTick = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      // ~5 updates a second is plenty for a progress bar
      const now = Date.now();
      if (now - lastTick > 200) {
        lastTick = now;
        this.setState({ received: got, percent: total ? Math.min(99, Math.floor((got / total) * 100)) : 0 });
      }
    }
    await new Promise((r) => out.end(r));
    if (u.size && got !== u.size) throw new Error(`download incomplete (${got} of ${u.size} bytes)`);
    // unpacking the installer is the last stretch; the bar sits at 99% until the bundle is staged
    this.setState({ received: got, percent: 99 });
    // mount, copy the bundle out, unmount
    const mount = path.join(dir, 'mnt');
    fs.mkdirSync(mount);
    await run('hdiutil', ['attach', '-nobrowse', '-quiet', '-readonly', '-mountpoint', mount, dmg]);
    try {
      const src = path.join(mount, 'Chilaka.app');
      if (!fs.existsSync(src)) throw new Error('installer has no Chilaka.app');
      const staged = path.join(dir, 'Chilaka.app');
      await run('ditto', [src, staged]);
      this.staged = staged;
      this.stagedVersion = u.version;
    } finally {
      await run('hdiutil', ['detach', '-quiet', mount]).catch(() => {});
      fs.rmSync(dmg, { force: true });
    }
  }

  /** Swap the staged bundle over the running one and relaunch. */
  async installAndRelaunch() {
    if (!this.staged) return;
    const target = this.bundlePath();
    const backup = `${target}.previous`;
    try {
      removeBundle(backup);
      fs.renameSync(target, backup);
      await run('ditto', [this.staged, target]);
    } catch (err) {
      // put the old app back if anything went wrong mid-swap
      if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
      this.setState({ phase: 'error', error: `Update failed: ${String(err.message || err)}` });
      return;
    }
    // the new app is in place; a leftover backup must never block the relaunch
    try {
      removeBundle(backup);
    } catch {
      /* cleaned up on the next update */
    }
    this.staged = null;
    app.relaunch({ execPath: path.join(target, 'Contents', 'MacOS', 'Chilaka') });
    app.exit(0);
  }

  /** On quit: if an update was staged but declined, install it quietly for next launch. */
  installStagedOnQuit() {
    if (!this.staged || !this.auto) return;
    const target = this.bundlePath();
    const backup = `${target}.previous`;
    let moved = false; // true only while the current app sits in `backup`
    try {
      // the staged copy lives in the temp folder, which macOS may have purged
      if (!fs.existsSync(this.staged)) return;
      removeBundle(backup);
      fs.renameSync(target, backup);
      moved = true;
      require('node:child_process').execFileSync('ditto', [this.staged, target]);
      moved = false;
    } catch {
      // the copy failed half way: put the current version back, never leave no app
      if (moved) {
        try {
          removeBundle(target);
          fs.renameSync(backup, target);
        } catch {
          /* nothing more we can do */
        }
      }
      return;
    }
    try {
      removeBundle(backup);
    } catch {
      /* cleaned up on the next update */
    }
  }

  openReleases() {
    void shell.openExternal(`https://github.com/${REPO}/releases/latest`);
  }
}

module.exports = { Updater, cmp, removeBundle };
