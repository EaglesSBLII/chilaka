# Chilaka 🦜 — Learn to Speak Telugu

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

## Adding content

1. Add `app/content/units/uXX.json` (copy the shape of `u01.json`). You author **Telugu script only** — romanization is derived automatically so spelling always matches.
2. `npm test -w app` — the content gate validates schema, word breakdowns, lesson coverage, distractors.
3. `node tools/render-audio.mjs` — renders missing audio clips.
4. Rebuild.

## Models (already fetched/converted — for reference)

- ASR: `vasista22/whisper-telugu-medium` → GGML q5_0 via `vendor/setup-asr.sh` (whisper.cpp + Python venv)
- TTS: Meta MMS Telugu VITS (sherpa-onnx ONNX build, from `willwade/mms-tts-multilingual-models-onnx`)
- Runtime binaries: `desktop/resources/bin` (whisper-server + Metal dylibs, portable rpath)

## Layout

```
app/       shared web app (React+TS+Vite) — runs in Electron AND as the iPhone PWA
desktop/   Electron shell: whisper ASR server, sherpa TTS, tray reminders, backups
tools/     content validator, TTS audio renderer, icon rasterizer
docs/      INSTALL-MAC.md (sharing), IPHONE.md (mobile install)
vendor/    model build pipeline (gitignored artifacts)
```
