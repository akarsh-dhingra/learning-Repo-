#!/bin/sh
# Lesson 0005 lab: a real 6-node Redis Cluster (3 masters + 3 replicas),
# all inside ONE container so it works on Docker Desktop without network tricks.
#
#   sh start-cluster.sh            # start
#   docker exec -it redis-cluster redis-cli -c -p 7000     # talk to it (-c follows MOVED/ASK)
#   docker rm -f redis-cluster     # tear down
set -e
docker rm -f redis-cluster >/dev/null 2>&1 || true
docker run -d --name redis-cluster redis:7.4 sh -c '
  for p in 7000 7001 7002 7003 7004 7005; do
    mkdir -p /data/$p
    redis-server --port $p --cluster-enabled yes --cluster-config-file nodes-$p.conf \
      --cluster-node-timeout 5000 --appendonly no --dir /data/$p --daemonize yes
  done
  sleep 1
  redis-cli --cluster create 127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
    127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 --cluster-replicas 1 --cluster-yes
  tail -f /dev/null' >/dev/null
echo "Waiting for the cluster to form..."
for i in $(seq 1 30); do
  if docker exec redis-cluster redis-cli -p 7000 CLUSTER INFO 2>/dev/null | grep -q "cluster_state:ok"; then
    docker exec redis-cluster redis-cli -p 7000 CLUSTER INFO | grep -E "cluster_state|cluster_slots_assigned|cluster_known_nodes|cluster_size"
    echo "Ready. Try: docker exec -it redis-cluster redis-cli -c -p 7000"
    exit 0
  fi
  sleep 1
done
echo "Cluster did not become ready; see: docker logs redis-cluster" >&2
exit 1
