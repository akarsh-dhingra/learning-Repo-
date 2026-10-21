#!/usr/bin/env bash
# Starts Redis (6390), the directory (9000) and 3 space nodes (9001-9003). Logs in ./logs/.
# Restart a single crashed node:  ./start-cluster.sh node-2
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
redis-cli -p 6390 ping >/dev/null 2>&1 || { redis-server --port 6390 --save "" --appendonly no --daemonize yes --logfile "$PWD/logs/redis.log"; sleep 0.3; }
start_node() { local i=$1; NODE_ID="node-$i" PORT=$((9000 + i)) bun space-node.ts > "logs/node-$i.log" 2>&1 & echo $! > "logs/node-$i.pid"; }
if [ "${1:-}" != "" ]; then start_node "${1#node-}"; sleep 1; echo "restarted $1"; exit 0; fi
PORT=9000 bun directory.ts > logs/directory.log 2>&1 & echo $! > logs/directory.pid
for i in 1 2 3; do start_node $i; done
sleep 1.5
curl -s localhost:9000/nodes; echo
echo "Open http://localhost:9000/?space=office (and ?space=lobby, ?space=games…)"
