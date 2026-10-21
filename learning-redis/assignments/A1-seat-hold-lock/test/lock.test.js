// Assignment A1 test suite. Run: npm test
// Needs Redis on localhost:6379. Uses logical DB 15 and flushes it, so your
// other keys (DB 0) are never touched.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";

const IMPL = process.env.IMPL ?? "../src";
const lockMod = await import(new URL(`${IMPL}/lock.js`, import.meta.url));
const bookingMod = await import(new URL(`${IMPL}/booking.js`, import.meta.url));
const { acquire, release, extend, withLock, lockKey } = lockMod;
const { SeatDB, StaleFenceError, bookSeat } = bookingMod;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let redis;

before(async () => {
  redis = createClient({ url: "redis://localhost:6379/15" });
  redis.on("error", () => {});
  await redis.connect();
});
after(async () => redis?.quit());
beforeEach(async () => redis.flushDb());

describe("Part 1: acquire", () => {
  it("returns { resource, token, fence } and stores the token with a TTL", async () => {
    const lock = await acquire(redis, "seat:A1", 1000);
    assert.ok(lock, "acquire returned null on a free lock");
    assert.equal(lock.resource, "seat:A1");
    assert.equal(typeof lock.token, "string");
    assert.ok(lock.token.length >= 16, "token should be long and random");
    assert.equal(typeof lock.fence, "number");
    assert.equal(await redis.get(lockKey("seat:A1")), lock.token);
    const pttl = await redis.pTTL(lockKey("seat:A1"));
    assert.ok(pttl > 0 && pttl <= 1000, `expected a TTL ≤ 1000ms, got ${pttl}`);
  });

  it("returns null while someone else holds the lock", async () => {
    assert.ok(await acquire(redis, "seat:A1", 1000));
    assert.equal(await acquire(redis, "seat:A1", 1000), null);
  });

  it("gives every client a different token", async () => {
    const a = await acquire(redis, "seat:A1", 1000);
    const b = await acquire(redis, "seat:B1", 1000);
    assert.notEqual(a.token, b.token);
  });

  it("auto-releases after the TTL (a crashed holder can't block forever)", async () => {
    assert.ok(await acquire(redis, "seat:A1", 150));
    await sleep(250);
    assert.ok(await acquire(redis, "seat:A1", 150), "lock should be free after TTL");
  });
});

describe("Part 2: release", () => {
  it("releases a lock you own", async () => {
    const lock = await acquire(redis, "seat:A1", 1000);
    assert.equal(await release(redis, lock), true);
    assert.ok(await acquire(redis, "seat:A1", 1000));
  });

  it("refuses to delete someone else's lock (the video's plain DEL bug)", async () => {
    const a = await acquire(redis, "seat:A1", 100);
    await sleep(150); // A's lease expires...
    const b = await acquire(redis, "seat:A1", 1000); // ...and B takes over
    assert.ok(b);
    assert.equal(await release(redis, a), false, "A released B's lock!");
    assert.equal(await redis.get(lockKey("seat:A1")), b.token);
  });
});

describe("Part 3: fencing tokens", () => {
  it("increase with every successful acquisition", async () => {
    const fences = [];
    for (let i = 0; i < 5; i++) {
      const l = await acquire(redis, "seat:A1", 1000);
      fences.push(l.fence);
      await release(redis, l);
    }
    for (let i = 1; i < fences.length; i++) assert.ok(fences[i] > fences[i - 1], `fences not increasing: ${fences}`);
  });

  it("do NOT advance on a failed acquire (issue the fence atomically with the lock)", async () => {
    const a = await acquire(redis, "seat:A1", 1000);
    for (let i = 0; i < 3; i++) assert.equal(await acquire(redis, "seat:A1", 1000), null);
    await release(redis, a);
    const c = await acquire(redis, "seat:A1", 1000);
    assert.equal(c.fence, a.fence + 1, "failed attempts bumped the fence counter");
  });

  it("SeatDB rejects a write carrying an older fence than one it has seen", async () => {
    const db = new SeatDB();
    await db.writeSeat("A1", "bob", 7);
    await assert.rejects(db.writeSeat("A1", "alice", 6), StaleFenceError);
    assert.equal(await db.getSeat("A1"), "bob");
  });
});

describe("Part 4: extend", () => {
  it("lets the owner extend the lease", async () => {
    const lock = await acquire(redis, "seat:A1", 150);
    await sleep(100);
    assert.equal(await extend(redis, lock, 400), true);
    await sleep(150); // past the original TTL
    assert.equal(await acquire(redis, "seat:A1", 1000), null, "lease should still be held");
  });

  it("refuses to extend a lock you no longer own", async () => {
    const a = await acquire(redis, "seat:A1", 80);
    await sleep(120);
    const b = await acquire(redis, "seat:A1", 1000);
    assert.equal(await extend(redis, a, 5000), false);
    const pttl = await redis.pTTL(lockKey("seat:A1"));
    assert.ok(pttl <= 1000, "A's extend changed B's TTL");
    assert.ok(b);
  });
});

describe("Part 5: withLock + bookSeat under contention", () => {
  it("withLock always releases, even when fn throws", async () => {
    await assert.rejects(withLock(redis, "seat:A1", 5000, async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await redis.exists(lockKey("seat:A1")), 0);
  });

  it("50 users race for one seat: exactly one booking is written", async () => {
    const db = new SeatDB();
    const users = Array.from({ length: 50 }, (_, i) => `user${i}`);
    const results = await Promise.all(users.map((userId) => bookSeat({ redis, db, seatId: "A1", userId })));
    const winners = results.filter((r) => r.ok);
    assert.equal(winners.length, 1, `expected 1 winner, got ${winners.length}`);
    assert.equal(db.writes.length, 1, `expected 1 DB write, got ${db.writes.length}`);
    for (const r of results.filter((r) => !r.ok)) assert.ok(["taken", "busy"].includes(r.reason), `bad reason: ${r.reason}`);
  });

  it("different seats don't block each other", async () => {
    const db = new SeatDB();
    const seats = ["A1", "A2", "A3", "A4", "A5"];
    const results = await Promise.all(seats.map((s, i) => bookSeat({ redis, db, seatId: s, userId: `u${i}` })));
    assert.ok(results.every((r) => r.ok));
  });
});

describe("Part 6: the paused-client scenario (Kleppmann)", () => {
  it("a client that wakes up after its lease expired cannot overwrite the new booking", async () => {
    const db = new SeatDB();
    // Client A grabs the lock with a short lease, then "GC pauses".
    const a = await acquire(redis, "seat:A1", 100);
    await sleep(200);
    // Meanwhile B books the seat legitimately.
    const res = await bookSeat({ redis, db, seatId: "A1", userId: "bob" });
    assert.equal(res.ok, true);
    // A wakes up, still believes it holds the lock, and writes blindly.
    await assert.rejects(db.writeSeat("A1", "alice", a.fence), StaleFenceError);
    assert.equal(await db.getSeat("A1"), "bob");
    assert.equal(await release(redis, a), false);
  });
});
