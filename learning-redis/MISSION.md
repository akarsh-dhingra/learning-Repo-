# Mission: Redis for system design interviews and real backends

## Why
Explain Redis confidently in system design interviews (caching, cluster sharding, rate limiting, distributed locks), and actually use it in my own Node.js backends (e.g. the booking / hotel services) to make read-heavy endpoints fast.

## Success looks like
- Give a crisp 60-second interview answer to "how would you speed up a read-heavy endpoint?" including cache-aside, TTL, and staleness trade-offs
- Run Redis locally and add cache-aside caching to a real Node.js + Postgres API, measuring the before/after latency
- Explain Redis's durability trade-off (RDB vs AOF) and when Redis is the wrong tool
- Explain Redis Cluster (hash slots, MOVED redirects, failover) and the hot-key problem with fixes
- Implement rate limiting and a distributed lock with Redis, and name their failure modes

## Constraints
- Primary course material: the YouTube video "Redis" walkthrough (video id nns1mhlxTJ8), learned section by section
- Already comfortable with Node APIs, SQL/Mongo and Docker basics; skip beginner backend material

## Out of scope
- Redis internals at the C-source level (skip lists, listpacks) beyond a one-line mention
- Redis Stack modules (search, JSON, time series) for now
