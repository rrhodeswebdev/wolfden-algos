#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd, opts = {}) =>
  execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8", ...opts }).trim();
const shInherit = (cmd) =>
  execSync(cmd, { cwd: root, stdio: "inherit" });

const die = (msg) => {
  console.error(`\n  release: ${msg}\n`);
  process.exit(1);
};

const bumpType = process.argv[2];
if (!["patch", "minor", "major"].includes(bumpType)) {
  die("usage: npm run release -- <patch|minor|major>");
}

const branch = sh("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") die(`must be on main (currently on ${branch})`);

if (sh("git status --porcelain")) die("working tree must be clean");

sh("git fetch origin main --tags");
const local = sh("git rev-parse @");
const remote = sh("git rev-parse @{u}");
if (local !== remote) die("local main is not in sync with origin/main");

const pkgPath = resolve(root, "package.json");
const tauriPath = resolve(root, "src-tauri/tauri.conf.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const cargoLockPath = resolve(root, "src-tauri/Cargo.lock");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const next = semver.inc(current, bumpType);
if (!next) die(`failed to bump ${current} as ${bumpType}`);

console.log(`  release: ${current} -> ${next}`);

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
tauri.version = next;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

const cargo = readFileSync(cargoPath, "utf8");
const cargoNext = cargo.replace(
  /^(version\s*=\s*")[^"]+(")/m,
  `$1${next}$2`,
);
if (cargoNext === cargo) die("failed to update Cargo.toml version");
writeFileSync(cargoPath, cargoNext);

// Update Cargo.lock entry for the wolf-den package if present
try {
  const lock = readFileSync(cargoLockPath, "utf8");
  const lockNext = lock.replace(
    /(\[\[package\]\]\nname = "wolf-den"\nversion = ")[^"]+(")/,
    `$1${next}$2`,
  );
  if (lockNext !== lock) writeFileSync(cargoLockPath, lockNext);
} catch {
  // Cargo.lock may not exist locally; that's fine
}

console.log("  release: generating changelog...");
shInherit(
  `npx --yes conventional-changelog-cli@5 -p conventionalcommits -i CHANGELOG.md -s -r 1`,
);

const tag = `v${next}`;
sh(
  `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md`,
);
try {
  sh(`git add src-tauri/Cargo.lock`);
} catch {}
sh(`git commit -m "chore(release): ${tag}"`);

// Use the new CHANGELOG section as the tag annotation
const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const sectionMatch = changelog.match(
  /^##\s*\[?[^\n]*\n[\s\S]*?(?=^##\s|\z)/m,
);
const tagBody = sectionMatch ? sectionMatch[0].trim() : `Release ${tag}`;
const tmpFile = resolve(root, ".release-tag-msg.tmp");
writeFileSync(tmpFile, tagBody);
sh(`git tag -a ${tag} -F ${JSON.stringify(tmpFile)}`);
execSync(`rm -f ${JSON.stringify(tmpFile)}`, { cwd: root });

console.log(`
  release: created commit + tag ${tag}

  Review:  git show ${tag}
  Push:    git push origin main && git push origin ${tag}
  Undo:    git tag -d ${tag} && git reset --hard HEAD~1
`);
