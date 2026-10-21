// REFERENCE SOLUTION. See the warning in lock.js.
import { withLock, LockNotAcquiredError } from "./lock.js";

export class StaleFenceError extends Error {
  constructor(seatId, fence, last) {
    super(`Rejected write to ${seatId}: fence ${fence} < last seen ${last}`);
    this.name = "StaleFenceError";
  }
}

const io = () => new Promise((r) => setTimeout(r, Math.random() * 5));

// Stands in for Postgres. It's deliberately naive: writeSeat does NOT check
// whether the seat is already taken (like a plain UPDATE). Its only defence
// is the fencing check.
export class SeatDB {
  constructor() {
    this.seats = new Map();
    this.lastFence = new Map();
    this.writes = [];
  }

  async getSeat(seatId) {
    await io();
    return this.seats.get(seatId) ?? null;
  }

  async writeSeat(seatId, userId, fence) {
    await io();
    const last = this.lastFence.get(seatId) ?? 0;
    if (fence < last) throw new StaleFenceError(seatId, fence, last);
    this.lastFence.set(seatId, fence);
    this.seats.set(seatId, userId);
    this.writes.push({ seatId, userId, fence });
  }
}

export async function bookSeat({ redis, db, seatId, userId, ttlMs = 2000 }) {
  try {
    return await withLock(redis, `seat:${seatId}`, ttlMs, async (lock) => {
      const holder = await db.getSeat(seatId);
      if (holder) return { ok: false, reason: "taken" };
      await db.writeSeat(seatId, userId, lock.fence);
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof LockNotAcquiredError) return { ok: false, reason: "busy" };
    throw err;
  }
}
