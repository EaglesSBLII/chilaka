# Sharing Chilaka 🦜

Everyone gets their own separate progress automatically — data lives on each
person's own device. Your sync pairing code is the only thing that connects a
device to YOUR data; never share that code, and there is nothing else to set up.

## Copy-paste invite (iMessage-ready)

> Hey — I've been learning Telugu with this app, try it:
>
> **iPhone:** open https://chilaka.pages.dev in **Safari** → tap Share (□↑) →
> **Add to Home Screen** → Add. Open it from the home screen once on Wi-Fi and
> it works offline forever after.
>
> It has speaking practice with AI feedback, listening, streaks, the works.
> In Settings → Sync, hit "Turn on sync" — that also unlocks the AI
> pronunciation scoring on the phone. Everything is free.

## If they also want the Mac app

AirDrop them two files from your Mac:
- `~/Downloads/Chilaka.dmg`
- `docs/INSTALL-MAC.md` (the one-time "Open Anyway" steps — macOS blocks
  unsigned apps on first launch)

Needs an Apple Silicon Mac (M1 or newer). Their Mac progress is separate from
yours too; if they want their own Mac↔iPhone sync, they use their own pairing
code from their own Settings — same as you did.

## Capacity (free tier, verified July 2026)

- **The app itself: unlimited users.** Lessons, audio, streaks, echo speaking all
  run on each person's device — sharing the link costs you nothing.
- **Sync: ~50–100 daily-active users.** Each active user costs ~5–10 of the free
  tier's 1,000 storage-writes/day (no-change opens cost zero).
- **Phone AI speech scoring: the tightest quota.** The free Workers AI allocation
  resets daily; ~15–40 heavy daily speakers fit. Past it, phones gracefully fall
  back to echo practice until the next day (nothing breaks). Per-person daily
  caps (250 clips) and burst limits keep any one user from draining it.
- **If you outgrow free:** Cloudflare's $5/month tier multiplies these ceilings
  ~1000× with zero code changes.

## Notes for you (the app owner)

- Their sync data (if they enable sync) is stored in your Cloudflare account's
  storage under their own random key — the free tier is far more than enough
  for the whole family, and their key is theirs (you'd have to go digging in
  your Cloudflare dashboard to even see the encrypted-looking blobs).
- Phone AI speech scoring runs through your worker's free AI allocation —
  ~10 people practicing daily still fits comfortably.
- If you ever update the app (I redeploy it), everyone gets the update
  automatically next time they open it online — no reinstall.
