// Floods a room with big strokes (≈30 KB each) and fast cursor moves, then prints the server's /stats.
// Usage: bun flood.ts [room] [strokes]
import { signToken } from "./auth";

const room = process.argv[2] ?? "demo";
const count = Number(process.argv[3] ?? 600);
const token = signToken({ sub: `flood-${crypto.randomUUID()}`, name: "flooder", exp: Math.floor(Date.now() / 1000) + 3600 });
const ws = new WebSocket(`ws://localhost:8080/?room=${room}&token=${token}`);
await new Promise((r) => (ws.onopen = r));

const points = Array.from({ length: 2000 }, (_, i) => [i % 1200, (i * 7) % 800]);
let acked = 0;
ws.onmessage = (e) => { if (JSON.parse(String(e.data)).type === "ack") acked++; };

const t0 = performance.now();
for (let i = 0; i < count; i++) {
  ws.send(JSON.stringify({ type: "stroke.add", id: String(i), data: { stroke: { id: `f${i}`, color: "#e03131", width: 2, points } } }));
  ws.send(JSON.stringify({ type: "cursor", data: { x: i % 1200, y: i % 800 } }));
}
while (acked < count) await Bun.sleep(20);
console.log(`sent ${count} strokes (~${Math.round((count * JSON.stringify(points).length) / 1e6)} MB) in ${Math.round(performance.now() - t0)} ms`);
await Bun.sleep(300);
console.log("server stats:", await (await fetch("http://localhost:8080/stats")).json());
ws.close();
