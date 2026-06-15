# Lineup

Lineup is a single-page roster, formation, and live playtime tracker for soccer coaches. It is designed to be usable before a match and during live play, with local roster management, a running game clock, staged substitutions, and position history.

The app is static HTML, CSS, and JavaScript. There is no backend. Player and match state are stored in the browser with `localStorage`, so data is local to the device and browser profile.

## Features

- Roster screen for player names, active status, playtime, position history, and new-game time resets.
- Formation screen with soccer notation such as `2-3-1` or `4-3-3`.
- Drag-and-drop player chips for assigning players to field positions.
- Staged substitutions with a set-lineup action that records live stints.
- Match clock with play/pause, period advance, and reset controls.
- PWA manifest, install icons, and service worker for mobile installation.

## Local Development

Open `index.html` directly in a browser, or run the static build and serve the `dist/` folder:

```bash
bash scripts/build.sh
python3 -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

## Scripts

- `bash scripts/build.sh`: copies only public app assets into `dist/`.

## Cloudflare Deployment

The deployment path is GitHub to Cloudflare Pages. Push to GitHub, and let Cloudflare build from the repository.

Recommended Cloudflare Pages build settings:

- Root directory: `/`
- Build command: `bash scripts/build.sh`
- Build output directory: `dist`

Do not use a deploy command for this project. The build creates `dist/`, and Cloudflare Pages publishes that directory.

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
