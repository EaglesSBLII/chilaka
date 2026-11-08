# Putting Chilaka on your iPhone — the Cloudflare step 🦜📱

Cloudflare is the free service that will (1) host the app at a private HTTPS
link so your iPhone can install it, (2) run the tiny sync server that keeps
your Mac and iPhone progress identical, and (3) run the speech recognition
that scores your pronunciation on the phone. **All three fit in the free tier
— no credit card, no charges.**

The whole thing is ONE command plus one browser login. ~5 minutes.

## Step 1 — Open Terminal in the project

Open the **Terminal** app and paste:

```bash
cd "/Users/Arnav/Downloads/Claude Code test"
bash tools/deploy-iphone.sh
```

## Step 2 — The browser login (the only part that needs you)

- A browser tab opens at Cloudflare.
- **No account yet?** Click **Sign up** — email + password, free plan. No card.
- **Have an account?** Just log in.
- Cloudflare asks: *"Allow Wrangler to make changes to your account?"* →
  scroll down → click **Allow**.
- Return to Terminal. Everything after this is automatic: it creates the
  storage, deploys the sync + speech server, builds the app, and publishes it.

## Step 3 — Copy the URL it prints

At the end the script prints:

```
======================================================
  iPhone install URL:  https://chilaka-XXX.pages.dev
  Sync server:         https://chilaka-sync.XXX.workers.dev
======================================================
```

Tell Claude it finished (paste the two URLs). Claude then rebuilds the Mac
app with sync built in and verifies the live deployment end-to-end.

## Step 4 — Install on the iPhone (30 seconds)

1. On your iPhone, open the **install URL in Safari** (must be Safari).
2. Tap **Share** (□↑) → **Add to Home Screen** → **Add**.
3. Open Chilaka from your Home Screen. Done — it works offline from now on.

## Step 5 — Pair the two devices (30 seconds, once)

1. Mac app → **Settings → 🔄 Sync → Turn on sync** → **Pair another device** → **Copy**.
2. Send the code to your phone (iMessage to yourself works).
3. iPhone Chilaka → **Settings → 🔄 Sync** → paste → **Pair**.

That's it. From then on your streak, XP, lessons, and review deck stay
identical on both, automatically, in both directions.

## What lives where (privacy)

- The app URL is unlisted — only people you give it to will find it.
- Your progress data syncs through YOUR Cloudflare account, stored under a
  secret 224-bit key that exists only on your two devices.
- Phone speaking practice sends the recording to your own worker for
  transcription (Cloudflare AI), then discards it. On the Mac, speech never
  leaves the machine at all.

## Accounts (D1) — optional, for sign-in and reminders

Pairing by key (above) needs nothing more. If you also want **sign in on any
device** and **daily push reminders**, give the worker a tiny database. Once:

```bash
cd sync-worker
npx wrangler d1 create chilaka
```

It prints a `database_id`. In `sync-worker/wrangler.toml`, uncomment the
`[[d1_databases]]` block and paste the id in place of
`PASTE-YOUR-DATABASE-ID-HERE`, commit, push. The deploy workflow then applies
`sync-worker/migrations/` (`wrangler d1 migrations apply chilaka --remote`)
before every deploy, and the cron trigger (`*/15 * * * *`) starts sweeping
reminders. The GitHub `CLOUDFLARE_API_TOKEN` needs **D1:Edit** as well.

How accounts work (no email is ever sent):

- Your password never leaves the device. The app derives a key from it
  (PBKDF2) and sends only that; the server stores a salted hash of the key.
  Nobody — including the worker — can read your password.
- Because there is no email delivery, there is no "forgot password" link.
  Instead, sign-up shows a one-time **recovery code**
  (`XXXX-XXXX-XXXX-XXXX-XXXX`). Save it somewhere safe. It is the only way to
  set a new password; using it signs out every device and issues a fresh code.
  Lose both the password and the code and the account cannot be recovered
  (your progress on paired devices is unaffected — it is still on them).
- Signing up on an already-paired device adopts that device's existing sync
  key, so progress carries over; the data moves from KV into D1 once.
- Reminders: the app registers a Web Push subscription with your local time
  zone and preferred hour. The worker sends one nudge in that 15-minute
  window, skips the day entirely if you already practised, and drops
  subscriptions the push service reports as expired. Push keys (VAPID) and the
  sign-in signing secret are generated automatically on first use and kept in
  KV under `cfg:*`.

## If something goes wrong

| Problem | Fix |
|---|---|
| Browser never opens | Copy the URL Terminal prints and open it manually. |
| "wrangler: command not found" | The script uses `npx` — make sure you ran it from the project folder with the `cd` line above. |
| Script says it can't find a URL | Paste the full Terminal output to Claude. |
| Safari shows no "Add to Home Screen" | You're in Chrome — use Safari. |
| Sign-up says "accounts unavailable" | The worker has no D1 database yet — see "Accounts (D1)" above. |
| Deploy fails at "d1 migrations apply" | the `[[d1_databases]]` block in `sync-worker/wrangler.toml` is uncommented but the id is wrong, or the API token lacks D1:Edit. |
