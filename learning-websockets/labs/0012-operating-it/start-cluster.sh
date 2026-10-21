#!/usr/bin/env bash
# Starts Redis (port 6390) + 3 whiteboard nodes (8081, 8082, 8083). Logs go to ./logs/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
if ! redis-cli -p 6390 ping >/dev/null 2>&1; then
  redis-server --port 6390 --save "" --appendonly no --daemonize yes --logfile "$PWD/logs/redis.log"
  sleep 0.3
fi
for i in 1 2 3; do
  port=$((8080 + i))
  NODE_ID="node-$i" PORT=$port CURSOR_TICK_MS="${CURSOR_TICK_MS:-50}" bun server.ts > "logs/node-$i.log" 2>&1 &
  echo $! > "logs/node-$i.pid"
done
sleep 1
for i in 1 2 3; do curl -s "localhost:$((8080 + i))/stats"; echo; done
echo "Open http://localhost:8081/?room=demo and http://localhost:8082/?room=demo side by side."
