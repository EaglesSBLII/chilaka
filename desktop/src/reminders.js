// Wall-clock reminder scheduler. A 30s interval compares HH:MM against the
// enabled reminders; a fired-set keyed by (day, id) prevents repeats. Survives
// sleep because it never schedules into the future — powerMonitor 'resume'
// calls checkNow() with a grace window for reminders missed during sleep.
const fs = require('node:fs');

class ReminderScheduler {
  constructor({ storePath, onFire }) {
    this.storePath = storePath;
    this.onFire = onFire;
    this.reminders = [];
    this.fired = new Set(); // `${day}:${idx}`
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.storePath(), 'utf-8');
      this.reminders = JSON.parse(raw);
    } catch {
      this.reminders = [];
    }
  }

  persist() {
    try {
      fs.writeFileSync(this.storePath(), JSON.stringify(this.reminders, null, 2));
    } catch {
      // non-fatal
    }
  }

  setReminders(reminders) {
    this.reminders = Array.isArray(reminders) ? reminders : [];
    this.persist();
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.checkNow(0.6), 30_000);
    this.checkNow(0.6);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** graceMinutes: also fire reminders whose time passed within the window. */
  checkNow(graceMinutes) {
    const now = new Date();
    const day = now.toLocaleDateString('en-CA');
    const nowMin = now.getHours() * 60 + now.getMinutes();
    this.reminders.forEach((r, idx) => {
      if (!r || r.enabled === false) return;
      const rMin = (r.hh ?? 0) * 60 + (r.mm ?? 0);
      const key = `${day}:${idx}:${rMin}`;
      const withinWindow = nowMin >= rMin && nowMin - rMin <= Math.max(0.5, graceMinutes);
      if (withinWindow && !this.fired.has(key)) {
        this.fired.add(key);
        try {
          this.onFire(r);
        } catch {
          // notification failure is non-fatal
        }
      }
    });
    // GC old fired keys (keep only today's)
    for (const key of this.fired) {
      if (!key.startsWith(day)) this.fired.delete(key);
    }
  }
}

module.exports = { ReminderScheduler };
