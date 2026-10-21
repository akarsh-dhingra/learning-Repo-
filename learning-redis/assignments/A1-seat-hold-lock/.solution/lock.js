// REFERENCE SOLUTION. Don't open this until you've passed the tests yourself
// or spent at least 30 honest minutes stuck on one part.
import { randomBytes } from "node:crypto";

// Hash tags {…} keep the lock key and fence key in the same cluster slot,
// so the multi-key script below also works on Redis Cluster (Lesson 0005).
export const lockKey = (resource) => `lock:{${resource}}`;
export const fenceKey = (resource) => `fence:{${resource}}`;

// Acquire and issue the fencing token in ONE atomic step. Doing SET NX and
// INCR as separate round-trips lets a paused acquirer get a *newer* fence
// than a client that acquired after it.
export const ACQUIRE_SCRIPT = `
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return redis.call("incr", KEYS[2])
end
return 0`;

export const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0`;

export class LockNotAcquiredError extends Error {
  constructor(resource) {
    super(`Could not acquire lock for ${resource}`);
    this.name = "LockNotAcquiredError";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function acquire(redis, resource, ttlMs) {
  const token = randomBytes(20).toString("hex");
  const fence = await redis.eval(ACQUIRE_SCRIPT, {
    keys: [lockKey(resource), fenceKey(resource)],
    arguments: [token, String(ttlMs)],
  });
  if (!fence) return null;
  return { resource, token, fence: Number(fence) };
}

export async function release(redis, lock) {
  const n = await redis.eval(RELEASE_SCRIPT, {
    keys: [lockKey(lock.resource)],
    arguments: [lock.token],
  });
  return n === 1;
}

export async function extend(redis, lock, ttlMs) {
  const n = await redis.eval(EXTEND_SCRIPT, {
    keys: [lockKey(lock.resource)],
    arguments: [lock.token, String(ttlMs)],
  });
  return n === 1;
}

export async function withLock(redis, resource, ttlMs, fn, { retries = 20, retryDelayMs = 25 } = {}) {
  let lock = null;
  for (let attempt = 0; attempt <= retries && !lock; attempt++) {
    lock = await acquire(redis, resource, ttlMs);
    if (!lock && attempt < retries) {
      // Random jitter so competing clients don't retry in lock-step.
      await sleep(retryDelayMs + Math.random() * retryDelayMs);
    }
  }
  if (!lock) throw new LockNotAcquiredError(resource);
  try {
    return await fn(lock);
  } finally {
    await release(redis, lock);
  }
}
