// Black-box checks for lesson 0011 (market-data gateway + private streams).
//   ./start.sh   then   bun test check.test.ts      (or URL=http://localhost:7001 for your own gateway)
// Also runs the LocalBook algorithm from public/orderbook.js against the live feed (BOOK=path to use yours).
import { test, expect, afterEach } from "bun:test";
import { connect, type TestClient } from "../_shared/test-client";

const BASE = process.env.URL ?? "http://localhost:7001";
const BASE2 = process.env.URL2 ?? "http://localhost:7002";
const WS = BASE.replace(/^http/, "ws");
const { LocalBook } = await import(process.env.BOOK ?? "./public/orderbook.js");
const open: TestClient[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));
const ws = async (q = "") => { const c = await connect(`${WS}/${q}`); open.push(c); await c.next((m) => m.type === "welcome"); return c; };
const snapshot = (sym = "BTC-USD") => fetch(`${BASE}/depth?symbol=${sym}`).then((r) => r.json());
const login = async (name: string) => (await (await fetch(`${BASE}/login`, { method: "POST", body: JSON.stringify({ name }) })).json()).token;

test("GET /depth: snapshot with lastUpdateId, bids high→low, asks low→high", async () => {
  const s = await snapshot();
  expect(typeof s.lastUpdateId).toBe("number");
  const bids = s.bids.map((l: string[]) => Number(l[0])), asks = s.asks.map((l: string[]) => Number(l[0]));
  expect(bids).toEqual([...bids].sort((a, b) => b - a));
  expect(asks).toEqual([...asks].sort((a, b) => a - b));
  expect(bids[0]).toBeLessThan(asks[0]);
});

test("subscribe → ack, then depth diffs whose ids are contiguous (each U = previous u + 1)", async () => {
  const c = await ws();
  c.send({ type: "subscribe", id: "s", data: { streams: ["BTC-USD@depth"] } });
  expect((await c.next((m) => m.id === "s")).data.streams).toEqual(["BTC-USD@depth"]);
  const diffs = [];
  for (let i = 0; i < 10; i++) diffs.push((await c.next((m) => m.type === "depth")).data);
  for (let i = 1; i < diffs.length; i++) expect(diffs[i].U).toBe(diffs[i - 1].u + 1);
});

test("unknown streams are rejected; unsubscribe stops the flow", async () => {
  const c = await ws();
  c.send({ type: "subscribe", id: "bad", data: { streams: ["DOGE-USD@depth"] } });
  expect((await c.next((m) => m.id === "bad")).data.code).toBe("invalid");
  c.send({ type: "subscribe", id: "s", data: { streams: ["ETH-USD@trade", "ETH-USD@depth"] } });
  await c.next((m) => m.type === "depth");
  c.send({ type: "unsubscribe", id: "u", data: { streams: ["ETH-USD@trade", "ETH-USD@depth"] } });
  await c.next((m) => m.id === "u");
  await Bun.sleep(100);
  await c.none((m) => m.type === "depth" || m.type === "trade", 400);
});

test("snapshot + buffered diffs: the LocalBook ends up identical to a later snapshot", async () => {
  const c = await ws();
  const book = new LocalBook({ fetchSnapshot: snapshot });
  c.ws.addEventListener("message", (e) => { const m = JSON.parse(String(e.data)); if (m.type === "depth" && m.data.s === "BTC-USD") book.onDiff(m.data); });
  c.send({ type: "subscribe", id: "s", data: { streams: ["BTC-USD@depth"] } });
  await c.next((m) => m.id === "s");
  await book.sync();
  await Bun.sleep(500);
  const later = await snapshot();
  while (book.lastUpdateId < later.lastUpdateId) await Bun.sleep(10);
  expect(book.lastUpdateId).toBe(later.lastUpdateId);
  expect([...book.bids].sort()).toEqual([...new Map(later.bids)].sort());
  expect([...book.asks].sort()).toEqual([...new Map(later.asks)].sort());
});

test("a dropped diff is detected as a gap and the book resyncs to the correct state", async () => {
  const c = await ws();
  const book = new LocalBook({ fetchSnapshot: snapshot });
  let n = 0;
  c.ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type !== "depth" || m.data.s !== "BTC-USD") return;
    if (++n === 15) return; // the network eats one diff
    book.onDiff(m.data);
  });
  c.send({ type: "subscribe", id: "s", data: { streams: ["BTC-USD@depth"] } });
  await c.next((m) => m.id === "s");
  await book.sync();
  while (n < 25) await Bun.sleep(20);
  expect(book.stats.gaps).toBe(1);
  await Bun.sleep(200);
  const later = await snapshot();
  while (book.lastUpdateId < later.lastUpdateId) await Bun.sleep(10);
  expect([...book.bids].sort()).toEqual([...new Map(later.bids)].sort());
});

test("two gateways serve the same market (Pattern A): identical diffs from both", async () => {
  const c1 = await ws();
  const c2 = await connect(`${BASE2.replace(/^http/, "ws")}/`); open.push(c2); await c2.next((m) => m.type === "welcome");
  for (const c of [c1, c2]) c.send({ type: "subscribe", id: "s", data: { streams: ["ETH-USD@depth"] } });
  await c1.next((m) => m.id === "s"); await c2.next((m) => m.id === "s");
  const d1 = (await c1.next((m) => m.type === "depth")).data;
  const d2 = await c2.next((m) => m.type === "depth" && m.data.u === d1.u, 3000);
  expect(d2.data).toEqual(d1);
});

test("order.place needs auth; with a token the fill arrives on YOUR private stream only", async () => {
  const anon = await ws();
  anon.send({ type: "order.place", id: "o0", data: { clientOrderId: "x", symbol: "BTC-USD", side: "buy", price: "65000", qty: "0.01" } });
  expect((await anon.next((m) => m.id === "o0")).data.code).toBe("forbidden");

  const alice = await ws(`?token=${await login("alice")}`);
  const bob = await ws(`?token=${await login("bob")}`);
  alice.send({ type: "order.place", id: "o1", data: { clientOrderId: "c-1", symbol: "BTC-USD", side: "buy", price: "65000", qty: "0.01" } });
  expect((await alice.next((m) => m.id === "o1")).data.status).toBe("submitted");
  expect((await alice.next((m) => m.type === "order.accepted")).data.clientOrderId).toBe("c-1");
  expect((await alice.next((m) => m.type === "order.filled")).data.filledQty).toBe("0.01");
  await bob.none((m) => m.type.startsWith("order."), 200);
});

test("flooding the gateway gets you disconnected with 1008", async () => {
  const c = await ws();
  for (let i = 0; i < 30; i++) c.send({ type: "subscribe", id: `f${i}`, data: { streams: ["BTC-USD@trade"] } });
  const { code } = await c.closed;
  expect(code).toBe(1008);
});
