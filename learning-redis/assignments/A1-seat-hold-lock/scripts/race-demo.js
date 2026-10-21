// Run BEFORE you start: `npm run race`
// Shows why the assignment exists: 50 users book seat A1 with NO lock.
import { SeatDB } from "../src/booking.js";

const db = new SeatDB();
// Neutralise the fencing TODO so this demo works on the untouched starter.
db.writeSeat = async function (seatId, userId) {
  await new Promise((r) => setTimeout(r, Math.random() * 5));
  this.seats.set(seatId, userId);
  this.writes.push({ seatId, userId });
};

async function naiveBook(seatId, userId) {
  const holder = await db.getSeat(seatId); // read…
  if (holder) return false;
  await db.writeSeat(seatId, userId);      // …then write: classic check-then-act race
  return true;
}

const users = Array.from({ length: 50 }, (_, i) => `user${i}`);
const results = await Promise.all(users.map((u) => naiveBook("A1", u)));
const winners = results.filter(Boolean).length;

console.log(`Users told "you got seat A1": ${winners}`);
console.log(`Final owner in the DB:        ${await db.getSeat("A1")}`);
console.log(winners > 1
  ? `\n${winners - 1} people paid for a seat they don't have. Your job: make this exactly 1.`
  : "\nGot lucky this run. Try again.");
