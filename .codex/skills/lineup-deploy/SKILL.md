---
name: lineup-deploy
description: Deploy and troubleshoot the Lineup static soccer lineup PWA built from repository-root source files into a filtered static asset directory. Use when changing Cloudflare Pages settings, Wrangler settings, PWA service worker release behavior, or deployment support scripts in this repository.
---

# Lineup Deploy

## Deployment Model

Treat GitHub as the source of deployment. Code is pushed to GitHub, Cloudflare clones the repository, runs the configured commands, and publishes the generated static assets.

The app source files live at the repository root, but the publishable asset set is generated into `dist/` by `scripts/build.sh`. Do not publish the raw repository root, because transient install directories such as `node_modules/` can be mistaken for static assets by Wrangler.

Do not maintain `dist/` by hand for routine development, UI changes, PWA shell changes, or verification. Regenerate it with `npm run build`.

Lineup is static. There is no backend deployment, database migration, or server-side state. Browser state lives in `localStorage`.

## Standard Workflow

1. Inspect `README.md` before changing deployment behavior.
2. Run `npm run build` locally after deployment support changes.
3. Commit and push to GitHub. Cloudflare should deploy from that push.

Recommended Cloudflare Pages settings:

- Root directory: `/`
- Build command: `npm run build`
- Build output directory: `dist`
- Deploy command: none

Prefer Cloudflare Pages without a deploy command. The repo also includes `wrangler.jsonc` as a guardrail for existing `npx wrangler deploy` settings: it runs `bash scripts/build.sh` and pins `assets.directory` to `dist`.

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

If Cloudflare logs show `Asset too large` for a file under `node_modules/`, Cloudflare is publishing the raw repository root. Ensure `wrangler.jsonc` is present on the deployed branch, or configure Pages to use build command `npm run build`, output directory `dist`, and no deploy command.

If mobile Chrome shows an old version after deployment, bump `CACHE_NAME` in `sw.js` if needed.
