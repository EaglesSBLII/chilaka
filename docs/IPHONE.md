# Chilaka on your iPhone 🦜📱

Chilaka runs on iPhone as an installable web app (PWA). You add it to your Home
Screen once and it behaves like a downloaded app: full-screen, its own icon,
**works completely offline**, and keeps all your progress on the phone. **It is
never on the App Store** — you install it from a private link only you know.

Everything on iPhone is free. The one difference from the Mac app: **speaking
practice uses "echo mode"** (record yourself, play it back against the native
reference, self-grade) instead of AI pronunciation scoring. The AI word-by-word
feedback needs the desktop speech engine and lives in the Mac app. Everything
else — all lessons, listening, word-bank, typing, review, streaks, dialogues —
is identical.

## Why it needs a link (not just AirDrop)

iOS only lets a web app install to the Home Screen (with offline support) when
it's served over **HTTPS**. So we put the built app on free hosting once, and you
install from that URL. After the first load, nothing is downloaded again — it's
all cached on your phone.

## Step 1 — Put Chilaka online (one time, ~3 minutes, free)

On your Mac, in the project folder:

```bash
bash tools/deploy-pwa.sh
```

It builds the app and prints the exact commands for a free host. The easiest is
**Cloudflare Pages**:

```bash
npm i -g wrangler
npm run build -w app
wrangler pages deploy app/dist --project-name chilaka
```

The first run opens a browser to create/sign in to a **free** Cloudflare account.
You'll get a private URL like `https://chilaka.pages.dev`. Only people you send it
to will ever find it.

> Quick preview without hosting: `node tools/serve-pwa.mjs` serves it on your
> Wi-Fi so you can *see* it in your iPhone's Safari — but Home-Screen install +
> offline needs the HTTPS URL above.

## Step 2 — Install on your iPhone

1. Open the URL (e.g. `https://chilaka.pages.dev`) in **Safari** (must be Safari).
2. Tap the **Share** button (□ with an ↑).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. The Chikki parrot icon appears on your Home Screen.
5. Open it from the Home Screen — it launches full-screen like a real app.

## Step 3 — Bring your progress over from the Mac (optional)

If you've already been learning on the Mac and want to continue on your phone:

1. Mac: **Settings → Backup & sync → Export backup** → AirDrop the file to your iPhone.
2. iPhone: open Chilaka → **Settings → Backup & sync → Import backup** → pick the file.

Your streak, XP, level, and review deck all carry over. (There's no automatic
cloud sync — this keeps everything private on your devices. Re-export whenever you
want to move progress again.)

## Step 4 — Daily reminders on iPhone

**Easiest (push notifications):** once Chilaka is on your Home Screen, open Settings in the app → Account → create or sign in, then Settings → Daily reminders → turn on *Push reminders on this device* and allow notifications. Chilaka sends one nudge at the chosen time on days you have not practised (nothing if you already did your lesson). The older Shortcuts route below still works if you prefer no account.

iOS doesn't let a web app schedule its own alarms reliably, so set a **Shortcuts
automation** — it's free, built in, and rock-solid:

1. Open the **Shortcuts** app → **Automation** tab → **+** → **Create Personal Automation**.
2. Choose **Time of Day** → pick your practice time (e.g. 7:30 PM) → **Daily** → Next.
3. Add action **Open App** (or **Open URL** with your Chilaka link) → choose Chilaka.
4. Turn **OFF** "Ask Before Running" → Done.

Now your phone opens Chilaka at that time every day. Add more automations for
multiple reminders. (The reminder times you set inside Chilaka's Settings still
save with your profile so they travel in your backup.)

## Updating the app later

When there's a new version, just re-run the deploy command from Step 1. Your
iPhone picks up the update automatically the next time it's online (your progress
is untouched).

## Troubleshooting

| Problem | Fix |
|---|---|
| "Add to Home Screen" is missing | You must use **Safari**, not Chrome/Firefox on iOS. |
| Microphone doesn't work in echo mode | iOS asks permission each session in an installed PWA — tap **Allow**. If it never asks: iPhone Settings → Safari → Microphone → Allow. |
| App seems stuck on an old version | Open it while online once; the service worker updates in the background, then relaunch. |
| Lost progress after clearing Safari data | Import your latest backup (Step 3). Export backups regularly to be safe. |
