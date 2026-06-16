#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/assets"

for file in index.html styles.css lineup-core.js app.js sw.js manifest.webmanifest _headers; do
  cp "$ROOT_DIR/$file" "$DIST_DIR/$file"
done

for file in icon.svg icon-192.png icon-512.png apple-touch-icon.png; do
  cp "$ROOT_DIR/assets/$file" "$DIST_DIR/assets/$file"
done

node "$ROOT_DIR/scripts/verify-static-deploy.js" dist
printf 'Built %s\n' "$DIST_DIR"
