# Owner dashboard (private)

A separate small app, only for the owner: <https://chilaka-admin.kandikonda-arnav.workers.dev>

It shows three things and nothing else:

- **Account emails**: the email of every Chilaka account. No passwords, progress or other data
  ever leaves the database (the query selects the `email` column only).
- **Visitors**: the visit log of the website and the app, newest first, refreshed every
  30 seconds while the page is open. Visits from data-centre networks or with no real browser
  are marked "automated" and hidden by default.
- **GitHub**: stars and Mac-app download counts, plus repository page views if connected.

## Set your password (once)

The dashboard answers nothing until a password exists. In Terminal, in the project folder:

```bash
node tools/admin-password.mjs
```

It asks for a password (at least 12 characters, not shown while typing) and stores only a
salted one-way hash with Cloudflare, as the `ADMIN_PASSWORD_HASH` secret of the `chilaka-admin`
worker. The password is not saved on this Mac, in the repository or on the server. Run the same
command again to change it; that also signs out every open session.

If it says you are logged out of Cloudflare, run `npx wrangler login` first.

## How it is protected

- The password is stretched in your browser (PBKDF2, 600,000 rounds); only the result is sent,
  over HTTPS, and compared with the stored hash.
- Five wrong tries from one address lock that address out for 15 minutes.
- A session lasts 12 hours, in a cookie that scripts cannot read and other sites cannot send.
- The page is marked no-index and the code is public, but there is no data in the code: without
  the password every data request answers "not signed in".
- There is no password reset. If you forget it, run the command above to set a new one (that
  needs your Cloudflare login, which is the real root of trust).

## GitHub page views (optional)

GitHub shares repository traffic only with the owner, and only as daily totals for the last
14 days. It never lists individual visitors. To show those totals:

1. On GitHub: Settings → Developer settings → Fine-grained tokens → Generate new token.
   Repository access: only `EaglesSBLII/chilaka`. Permissions: Administration → Read-only.
2. In Terminal, in the `admin-worker` folder, run the command below and paste the token when asked:

```bash
npx wrangler secret put GITHUB_TOKEN
```

## Limits

- "Live" means checked every 30 seconds; Cloudflare's storage can take up to a minute to show a
  new visit.
- Visits are counted by an anonymous id that changes daily, so the same person on two days
  counts twice. No IP addresses are stored.
- The free Cloudflare plan allows about 1,000 visit-list reads a day: roughly eight hours of
  the page being open and visible.
