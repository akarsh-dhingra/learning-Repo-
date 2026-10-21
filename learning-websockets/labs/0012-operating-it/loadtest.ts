// A WebSocket load test for the whiteboard cluster. Answers: how many sockets, at what latency, at what cost?
//   bun loadtest.ts [connections=2000] [rooms=100] [seconds=20]
// Spreads connections round-robin over NODES (default 8081,8082,8083), ramps up at RAMP/s, then every client:
//   • sends a cursor 10×/s (ephemeral path)      • 1 in 10 clients draws a stroke every 2s (durable path)
// Delivery latency = time from a stroke being sent to OTHER clients receiving it (clocks are shared: same machine).
import { signToken } from "./auth";

const CONNS = Number(process.argv[2] ?? 2000);
const ROOMS = Number(process.argv[3] ?? 100);
const SECONDS = Number(process.argv[4] ?? 20);
const NODES = (process.env.NODES ?? "8081,8082,8083").split(",");
const RAMP = Number(process.env.RAMP ?? 500); // new connections per second
const PREFIX = process.env.PREFIX ?? "load"; // run several generators with different PREFIXes to spread the client load
const AFFINITY = process.env.AFFINITY === "1"; // route by ROOM (like nginx `hash $arg_room consistent`) instead of round-robin
const CURSOR_HZ = Number(process.env.CURSOR_HZ ?? 10); // cursor sends per client per second (0 = off)

const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const connectMs: number[] = [], latencyMs: number[] = [];
let failed = 0, received = 0, closedEarly = 0;
const sockets: WebSocket[] = [];

const metric = async (port: string, name: string) =>
  Number(new RegExp(`^${name}\\{[^}]*\\} (\\S+)`, "m").exec(await (await fetch(`http://localhost:${port}/metrics`)).text())?.[1]);
const rssBefore = new Map(await Promise.all(NODES.map(async (p) => [p, await metric(p, "process_resident_memory_bytes")] as const)));
console.log(`ramping ${CONNS} connections into ${ROOMS} rooms on nodes ${NODES.join(", ")} at ${RAMP}/s (${AFFINITY ? "room affinity" : "round-robin"})…`);
const t0 = performance.now();
await Promise.all(Array.from({ length: CONNS }, (_, i) => new Promise<void>((done) => {
  setTimeout(() => {
    const token = signToken({ sub: `${PREFIX}-${i}`, name: `${PREFIX}-${i}`, exp: Math.floor(Date.now() / 1000) + 3600 });
    const start = performance.now();
    const room = `${PREFIX}-${i % ROOMS}`;
    const node = AFFINITY ? NODES[Number(BigInt(Bun.hash(room)) % BigInt(NODES.length))] : NODES[i % NODES.length];
    const ws = new WebSocket(`ws://localhost:${node}/?room=${room}&token=${token}`);
    ws.onopen = () => { connectMs.push(performance.now() - start); sockets.push(ws); done(); };
    ws.onerror = () => { failed++; done(); };
    ws.onclose = () => { closedEarly++; };
    ws.onmessage = (e) => {
      received++;
      const s = String(e.data);
      if (!s.startsWith('{"type":"stroke.added"')) return;
      const m = /"id":"lt-(\d+)-(\d+)"/.exec(s);
      if (m && Number(m[2]) !== i) latencyMs.push(Date.now() - Number(m[1]));
    };
  }, (i / RAMP) * 1000);
})));
console.log(`connected ${sockets.length}/${CONNS} in ${((performance.now() - t0) / 1000).toFixed(1)}s (failed: ${failed})`);

const cursorTimer = setInterval(() => {
  for (const ws of sockets) if (ws.readyState === 1) ws.send(`{"type":"cursor","data":{"x":${Math.random() * 1200 | 0},"y":${Math.random() * 800 | 0}}}`);
}, CURSOR_HZ > 0 ? 1000 / CURSOR_HZ : 2 ** 31 - 1);
let tick = 0;
const strokeTimer = setInterval(() => {
  tick++;
  sockets.forEach((ws, i) => {
    if (i % 10 !== tick % 10 || ws.readyState !== 1) return; // each tenth of the drawers, every 200ms → each every 2s
    const id = `lt-${Date.now()}-${i}`;
    ws.send(JSON.stringify({ type: "stroke.add", data: { stroke: { id, color: "#1971c2", width: 2, points: [[1, 1], [50, 50]] } } }));
  });
}, 200);

const receivedBefore = received;
await Bun.sleep(SECONDS * 1000);
clearInterval(cursorTimer); clearInterval(strokeTimer);

const r = (n: number) => (Number.isNaN(n) ? "–" : n.toFixed(1));
console.log(`\n── results over ${SECONDS}s ──`);
console.log(`connect time      p50 ${r(pct(connectMs, 50))} ms · p99 ${r(pct(connectMs, 99))} ms`);
console.log(`stroke delivery   p50 ${r(pct(latencyMs, 50))} ms · p95 ${r(pct(latencyMs, 95))} ms · p99 ${r(pct(latencyMs, 99))} ms  (${latencyMs.length.toLocaleString()} samples)`);
console.log(`client receive    ${Math.round((received - receivedBefore) / SECONDS).toLocaleString()} msgs/s total`);
console.log(`dropped mid-test  ${closedEarly}`);
for (const port of NODES) {
  const get = (name: string) => metric(port, name);
  const conns = await get("ws_connections"), rss = await get("process_resident_memory_bytes");
  const perSocket = (rss - rssBefore.get(port)!) / Math.max(1, conns) / 1024;
  console.log(`node :${port}  ${conns} sockets · RSS ${(rss / 1e6).toFixed(0)} MB (+${Math.round(perSocket)} KB per socket under load) · loop lag ${await get("nodejs_eventloop_lag_ms")} ms · kicked ${await get("ws_kicked_total")}`);
}
sockets.forEach((ws) => ws.close());
process.exit(0);
