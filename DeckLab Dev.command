#!/usr/bin/env bash
#
# Double-click this in Finder to bring up DeckLab in development mode.
#
# Opens a Terminal window, starts the Vite dev server if it is not already
# running, then builds and launches the app pointed at it. Closing the Terminal
# window (or Ctrl-C) shuts both down.

set -uo pipefail

cd "$(dirname "$0")"

PORT="${DECKLAB_DEV_PORT:-1420}"
URL="http://localhost:${PORT}/"
VITE_PID=""

vite_is_up() {
  curl -sf -o /dev/null --max-time 1 "$URL" 2>/dev/null
}

cleanup() {
  # Only stop the dev server if this script was the one that started it.
  if [[ -n "$VITE_PID" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    printf '\n  stopping dev server…\n'
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

printf '\n  DeckLab — development mode\n'
printf '  %s\n\n' "$(pwd)"

if [[ ! -d node_modules ]]; then
  echo "→ installing dependencies (first run only)…"
  npm install || { echo "✗ npm install failed"; read -r -p "Press return to close…"; exit 1; }
fi

if vite_is_up; then
  echo "→ dev server already running on ${PORT}, reusing it"
else
  echo "→ starting dev server on ${PORT}…"
  npx vite --port "$PORT" &
  VITE_PID=$!

  # Bounded wait — a hang here would otherwise look like the app failing.
  for _ in $(seq 1 60); do
    vite_is_up && break
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      echo "✗ dev server exited during startup"
      read -r -p "Press return to close…"
      exit 1
    fi
    sleep 0.5
  done

  if ! vite_is_up; then
    echo "✗ dev server did not come up within 30s"
    read -r -p "Press return to close…"
    exit 1
  fi
  echo "→ dev server ready"
fi

echo "→ launching the app (the first run compiles Rust, which takes a minute)…"
echo

# --no-default-features disables `custom-protocol`, which is what makes the app
# load from the dev server rather than from bundled assets. It is what
# `tauri dev` passes internally; driving cargo directly keeps this script in
# charge of the process tree, so closing the window really does stop everything.
cd src-tauri
cargo run --no-default-features
status=$?

echo
if [[ $status -ne 0 ]]; then
  echo "✗ the app exited with status ${status}"
  read -r -p "Press return to close…"
fi
