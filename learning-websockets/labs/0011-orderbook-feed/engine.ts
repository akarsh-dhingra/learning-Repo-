// A FAKE matching engine. It isn't the lesson; it just produces realistic market data:
//   • per symbol, an order book whose every change gets the next update id
//   • every 50ms: a "depth" diff  { s, U: first id, u: last id, b: [[price, qty]], a: [[price, qty]] }  (qty "0" = remove level)
//   • now and then: a "trade"
//   • a snapshot { lastUpdateId, bids, asks } stored in Redis every tick (what GET /depth serves)
//   • private orders: reads "orders:in", answers on "user:<id>" with order.accepted then order.filled
// Exactly ONE engine runs. It is the single writer, so update ids are a total order per symbol.
import { RedisClient } from "bun";

const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6390");
const sub = await redis.duplicate();
const SYMBOLS: Record<string, { mid: number; tick: number }> = { "BTC-USD": { mid: 65000, tick: 0.5 }, "ETH-USD": { mid: 3200, tick: 0.05 } };
const TICK_MS = Number(process.env.TICK_MS ?? 50);

type Side = Map<number, number>; // price → qty
const books = new Map<string, { bids: Side; asks: Side; updateId: number }>();
const fmt = (n: number, d = 4) => n.toFixed(d).replace(/\.?0+$/, "") || "0";
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

for (const [s, { mid, tick }] of Object.entries(SYMBOLS)) {
  const bids: Side = new Map(), asks: Side = new Map();
  for (let i = 1; i <= 100; i++) {
    bids.set(+(mid - i * tick).toFixed(2), +rnd(0.01, 3).toFixed(4));
    asks.set(+(mid + i * tick).toFixed(2), +rnd(0.01, 3).toFixed(4));
  }
  books.set(s, { bids, asks, updateId: 1_000_000 });
}

const levels = (side: Side, desc: boolean) =>
  [...side].sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).map(([p, q]) => [fmt(p, 2), fmt(q)]);

setInterval(async () => {
  for (const [s, book] of books) {
    const { tick } = SYMBOLS[s];
    const U = book.updateId + 1;
    const b: string[][] = [], a: string[][] = [];
    const changes = 1 + Math.floor(Math.random() * 5);
    for (let i = 0; i < changes; i++) {
      const isBid = Math.random() < 0.5;
      const side = isBid ? book.bids : book.asks;
      const best = isBid ? Math.max(...side.keys()) : Math.min(...side.keys());
      const price = +(best + (isBid ? -1 : 1) * Math.floor(rnd(0, 20)) * tick).toFixed(2);
      const qty = Math.random() < 0.25 && side.size > 50 ? 0 : +rnd(0.01, 3).toFixed(4);
      if (qty === 0) side.delete(price); else side.set(price, qty);
      book.updateId++;
      (isBid ? b : a).push([fmt(price, 2), fmt(qty)]);
    }
    const diff = { s, U, u: book.updateId, b, a };
    // publish the diff, THEN store a snapshot that includes it (snapshot.lastUpdateId = diff.u)
    await redis.publish(`md:${s}:depth`, JSON.stringify(diff));
    await redis.set(`md:${s}:book`, JSON.stringify({ symbol: s, lastUpdateId: book.updateId, bids: levels(book.bids, true), asks: levels(book.asks, false) }));
    if (Math.random() < 0.3) {
      const buy = Math.random() < 0.5;
      const price = buy ? Math.min(...book.asks.keys()) : Math.max(...book.bids.keys());
      await redis.publish(`md:${s}:trade`, JSON.stringify({ s, p: fmt(price, 2), q: fmt(rnd(0.001, 0.5)), side: buy ? "buy" : "sell", t: Date.now() }));
    }
  }
}, TICK_MS);

// Private flow: an order comes in from any gateway; the answer goes to that user's channel.
let nextOrderId = 1;
await sub.subscribe("orders:in", async (raw) => {
  const o = JSON.parse(raw);
  const order = { orderId: nextOrderId++, clientOrderId: o.clientOrderId, symbol: o.symbol, side: o.side, price: o.price, qty: o.qty };
  await redis.publish(`user:${o.userId}`, JSON.stringify({ type: "order.accepted", data: order }));
  setTimeout(() => redis.publish(`user:${o.userId}`, JSON.stringify({ type: "order.filled", data: { ...order, filledQty: o.qty } })), 300);
});

console.log(`engine running: ${Object.keys(SYMBOLS).join(", ")} · diff every ${TICK_MS}ms`);
