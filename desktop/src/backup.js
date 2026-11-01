// Rotating on-disk backups of the renderer's exported state.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 14;

function writeBackup(dir, json) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `chilaka-backup-${stamp}.json`);
  fs.writeFileSync(file, json);
  // rotate: newest KEEP stay
  const all = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('chilaka-backup-') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const old of all.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch {
      // ignore
    }
  }
  return file;
}

module.exports = { writeBackup };
