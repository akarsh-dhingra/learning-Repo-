#!/usr/bin/env bash
# Runs the same load against the Bun server and the Node+ws server.
set -euo pipefail
cd "$(dirname "$0")"
run() {
  "$@" & local pid=$!
  sleep 1
  for n in 16 64 256; do bun bench.mjs "$n" 8; done
  kill "$pid"; wait "$pid" 2>/dev/null || true; sleep 1
}
run bun server-bun.ts
run node server-node.mjs
