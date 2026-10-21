// Assignment A1 — your distributed lock.
// Fill in every TODO, then run `npm test`. Read brief.html first.
import { randomBytes } from "node:crypto";

// Key names. Why the curly braces? Hint: Lesson 0005 (hash tags).
export const lockKey = (resource) => `lock:{${resource}}`;
export const fenceKey = (resource) => `fence:{${resource}}`;

export class LockNotAcquiredError extends Error {
  constructor(resource) {
    super(`Could not acquire lock for ${resource}`);
    this.name = "LockNotAcquiredError";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Try ONCE to take the lock on `resource` for `ttlMs` milliseconds.
 * Resolves to { resource, token, fence } on success, or null if it's held.
 *
 * Requirements (each one has a test):
 *  - token: a fresh random string, unique to this acquisition (randomBytes is imported above)
 *  - the lock key must expire on its own after ttlMs
 *  - fence: a number that increases with every SUCCESSFUL acquisition of this resource,
 *    and must NOT advance when the acquire fails
 *
 * Hint: setting the lock and issuing the fence must happen as one atomic step.
 *       Look up redis.eval(script, { keys: [...], arguments: [...] }).
 */
export async function acquire(redis, resource, ttlMs) {
  // TODO
  throw new Error("TODO: acquire");
}

/**
 * Release `lock` ONLY if we still own it. Resolves true if deleted, false otherwise.
 * A plain DEL is wrong: why? (Test: "refuses to delete someone else's lock")
 */
export async function release(redis, lock) {
  // TODO
  throw new Error("TODO: release");
}

/**
 * Push the lock's expiry out to ttlMs from now, ONLY if we still own it.
 * Resolves true on success, false if the lock is gone or owned by someone else.
 */
export async function extend(redis, lock, ttlMs) {
  // TODO
  throw new Error("TODO: extend");
}

/**
 * Acquire (retrying up to `retries` times with a randomised delay), run fn(lock),
 * and ALWAYS release afterwards, even if fn throws.
 * Throws LockNotAcquiredError if every attempt fails.
 */
export async function withLock(redis, resource, ttlMs, fn, { retries = 20, retryDelayMs = 25 } = {}) {
  // TODO
  throw new Error("TODO: withLock");
}
