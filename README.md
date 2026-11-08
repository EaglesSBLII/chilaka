# Chilaka 🦜 — Learn to Speak Telugu

**Try it:** [chilaka.pages.dev](https://chilaka.pages.dev) (iPhone and any desktop browser; on iPhone, open in Safari → Share → Add to Home Screen) ·
**Mac app:** [download Chilaka.dmg](https://github.com/EaglesSBLII/chilaka/releases/latest) (Apple Silicon) ·
**Website:** [chilaka-site.kandikonda-arnav.workers.dev](https://chilaka-site.kandikonda-arnav.workers.dev) · [How it was built](https://chilaka-site.kandikonda-arnav.workers.dev/how-i-built-it/)

Windows: there is no Windows build yet; the web app above works in Chrome or Edge on Windows (speaking practice uses echo mode there).

A free, private, Duolingo-style app that takes you from "broken Telugu" to holding real conversations — built for daily 30–45 min practice with a December fluency goal.

**Everything runs on your Mac. No accounts, no servers, no fees. Your voice and progress never leave your devices.**

## What's inside

- **24 units / 3 sections, ~390 phrases** of natural spoken Telugu (transliteration-first, Telugu script toggle), each with native-quality TTS audio
- **7 exercise types**: flashcard intro, multiple choice (read/listen), word-bank sentence building, type-what-you-hear (forgiving spelling), **speaking with AI pronunciation feedback**, and **dialogue roleplay** scenes
- **Speaking feedback**: your mic audio is transcribed on-device by a Telugu-fine-tuned Whisper model (IIT Madras) running on Apple Metal; you get word-by-word green/amber/red feedback plus replay-yours-vs-reference
- **Gamification**: XP with daily goals, streaks with auto streak-freezes, 10 Telugu-flavored levels, adaptive placement test, spaced-repetition review deck (FSRS — the modern Anki algorithm)
- **Reminders**: customizable daily notification times; the app lives in your menu bar so they fire even with the window closed
- **Durable data**: IndexedDB + rotating on-disk backups every 10 minutes (`~/Library/Application Support/@chilaka/desktop/backups/`), plus manual export/import for Mac↔iPhone sync

## Using it

- **Accounts (free):** Settings → Account → Create account. Email + password; nothing is emailed. You get a one-time recovery code at signup — it is the only way back in if you forget the password. Signing in on another device merges progress both ways. Pairing with a code (no account) still works under Settings → Advanced.
- **Coins, quests, badges, shop:** every lesson pays coins (bonuses for a perfect run, the daily goal and streak milestones); two quests a day open a chest; eight tiered badges; coins buy streak freezes, outfits for Chikki and accent themes.
- **Reminders on iPhone:** install to the Home Screen, sign in, then Settings → Daily reminders → Push reminders. A nudge arrives at your chosen time only on days you have not practised.

The installable app: **`desktop/dist-electron/Chilaka-0.1.0-arm64.dmg`**
Open it, drag **Chilaka** to Applications. Sharing with family: AirDrop the .dmg + `docs/INSTALL-MAC.md` (they need a one-time "Open Anyway" in System Settings since it's not App-Store signed).

iPhone version: see **`docs/IPHONE.md`**.

## Development

```bash
npm install                  # all workspaces
npm run dev                  # web app on vite dev server
npm test                     # 239 unit + content tests
npm run e2e -w app           # Playwright end-to-end suite
npm run smoke -w desktop     # Electron integration suite (real ASR/TTS)
npm run dist:mac             # build the .dmg (app build + electron-builder + sign)
```

After `npm run dist`, re-sign + repackage happens via:
```bash
cd desktop/dist-electron/mac-arm64 && codesign --force --deep --sign - Chilaka.app
cd .. && hdiutil create -volname "Chilaka" -srcfolder mac-arm64/Chilaka.app -ov -format UDZO Chilaka-0.1.0-arm64.dmg
```

## Updates

- **Updates are manual, with a banner.** The Mac app checks the GitHub release feed on launch and every 6 hours; a green banner at the top of the home screen says a version is available, **Update** downloads it with a live percentage, and **Restart** swaps it in (tray menu → "Check for updates…" to force a check, "Download updates automatically" to skip the Update press). The iPhone/web app downloads a new version in the background, shows the same progress, and switches only when you press **Restart**. QA: `desktop/tests/update-flow.spec.mjs` (fake release feed) and `app/tests/e2e/pwa-update.spec.ts`.
- **Web / iPhone**: `.github/workflows/deploy-web.yml` publishes `app/dist` to Cloudflare Pages and redeploys `sync-worker/` on every push to `main`. It needs two repository secrets, `CLOUDFLARE_API_TOKEN` (Pages: Edit, Workers Scripts: Edit) and `CLOUDFLARE_API_ACCOUNT_ID`. Installed web apps pick the new build up on their next launch.
- **Releasing a Mac build**: bump the version in the three `package.json` files, `npm run build -w app`, `cd desktop && npm run dist`, re-sign + repackage (below), then `gh release create vX.Y.Z Chilaka-X.Y.Z-arm64.dmg`. Running apps find it within 6 hours.

## Adding content

1. Add `app/content/units/uXX.json` (copy the shape of `u01.json`). You author **Telugu script only** — romanization is derived automatically so spelling always matches.
2. `npm test -w app` — the content gate validates schema, word breakdowns, lesson coverage, distractors.
3. `node tools/render-voice.mjs --voice female` and `--voice male` — render missing clips in both native voices (AI4Bharat IndicF5 cloned from short OpenSLR Telugu references in `tools/voice-ref/`, CC BY-SA 4.0). Each take is checked by the recognizer, decoding exactly as the app grades (greedy + lesson-context prompt); misheard takes re-roll, winners get the polish pass (0.26 s lead-in, 0.4 s tail, −15 LUFS) and land in `app/public/audio/v-<voice>/`. The per-voice `reference-transcripts-<voice>.json` (the grader's calibration) is refreshed at the same time.
4. Rebuild. The learner picks the voice in Settings (female by default); dialogue characters keep their own gender's voice.

## Models (already fetched/converted — for reference)

- ASR: `vasista22/whisper-telugu-medium` → GGML q5_0 via `vendor/setup-asr.sh` (whisper.cpp + Python venv)
- TTS: AI4Bharat IndicF5 (`vendor/f5-venv`, Python 3.11, gated HF repo) cloned from OpenSLR SLR66 speakers; earlier courses used AI4Bharat vits_rasa_13 (`tools/rasa-render.py`) and Meta MMS
- Runtime binaries: `desktop/resources/bin` (whisper-server + Metal dylibs, portable rpath)

## Layout

```
app/       shared web app (React+TS+Vite) — runs in Electron AND as the iPhone PWA
desktop/   Electron shell: whisper ASR server, sherpa TTS, tray reminders, backups
tools/     content validator, TTS audio renderer, icon rasterizer
docs/      INSTALL-MAC.md (sharing), IPHONE.md (mobile install)
vendor/    model build pipeline (gitignored artifacts)
```
