# Lineup

Lineup is a single-page roster, formation, and live playtime tracker for soccer coaches. It is designed to be usable before a match and during live play, with local roster management, a running game clock, staged substitutions, and position history.

The app is static HTML, CSS, and JavaScript. There is no backend. Player and match state are stored in the browser with `localStorage`, so data is local to the device and browser profile.

## Features

- Roster screen for player names, active status, playtime, position history, and sortable columns.
- Formation screen with soccer notation such as `G-2-3-1` when using a goalie, or `2-3-1` and `4-3-3` without one.
- Drag-and-drop player chips for assigning players to field positions.
- Pending substitutions panel showing players going in, players coming out, and drag-to-bench changes.
- Staged substitutions with a set-lineup action that records live stints.
- Match clock with play/pause, period advance, and reset controls.
- Match log reset for starting a new game with players back on the bench.
- PWA manifest, install icons, and service worker for mobile installation.

## Local Development

Open `index.html` directly in a browser.

## Scripts

- `npm test`: runs the dependency-free Node test suite for the lineup core.
- `npm run build`: verifies the static deploy root is safe to publish.

The test suite uses Node's built-in `node:test` runner and also runs the static deploy verification. The project has no third-party dependencies.

## Cloudflare Deployment

The deployment path is GitHub to Cloudflare Pages. Push to GitHub, and let Cloudflare build from the repository.

Recommended Cloudflare Pages build settings:

- Root directory: `/`
- Build command: none
- Build output directory: `/`

Do not use a deploy command for this project. Cloudflare Pages should publish the repository root.
Run `npm run build` locally before changing deployment settings; it checks for accidental Wrangler setup, dependencies, missing app shell files, and assets over Cloudflare's 25 MiB limit.

## Custom Domain

DNS records point hostnames to other hostnames or addresses; they do not point to full URLs like `https://lineup.mann-f1a.workers.dev/`.

For `lineup.mann.engineer`, add a custom domain to the Cloudflare Pages project if `mann.engineer` is an active zone in Cloudflare:

1. Go to Cloudflare Workers & Pages.
2. Open the `lineup` Pages project.
3. Go to Custom domains.
4. Add a Custom Domain for `lineup.mann.engineer`.

Cloudflare will create or guide the needed DNS record and issue the certificate.

## PWA Notes

The PWA files are `manifest.webmanifest`, `sw.js`, `_headers`, and the icons in `assets/`.

When changing files listed in the service worker app shell, bump `CACHE_NAME` in `sw.js` if installed clients need to pick up the new cache immediately. `_headers` keeps the service worker and manifest uncached by the CDN so app updates can be detected reliably.

On Android Chrome, open the deployed HTTPS URL and use the browser menu to install the app.

## License

MIT. See [LICENSE](LICENSE).
