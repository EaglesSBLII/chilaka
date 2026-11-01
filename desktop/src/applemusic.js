// Remote-controls the macOS Music app via AppleScript so Apple Music
// playlists (DRM and all) can play faintly behind Chilaka. The DRM never
// leaves Apple's player — we only press its buttons.
//
// First use triggers macOS's one-time consent: "Chilaka wants to control
// Music" — the caller surfaces that as a friendly setup step.

const { execFile } = require('node:child_process');

function osa(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || '');
        if (/-1743|not authori[sz]ed/i.test(msg)) {
          reject(new Error('not-authorized'));
        } else {
          reject(new Error(msg.trim() || 'applescript failed'));
        }
        return;
      }
      resolve(stdout.trim());
    });
  });
}

const AppleMusic = {
  /** List the user's playlists (also serves as the permission trigger). */
  async playlists() {
    const out = await osa(
      'tell application "Music" to get name of every user playlist',
    );
    return out
      .split(', ')
      .map((s) => s.trim())
      .filter(Boolean);
  },

  async play(playlist, volume) {
    const vol = Math.max(0, Math.min(100, Math.round(volume)));
    const esc = String(playlist).replace(/"/g, '\\"');
    await osa(
      `tell application "Music"
         set sound volume to ${vol}
         play (get user playlist "${esc}")
       end tell`,
    );
  },

  async pause() {
    await osa('tell application "Music" to pause');
  },

  async resume() {
    await osa('tell application "Music" to play');
  },

  async setVolume(volume) {
    const vol = Math.max(0, Math.min(100, Math.round(volume)));
    await osa(`tell application "Music" to set sound volume to ${vol}`);
  },

  async stop() {
    // pause quietly; never quit the user's Music app
    await osa('tell application "Music" to pause').catch(() => {});
  },
};

module.exports = { AppleMusic };
