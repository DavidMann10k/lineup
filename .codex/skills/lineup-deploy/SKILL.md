---
name: lineup-deploy
description: Deploy and troubleshoot the Lineup static soccer lineup PWA served from the repository root. Use when changing Cloudflare Pages settings, PWA service worker release behavior, or deployment support scripts in this repository.
---

# Lineup Deploy

## Deployment Model

Treat GitHub as the source of deployment. Code is pushed to GitHub, Cloudflare clones the repository, runs the configured commands, and publishes the generated static assets.

Publish the repository root. The app is intentionally served from root `index.html`.

Do not maintain `dist/` for routine development, UI changes, PWA shell changes, or verification. There is no build script; root files are the published app shell.

Lineup is static. There is no backend deployment, database migration, or server-side state. Browser state lives in `localStorage`.

## Standard Workflow

1. Inspect `README.md` before changing deployment behavior.
2. Commit and push to GitHub. Cloudflare should deploy from that push.

Recommended Cloudflare Pages settings:

- Root directory: `/`
- Build command: none
- Build output directory: `/`

Do not use Wrangler or a deploy command for this project.

## Custom Domain

For `lineup.mann.engineer`, use a custom domain on the `lineup` Cloudflare Pages project. Do not describe it as a DNS record pointing to a deployed URL; DNS cannot point at a URL.

Dashboard path:

1. Open Cloudflare Workers & Pages.
2. Select the `lineup` Pages project.
3. Open Custom domains.
4. Add a Custom Domain for `lineup.mann.engineer`.

Cloudflare will create or guide the needed DNS record and issue the certificate.

## PWA Release Notes

When changing app shell files, keep `sw.js` aligned with the files that must work offline. Bump `CACHE_NAME` when installed clients need to take a fresh cache.

Keep `_headers` configured with no-cache rules for `/sw.js` and `/manifest.webmanifest`, so Cloudflare does not prevent update detection.

## Troubleshooting

If Cloudflare is configured to publish `dist/`, change the Pages build output directory to `/`.

If mobile Chrome shows an old version after deployment, bump `CACHE_NAME` in `sw.js` if needed.
