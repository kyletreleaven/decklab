#!/usr/bin/env bash
#
# Build DeckLab.app from source.
#
#   ./scripts/build-macos.sh
#
# Run it again after `git pull` to update. A locally built app carries no
# quarantine flag, so Gatekeeper lets it open without signing.

set -euo pipefail

cd "$(dirname "$0")/.."

# --- prerequisites -----------------------------------------------------------
# Check them all before failing, so one run lists everything that is missing.

missing=()
xcode-select -p >/dev/null 2>&1 || missing+=("Xcode Command Line Tools:  xcode-select --install")
command -v node >/dev/null 2>&1 || missing+=("Node 20+:  https://nodejs.org (or: brew install node)")
command -v cargo >/dev/null 2>&1 || missing+=("Rust:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh")
command -v cargo-audit >/dev/null 2>&1 || missing+=("cargo-audit (after Rust):  cargo install cargo-audit --locked")

if (( ${#missing[@]} )); then
  printf '\nMissing prerequisites — install these, open a new terminal, and re-run:\n\n'
  printf '  • %s\n' "${missing[@]}"
  exit 1
fi

node_major=$(node -p 'process.versions.node.split(".")[0]')
if (( node_major < 20 )); then
  printf '\n✗ Node 20 or newer is required (found %s)\n' "$(node --version)" >&2
  exit 1
fi

# --- build -------------------------------------------------------------------

echo "→ installing JavaScript dependencies…"
npm ci

# --- audit -------------------------------------------------------------------
# Flag known vulnerabilities in both dependency trees without blocking the
# build. Full reports print here; the result is repeated at the end so it is not
# lost under the compiler output.

echo "→ auditing JavaScript dependencies…"
if npm audit; then npm_audit="clean"; else npm_audit="VULNERABILITIES FOUND (see npm audit above)"; fi

echo "→ auditing Rust dependencies…"
if (cd src-tauri && cargo audit); then
  rust_audit="clean"
else
  rust_audit="VULNERABILITIES FOUND (see cargo audit above)"
fi

echo "→ building (the first build compiles Rust and takes a few minutes)…"
# The .app alone — the DMG step is only for distributing a download.
npx tauri build --bundles app

# Out of target/ so it is easy to find. Tauri re-bundles from the compiled
# binary on every build, so moving it costs nothing next time. Remove first, or
# mv would nest the new app inside the old one.
mkdir -p build
rm -rf build/DeckLab.app
mv src-tauri/target/release/bundle/macos/DeckLab.app build/

printf '\n✓ built %s/build/DeckLab.app\n' "$(pwd)"
printf '\n  JavaScript audit: %s\n' "$npm_audit"
printf '  Rust audit:       %s\n' "$rust_audit"
