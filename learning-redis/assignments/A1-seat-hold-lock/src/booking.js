// Assignment A1 — the booking side.
import { withLock, LockNotAcquiredError } from "./lock.js";

export class StaleFenceError extends Error {
  constructor(seatId, fence, last) {
    super(`Rejected write to ${seatId}: fence ${fence} < last seen ${last}`);
    this.name = "StaleFenceError";
  }
}

const io = () => new Promise((r) => setTimeout(r, Math.random() * 5));

/**
 * Stands in for Postgres. It's deliberately naive: writeSeat does NOT check
 * whether the seat is already taken (think of a plain UPDATE). The lock is
 * what stops double-booking. The fencing check is the last line of defence.
 * (getSeat and the bookkeeping are done for you.)
 */
export class SeatDB {
  constructor() {
    this.seats = new Map();     // seatId -> userId
    this.lastFence = new Map(); // seatId -> highest fence accepted so far
    this.writes = [];           // every accepted write, used by the tests
  }

  async getSeat(seatId) {
    await io();
    return this.seats.get(seatId) ?? null;
  }

  /**
   * TODO: reject (throw StaleFenceError) if `fence` is LOWER than the highest
   * fence already accepted for this seat. Otherwise record the write.
   */
  async writeSeat(seatId, userId, fence) {
    await io();
    // TODO: fencing check goes here
    this.lastFence.set(seatId, fence);
    this.seats.set(seatId, userId);
    this.writes.push({ seatId, userId, fence });
  }
}

/**
 * TODO: book `seatId` for `userId`.
 *  - lock resource name: `seat:${seatId}`
 *  - inside the lock: read the seat; if taken → { ok: false, reason: "taken" }
 *    else write it WITH the lock's fence → { ok: true }
 *  - if the lock can't be acquired → { ok: false, reason: "busy" }
 */
export async function bookSeat({ redis, db, seatId, userId, ttlMs = 2000 }) {
  throw new Error("TODO: bookSeat");
}
