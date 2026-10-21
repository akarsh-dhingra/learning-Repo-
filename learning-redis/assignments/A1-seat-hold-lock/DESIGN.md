# A1 — Design answers

Answer in your own words, 2–5 sentences each. Paste them to Claude for grading.

1. **The video's lock.** The video takes the lock with `INCR` on a counter (1 = you got it, more than 1 = someone else has it) and sets a TTL. List every way this can go wrong, and say which test in this assignment catches each one.

2. **Random token.** Why does each acquisition need its own random value? Describe the exact sequence of events that a plain `DEL` gets wrong.

3. **Atomicity.** Name the three places in your code where two Redis operations *had* to happen as one atomic step, and what breaks if they don't.

4. **Choosing the TTL.** The real seat hold lasts 10 minutes while the user pays. What happens if the TTL is too short? Too long? How does `extend` change that trade-off?

5. **Fencing.** Your fence check lives in `SeatDB`, not in Redis. Why must the *storage* do the check? What would you need from Postgres to do the same thing for real (hint: a column and a `WHERE` clause)?

6. **Failover.** You run Redis with one replica and automatic failover. Client A gets the lock and the primary crashes before replicating it. What happens next, and which part of your design still prevents a double booking?

7. **Efficiency vs correctness.** Kleppmann splits locks into these two kinds. Which kind is the seat hold? Give one example in a booking system of the *other* kind.

8. **Would you even use Redis?** For seat booking specifically, argue for a Postgres-only design (`UNIQUE` constraint or `SELECT … FOR UPDATE`). When does adding the Redis lock still earn its place?
