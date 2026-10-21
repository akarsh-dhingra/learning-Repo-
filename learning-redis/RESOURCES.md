# Redis Resources

## Knowledge

- [Video: Redis walkthrough (YouTube nns1mhlxTJ8)](https://youtu.be/nns1mhlxTJ8)
  The course spine. Hindi/English tutorial covering caching, data types, deployment models, cluster, hot keys, rate limiting, locks. Use for: lesson order and demos. Verify its claims against the official docs below; a few are simplified.
- [Redis docs: FAQ](https://redis.io/docs/latest/develop/get-started/faq/)
  Official. Why Redis keeps data in memory, memory footprint, threading, max keys. Use for: "what is Redis / why is it fast" claims.
- [Redis docs: Persistence (RDB and AOF)](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
  Official. Snapshots vs append-only file, fsync policies and how much data each can lose. Use for: durability questions.
- [Redis docs: EXPIRE command](https://redis.io/docs/latest/commands/expire/)
  Official. TTL semantics: what clears a TTL, -1/-2 return codes, passive vs active expiry. Use for: anything TTL.
- [Redis docs: node-redis guide](https://redis.io/docs/latest/develop/clients/nodejs/)
  Official Node.js client. Install, connect, set/get. Use for: Node code.
- [Redis docs: Migrate from ioredis (node-redis argument syntax)](https://redis.io/docs/latest/develop/clients/nodejs/migration/)
  Confirms `client.set(key, value, { EX: 10 })` and `{ NX: true }`. Use for: node-redis option syntax.
- [Redis docs: Run Redis on Docker](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/docker/)
  Official Docker setup and `docker exec -it <name> redis-cli`. Use for: local setup.
- [Cache-Aside Pattern (Lazy Loading) — redis.antirez.com](https://redis.antirez.com/fundamental/cache-aside.html)
  Pattern write-up on the site of Redis's creator. Use for: cache-aside flow, failure behaviour, staleness.

- [Redis docs: Distributed Locks with Redis](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
  Official. SET NX PX + token, compare-and-delete (DELEX on 8.4+), Redlock, failover race, fencing disclaimer. Use for: Lessons 0009–0010, A1.
- [Martin Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
  The canonical critique: efficiency vs correctness locks, process pauses, fencing tokens. Use for: Lesson 0010.
- [antirez: Is Redlock safe?](http://antirez.com/news/101)
  The Redis creator's reply to Kleppmann. Use for: presenting both sides.
- [Redis cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
  Official. 16384 slots, CRC16, hash tags, MOVED/ASK, PFAIL/FAIL, failover, write-loss windows. Use for: Lesson 0005.
- [Redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
  Official. Async replication, read-only replicas, WAIT limits, persistence-off danger. Use for: Lesson 0004.
- [Redis data types](https://redis.io/docs/latest/develop/data-types/) and [Pub/Sub](https://redis.io/docs/latest/develop/pubsub/)
  Official. Type overview; Pub/Sub is at-most-once, Streams for stronger delivery. Use for: Lesson 0003.
- [INCR command (rate limiter patterns)](https://redis.io/docs/latest/commands/incr/)
  Official. Counter and rate limiter patterns, INCR+EXPIRE race and Lua fix. Use for: Lesson 0008.
- [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
  Official. maxmemory policies, approximated LRU, LFU, hit-rate from INFO. Use for: Lesson 0006.
- [Client-side caching reference](https://redis.io/docs/latest/develop/reference/client-side-caching/)
  Official. Local caches with server-assisted invalidation (tracking). Use for: Lesson 0007 hot keys.
- [redis-cli](https://redis.io/docs/latest/develop/tools/cli/)
  Official. --hotkeys (needs LFU policy), --bigkeys, -c cluster mode. Use for: Lessons 0005, 0007.

## Wisdom (Communities)

- [r/redis](https://www.reddit.com/r/redis/)
  Redis-specific subreddit. Use for: "is Redis the right tool for X" questions.
- [r/systemdesign](https://www.reddit.com/r/systemdesign/)
  Use for: getting interview-style designs critiqued.

## Gaps
- No high-trust source yet on token bucket / sliding-window-counter algorithms (Lesson 0008 mentions them without citation).
