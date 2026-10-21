#!/usr/bin/env bash
# Starts Redis (6390), the fake engine, and two gateways (7001, 7002). Logs in ./logs/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
redis-cli -p 6390 ping >/dev/null 2>&1 || { redis-server --port 6390 --save "" --appendonly no --daemonize yes --logfile "$PWD/logs/redis.log"; sleep 0.3; }
bun engine.ts > logs/engine.log 2>&1 & echo $! > logs/engine.pid
for i in 1 2; do NODE_ID="gw-$i" PORT=$((7000 + i)) bun gateway.ts > "logs/gw-$i.log" 2>&1 & echo $! > "logs/gw-$i.pid"; done
sleep 1
echo "Open http://localhost:7001 and http://localhost:7002 (two gateways, same market)."
