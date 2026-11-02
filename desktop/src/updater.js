// Self-updater for the Mac app. Checks the GitHub release feed on launch and
// every few hours, downloads a newer installer in the background, stages the
// new app bundle, and swaps it in when the learner says yes (or silently at the
// next quit). No code-signing identity is needed: the app is ad-hoc signed, and
// a bundle copied into place by the app itself carries no quarantine flag.
//
// Settings live in <userData>/updater.json: { auto: true }.

const { app, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const REPO = 'EaglesSBLII/chilaka';
const FEED = `https://api.github.com/repos/${REPO}/releases/latest`;
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
    this.settings = { auto: true };
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
  }

  get auto() {
    return this.settings.auto !== false;
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

  /** Look for a newer release. manual=true also reports "up to date". */
  async check(manual = false) {
    if (this.busy) return;
    this.busy = true;
    try {
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
        if (manual) {
          dialog.showMessageBox({ type: 'info', message: `Chilaka ${app.getVersion()} is up to date.` });
        }
        return;
      }
      this.available = { version, url: asset.browser_download_url, size: asset.size, notes: String(rel.body || '') };
      this.onState(this.available);
      if (this.auto || manual) await this.downloadAndStage();
      if (this.staged) this.offerInstall();
    } catch (err) {
      if (manual) dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates.', detail: String(err.message || err) });
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
    const out = fs.createWriteStream(dmg);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((r) => out.end(r));
    if (u.size && got !== u.size) throw new Error(`download incomplete (${got} of ${u.size} bytes)`);
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

  offerInstall() {
    const u = this.available;
    dialog
      .showMessageBox({
        type: 'info',
        message: `Chilaka ${u.version} is ready to install`,
        detail: `${u.notes.slice(0, 600)}\n\nThe app restarts to finish. Your progress is kept.`,
        buttons: ['Restart and update', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) void this.installAndRelaunch();
      });
  }

  /** Swap the staged bundle over the running one and relaunch. */
  async installAndRelaunch() {
    if (!this.staged) return;
    const target = this.bundlePath();
    const backup = `${target}.previous`;
    try {
      fs.rmSync(backup, { recursive: true, force: true });
      fs.renameSync(target, backup);
      await run('ditto', [this.staged, target]);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (err) {
      // put the old app back if anything went wrong mid-swap
      if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
      dialog.showMessageBox({ type: 'error', message: 'Update failed', detail: String(err.message || err) });
      return;
    }
    this.staged = null;
    app.relaunch({ execPath: path.join(target, 'Contents', 'MacOS', 'Chilaka') });
    app.exit(0);
  }

  /** On quit: if an update was staged but declined, install it quietly for next launch. */
  installStagedOnQuit() {
    if (!this.staged || !this.auto) return;
    const target = this.bundlePath();
    try {
      const backup = `${target}.previous`;
      fs.rmSync(backup, { recursive: true, force: true });
      fs.renameSync(target, backup);
      require('node:child_process').execFileSync('ditto', [this.staged, target]);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      /* leave the current version in place */
    }
  }

  openReleases() {
    void shell.openExternal(`https://github.com/${REPO}/releases/latest`);
  }
}

module.exports = { Updater, cmp };
