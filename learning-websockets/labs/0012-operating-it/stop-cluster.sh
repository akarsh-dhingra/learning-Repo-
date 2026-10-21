#!/usr/bin/env bash
# Stops the 3 nodes (and Redis on 6390 with --all).
cd "$(dirname "$0")"
for f in logs/node-*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
[ "${1:-}" = "--all" ] && redis-cli -p 6390 shutdown nosave >/dev/null 2>&1
echo stopped
