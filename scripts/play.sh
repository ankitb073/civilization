#!/bin/zsh
# Open the Palimpsest atlas on this machine (the dev server, with the latest local code) at the Play hub.
# Starts the server in the background if it is not already running.
# Usage: scripts/play.sh [route]      e.g. scripts/play.sh 3d   (opens #/3d)
cd "$(dirname "$0")/.."
NODE_DIR="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)/bin"
export PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT=5173
ROUTE="${1:-play}"
LOG="${TMPDIR:-/tmp}/palimpsest-dev.log"
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  nohup npm --prefix atlas run dev -- --port "$PORT" --strictPort > "$LOG" 2>&1 &
  disown
  for _ in {1..120}; do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.25; done
fi
open "http://localhost:$PORT/#/$ROUTE"
