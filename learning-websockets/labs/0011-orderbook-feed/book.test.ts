// Unit tests for the LocalBook algorithm, no server needed. Test YOUR implementation with:
//   BOOK=/path/to/your/orderbook.js bun test book.test.ts
import { test, expect } from "bun:test";
const { LocalBook } = await import(process.env.BOOK ?? "./public/orderbook.js");

const snap = (id: number, bids: string[][] = [["100", "1"]], asks: string[][] = [["101", "1"]]) => ({ lastUpdateId: id, bids, asks });
const diff = (U: number, u: number, b: string[][] = [], a: string[][] = []) => ({ U, u, b, a });

test("diffs that arrive before the snapshot are buffered, old ones discarded, newer ones applied", async () => {
  const book = new LocalBook({ fetchSnapshot: async () => snap(10) });
  book.onDiff(diff(8, 9, [["99", "5"]]));   // older than the snapshot → discard
  book.onDiff(diff(10, 11, [["98", "2"]])); // straddles the snapshot → apply
  book.onDiff(diff(12, 12, [["100", "0"]])); // qty 0 removes the level
  await book.sync();
  expect(book.lastUpdateId).toBe(12);
  expect([...book.bids]).toEqual([["98", "2"]]);
  expect(book.bids.has("99")).toBe(false);
});

test("a snapshot older than the first buffered diff is fetched again", async () => {
  let calls = 0;
  const book = new LocalBook({ fetchSnapshot: async () => (++calls === 1 ? snap(5) : snap(20)) });
  book.onDiff(diff(15, 16));
  book.onDiff(diff(17, 21, [["97", "1"]]));
  await book.sync();
  expect(calls).toBe(2);
  expect(book.lastUpdateId).toBe(21);
  expect(book.bids.get("97")).toBe("1");
});

test("after sync, a jump in ids is a gap: the book refetches the snapshot", async () => {
  let id = 10;
  const book = new LocalBook({ fetchSnapshot: async () => snap(id) });
  await book.sync();
  book.onDiff(diff(11, 11, [["100", "3"]]));
  expect(book.bids.get("100")).toBe("3");
  id = 15;
  book.onDiff(diff(14, 15)); // 12 and 13 never arrived
  expect(book.stats.gaps).toBe(1);
  await new Promise((r) => setTimeout(r, 0));
  expect(book.synced).toBe(true);
  expect(book.lastUpdateId).toBe(15);
});

test("duplicates and stale diffs after sync are ignored", async () => {
  const book = new LocalBook({ fetchSnapshot: async () => snap(10) });
  await book.sync();
  book.onDiff(diff(11, 12, [["100", "7"]]));
  book.onDiff(diff(11, 12, [["100", "999"]])); // replayed
  expect(book.bids.get("100")).toBe("7");
  expect(book.stats.ignored).toBe(1);
});

test("top(n) sorts bids high→low and asks low→high numerically", async () => {
  const book = new LocalBook({ fetchSnapshot: async () => snap(1, [["9.5", "1"], ["10", "1"], ["100", "1"]], [["101", "1"], ["1000", "1"], ["102", "1"]]) });
  await book.sync();
  const t = book.top(2);
  expect(t.bids.map((l: string[]) => l[0])).toEqual(["100", "10"]);
  expect(t.asks.map((l: string[]) => l[0])).toEqual(["101", "102"]);
});
