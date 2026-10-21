// Lesson 0011 reference: a CEX market-data + user-data gateway (Pattern A: run as many as you like).
//   • REST  GET /depth?symbol=BTC-USD → order-book snapshot with lastUpdateId
//   • WS    subscribe / unsubscribe to public streams "<SYMBOL>@depth" and "<SYMBOL>@trade"
//   • WS    private stream "user" (needs ?token=): your order.accepted / order.filled events
//   • WS    order.place → handed to the engine; answers arrive on your private stream
//   • inbound rate limit per connection (token bucket) and a cap on subscriptions
// Run engine + 2 gateways + Redis: ./start.sh      Check: bun test check.test.ts
import { z } from "zod";
import { RedisClient, type ServerWebSocket } from "bun";
import { createRouter, ClientError, send } from "./protocol";
import { verifyToken, signToken } from "./auth";

const PORT = Number(process.env.PORT ?? 7001);
const NODE_ID = process.env.NODE_ID ?? `gw-${PORT}`;
const SYMBOLS = ["BTC-USD", "ETH-USD"];
const MAX_STREAMS = 20;
const BUCKET = { capacity: 10, refillPerSec: 5 }; // burst of 10, then 5 msgs/sec sustained

const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6390");
const sub = await redis.duplicate();

type Data = { userId: string | null; tokens: number; lastRefill: number; streams: Set<string> };
type Socket = ServerWebSocket<Data>;

// ── Redis channel ⇄ local Bun topic, ref-counted (same idea as 0008's attach/detach) ──
const channelFor = (stream: string) => {
  if (stream.startsWith("user:")) return stream;
  const [sym, kind] = stream.split("@");
  return `md:${sym}:${kind}`;
};
type Ref = { count: number; ready: Promise<unknown>; listener: (raw: string) => void };
const refs = new Map<string, Ref>();
async function attach(stream: string) {
  let r = refs.get(stream);
  if (!r) {
    const wrap = stream.startsWith("user:")
      ? (raw: string) => raw // user events are already { type, data }
      : (raw: string) => `{"type":"${stream.split("@")[1]}","stream":"${stream}","data":${raw}}`;
    const listener = (raw: string) => server.publish(stream, wrap(raw));
    refs.set(stream, (r = { count: 0, listener, ready: sub.subscribe(channelFor(stream), listener) }));
  }
  r.count++;
  await r.ready;
}
async function detach(stream: string) {
  const r = refs.get(stream);
  if (!r || --r.count > 0) return;
  refs.delete(stream);
  try {
    await r.ready; // a socket can leave before its subscribe finished: unsubscribe only after it did
    await sub.unsubscribe(channelFor(stream), r.listener); // only OUR listener: a newer attach may have re-subscribed
  } catch (err) {
    console.error(`unsubscribe ${stream} failed:`, err); // cleanup must never crash the gateway
  }
}

const StreamName = z.string().refine((s) => {
  const [sym, kind] = s.split("@");
  return SYMBOLS.includes(sym) && (kind === "depth" || kind === "trade");
}, "streams look like BTC-USD@depth or ETH-USD@trade");

const router = createRouter<Data>()
  .on("subscribe", z.object({ streams: z.array(StreamName).min(1).max(MAX_STREAMS) }), async ({ ws, data }) => {
    const fresh = data.streams.filter((s) => !ws.data.streams.has(s));
    if (ws.data.streams.size + fresh.length > MAX_STREAMS) throw new ClientError("limit", `max ${MAX_STREAMS} streams per connection`);
    for (const s of fresh) { ws.data.streams.add(s); ws.subscribe(s); await attach(s); }
    return { streams: [...ws.data.streams] };
  })
  .on("unsubscribe", z.object({ streams: z.array(StreamName).min(1) }), async ({ ws, data }) => {
    for (const s of data.streams) if (ws.data.streams.delete(s)) { ws.unsubscribe(s); await detach(s); }
    return { streams: [...ws.data.streams] };
  })
  .on("order.place", z.object({
    clientOrderId: z.string().min(1).max(36),
    symbol: z.enum(SYMBOLS as [string, ...string[]]),
    side: z.enum(["buy", "sell"]),
    price: z.string().regex(/^\d+(\.\d+)?$/),
    qty: z.string().regex(/^\d+(\.\d+)?$/),
  }), async ({ ws, data }) => {
    if (!ws.data.userId) throw new ClientError("forbidden", "connect with ?token= to trade");
    await redis.publish("orders:in", JSON.stringify({ ...data, userId: ws.data.userId }));
    return { clientOrderId: data.clientOrderId, status: "submitted" }; // the fill comes later on your "user" stream
  });

// Token bucket: refill based on elapsed time, spend one token per inbound message.
function allow(ws: Socket) {
  const now = performance.now();
  ws.data.tokens = Math.min(BUCKET.capacity, ws.data.tokens + ((now - ws.data.lastRefill) / 1000) * BUCKET.refillPerSec);
  ws.data.lastRefill = now;
  if (ws.data.tokens < 1) return false;
  ws.data.tokens -= 1;
  return true;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/depth") {
      const symbol = url.searchParams.get("symbol") ?? "";
      if (!SYMBOLS.includes(symbol)) return Response.json({ error: "unknown symbol" }, { status: 400 });
      return new Response(await redis.get(`md:${symbol}:book`), { headers: { "content-type": "application/json" } });
    }
    if (req.method === "POST" && url.pathname === "/login") { // stand-in for the exchange's auth service
      const name = String((await req.json().catch(() => ({}))).name ?? "trader").slice(0, 32);
      return Response.json({ token: signToken({ sub: crypto.randomUUID(), name, exp: Math.floor(Date.now() / 1000) + 3600 }) });
    }
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const token = url.searchParams.get("token");
      const auth = token ? verifyToken(token) : null;
      if (token && !auth) return new Response("invalid token", { status: 401 }); // public data needs no token, but a BAD token is an error
      if (server.upgrade(req, { data: { userId: auth?.sub ?? null, tokens: BUCKET.capacity, lastRefill: performance.now(), streams: new Set() } })) return;
      return new Response("upgrade failed", { status: 400 });
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${import.meta.dir}/public${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
  websocket: {
    data: {} as Data,
    idleTimeout: 60,
    async open(ws) {
      if (ws.data.userId) {                       // the private stream is automatic for logged-in users
        const stream = `user:${ws.data.userId}`;
        ws.data.streams.add(stream); ws.subscribe(stream); await attach(stream);
      }
      send(ws, "welcome", { node: NODE_ID, authenticated: !!ws.data.userId, symbols: SYMBOLS });
    },
    message(ws, raw) {
      if (!allow(ws)) { send(ws, "error", { code: "rate_limited", message: "too many messages" }); ws.close(1008, "rate limit"); return; }
      router.handle(ws, raw);
    },
    close(ws) {
      for (const s of ws.data.streams) detach(s);
    },
  },
});

console.log(`[${NODE_ID}] gateway on http://localhost:${server.port}`);
