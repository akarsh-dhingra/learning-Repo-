# Notes

- Goal is both interviews and real projects: every lesson should end with (a) an interview-style answer prompt and (b) something runnable.
- Background: has built Node APIs with SQL/Mongo, knows Docker basics. Don't explain Express, fetch, or `docker run`.
- Following the video section by section. The summary's numbering is: 1 why caching, 2 what Redis is, 3 demo 1, 4 data structures, 5 deployment/cluster, 6 demo 2 Postgres, 7 hot keys, 8 rate limiting, 9 distributed lock.
- Session 1 (2026-10-07): asked for "first 10 minutes + points 1–3". Lessons 0001 (points 1–2) and 0002 (point 3) produced.
- Machine: Node v24 via nvm, Docker installed (daemon was not running at session 1).
- The video simplifies a few things; lessons flag corrections in a "The video says / The docs say" box. Keep doing that.
- Session 2 (2026-10-07): user asked for the rest of the video as ~20–25 min sections, with a deep dive + dedicated assignment on topic 9 (distributed locks). Built lessons 0003–0010, course map (lessons/index.html), 3 reference sheets, labs 0005/0006/0008, and assignments/A1-seat-hold-lock (15 node:test tests, mutation-checked; reference solution in .solution/).
- Every lesson now ends with an "Assignment" block; user should paste answers in the terminal for review.
- Containers left running for the user: redis-stack (6379/8001), postgres-db (5432, 1M rows seeded). redis-cluster/redis-replica are created on demand by the lessons.
- Measured on this machine: local Postgres PK lookup p50 ≈0.5ms vs Redis ≈0.14ms; the expensive GROUP BY in assignment 0006 ≈1.1s. Use these when discussing "is caching worth it".
- No learning records yet: nothing demonstrated. Write the first ones when the user reports quiz/drill scores or submits assignments.



# Session 1 

In order to run docker with Redis without using Redis PlayGround 

docker run -d --name my-redis -p 6379:6379 redis:latest 
