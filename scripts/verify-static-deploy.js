"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const maxAssetBytes = 25 * 1024 * 1024;

const requiredRootFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "lineup-core.js",
  "manifest.webmanifest",
  "sw.js",
  "_headers",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png",
];

const blockedRootEntries = [
  "node_modules",
  ".wrangler",
  ".dev.vars",
  "wrangler.json",
  "wrangler.jsonc",
  "wrangler.toml",
];

const ignoredAssetRoots = new Set([".git", ".codex", ".agents"]);
const failures = [];

function fail(message) {
  failures.push(message);
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function formatBytes(bytes) {
  const mib = bytes / (1024 * 1024);
  return `${mib.toFixed(1)} MiB`;
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function checkRequiredFiles() {
  for (const file of requiredRootFiles) {
    if (!exists(file)) fail(`Missing required deploy asset: ${file}`);
  }
}

function checkPackageScripts() {
  const pkg = JSON.parse(readText("package.json"));
  const dependencyNames = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));

  if (dependencyNames.length) {
    fail(`This static app should not need npm dependencies. Found: ${dependencyNames.join(", ")}`);
  }

  for (const [name, command] of Object.entries(pkg.scripts || {})) {
    if (/\bwrangler\b/.test(command)) {
      fail(`Do not use Wrangler in package script "${name}". Cloudflare Pages should publish the repository root.`);
    }
  }
}

function checkBlockedRootEntries() {
  for (const entry of blockedRootEntries) {
    if (exists(entry)) {
      fail(`Blocked deploy-root entry found: ${entry}`);
    }
  }
}

function checkServiceWorkerShell() {
  const sw = readText("sw.js");
  const match = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  if (!match) {
    fail("Could not find APP_SHELL in sw.js.");
    return;
  }

  for (const item of match[1].matchAll(/"([^"]+)"/g)) {
    const shellPath = item[1].replace(/^\.\//, "");
    if (!exists(shellPath)) fail(`Service worker APP_SHELL references missing file: ${item[1]}`);
  }
}

function walkAssets(relativeDir = "") {
  const absoluteDir = path.join(repoRoot, relativeDir);
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    const rootName = relativePath.split(path.sep)[0];

    if (ignoredAssetRoots.has(rootName)) continue;
    if (blockedRootEntries.includes(rootName)) continue;

    const absolutePath = path.join(repoRoot, relativePath);
    if (entry.isDirectory()) {
      walkAssets(relativePath);
      continue;
    }

    if (!entry.isFile()) continue;

    const size = fs.statSync(absolutePath).size;
    if (size > maxAssetBytes) {
      fail(`Deploy asset exceeds Cloudflare's 25 MiB limit: ${relativePath} (${formatBytes(size)})`);
    }
  }
}

checkRequiredFiles();
checkPackageScripts();
checkBlockedRootEntries();
checkServiceWorkerShell();
walkAssets();

if (failures.length) {
  console.error("Static deploy verification failed:");
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log("Static deploy verification passed.");
