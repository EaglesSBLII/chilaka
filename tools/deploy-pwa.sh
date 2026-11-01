#!/bin/bash
# Deploys the built Chilaka PWA to free, permanent, private HTTPS hosting so you
# can install it on your iPhone. Pick ONE provider below — each is free and
# gives an unlisted URL only people you share it with will know.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/app/dist"

echo "Building the PWA…"
npm run build -w app >/dev/null
echo "Built → $DIST"
echo

cat <<'EOF'
Choose a free host (all give a permanent HTTPS URL, no cost):

  1) Cloudflare Pages   (recommended — fast, private, generous free tier)
       npm i -g wrangler
       wrangler pages deploy app/dist --project-name chilaka
     First run opens a browser to log in to a free Cloudflare account.
     You get a URL like  https://chilaka.pages.dev

  2) Netlify
       npm i -g netlify-cli
       netlify deploy --dir app/dist --prod
     Free account; URL like  https://chilaka.netlify.app

  3) GitHub Pages
       Put app/dist on a gh-pages branch of a (public or private) repo,
       enable Pages in the repo settings. URL like
       https://<you>.github.io/chilaka

  4) Vercel
       npm i -g vercel
       vercel deploy app/dist --prod

Then open the URL on your iPhone in Safari and follow docs/IPHONE.md
(Share → Add to Home Screen). After the first load it works fully offline.
EOF
