# Notes

- Workspace lives in ~/learning-websockets (the /teach command was run from ~; kept separate like ~/learning-redis).
- Same learner as ~/learning-redis: likes lessons that end with (a) an interview/system-design prompt and (b) something runnable, plus an "Assignment" block whose answers they paste in the terminal for review. Background: Node APIs, SQL/Mongo, Docker basics. Don't explain Express/fetch/docker run.
- Prior exposure: ~/wsCrashCourse (Sept 2026) has a Node `ws` server attached to an http server. Bug in it: the HTTP handler reads index.html but calls `res.end()` with no body. Used as a hook in lesson 0002.
- Redis course already covered pub/sub basics, cluster, rate limiting. Reuse that knowledge when we reach the Redis backplane (lesson 0008); don't re-teach Redis.
- Machine: Apple M4, 10 cores, Node v24.15.0, Bun 1.4.2.
- Benchmark measured 2026-10-21 (labs/0002-node-vs-bun/run-bench.sh, 64-byte msgs, one room, load generator in Bun on the same machine):
  Bun 1.4.2: 16 clients 1.52M, 64 clients 2.06M, 256 clients 1.89M delivered msgs/sec
  Node 24 + ws 8: 16 clients 220k, 64 clients 225k, 256 clients 178k delivered msgs/sec
  ≈7–10× in Bun's favour, in line with Bun's docs claim (≈7×).
- Session 1 (2026-10-21): built course map, lessons 0001–0003, labs 0001/0002, reference sheets protocol + server-api. No learning records yet: nothing demonstrated.
- Session 2 (2026-10-21): user said 0001–0003 done; asked to build ALL remaining lessons, implementation-first, backend-engineer depth, no deep internals. Format from 0004 on: short "why" → build-along steps in the lesson → reference solution in labs/NNNN/ → `check.test.ts` black-box tests the user runs against their own server in ~/learning-websockets/build/ (URL via env). 
- Lessons 0004–0007 grow ONE rooms server (protocol → whiteboard rooms → auth/heartbeat/resume → backpressure); 0008 adds the Redis backplane; 0012 operates it. 0009/0010 are a separate Gather-style world server; 0011 a separate CEX order-book feed.
- No Docker needed: Docker.app exists but daemon is often off. Labs use native `redis-server` (Homebrew) on port 6390, started by the lab scripts. nginx/k6 are not installed: LB shown as nginx config (optional), load tests written in Bun.
- User also has ~/TS/realTimeLab (Bun project with basicWs.ts) — their own sandbox.
- Session 2 result (2026-10-21): built labs 0004–0012 (all checks green against the reference solutions, several run repeatedly for flakiness; not mutation-tested), lessons 0004–0012 + capstone, reference/backend-patterns.html. Course map updated (no "planned" items left).
- Measured & quoted in lessons: 0009 bots (300: 21.0 vs 2.0 MB/s; 1000: 226 vs 20.4 MB/s; tick 74 vs 27 ms). 0012 load test: 3k sockets p50 15 ms; 5k round-robin p50 6.8 s caused by Redis subscriber omem 2.5–11.6 MB; 5k with room affinity p50 43 ms. CURSOR_HZ=0 → p50 37 ms (confirmation). Bun Redis subscriber microbench ≈385k msgs/s (not the bottleneck by itself).
- Gotchas found while building (taught in lessons): Bun's node:net pause() doesn't stop reading → slow client must run under Node. Bun closeOnBackpressureLimit closes with 1006 and no reason → use explicit getBufferedAmount + terminate(). Unsubscribing while subscribe in flight throws ERR_REDIS_INVALID_STATE and crashed a gateway → await ready, unsubscribe(channel, listener), try/catch.
- Port map: 8080 single-node labs, 8081-8083 cluster (0008/0012), 8090 world, 9000-9003 space cluster, 7001-7002 exchange, Redis 6390.
- Next session: ask which assignments were done; review pasted code; write learning records from evidence; spaced review quiz over 0004–0008 before the capstone.
