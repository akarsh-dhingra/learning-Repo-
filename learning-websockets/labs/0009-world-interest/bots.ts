// Spawns N wandering bots, then reports what the server had to send per second.
// Usage: bun bots.ts [count=300] [seconds=10]      (server: bun server.ts, or INTEREST=off bun server.ts)
const URL = process.env.URL ?? "http://localhost:8090";
const N = Number(process.argv[2] ?? 300);
const SECONDS = Number(process.argv[3] ?? 10);
const WS = URL.replace(/^http/, "ws");

let received = 0, receivedBytes = 0;
const bots = await Promise.all(Array.from({ length: N }, (_, i) => new Promise<{ ws: WebSocket; x: number; y: number; angle: number }>((resolve) => {
  // spread bots over a 1500×1500 area in the middle of the world
  const x = 750 + Math.random() * 1500, y = 750 + Math.random() * 1500;
  const ws = new WebSocket(`${WS}/?name=bot${i}&x=${x}&y=${y}`);
  const bot = { ws, x, y, angle: Math.random() * Math.PI * 2 };
  ws.onmessage = (e) => { received++; receivedBytes += String(e.data).length; };
  ws.onopen = () => resolve(bot);
})));

// every bot moves 10 times a second, like a player holding an arrow key
const mover = setInterval(() => {
  for (const b of bots) {
    b.angle += (Math.random() - 0.5) * 0.6;
    b.x = Math.max(0, Math.min(3000, b.x + Math.cos(b.angle) * 12));
    b.y = Math.max(0, Math.min(3000, b.y + Math.sin(b.angle) * 12));
    b.ws.send(JSON.stringify({ type: "move", data: { x: b.x, y: b.y } }));
  }
}, 100);

const before = await (await fetch(`${URL}/stats`)).json();
await Bun.sleep(SECONDS * 1000);
const after = await (await fetch(`${URL}/stats`)).json();
clearInterval(mover);
const per = (k: string) => Math.round((after[k] - before[k]) / SECONDS);
console.log(`${N} bots · interest management ${after.interest ? "ON" : "OFF"}`);
console.log(`  server → clients: ${per("msgsOut").toLocaleString()} msgs/s, ${(per("bytesOut") / 1e6).toFixed(2)} MB/s`);
console.log(`  avg payload a bot received per second: ${Math.round(receivedBytes / SECONDS / N).toLocaleString()} bytes`);
console.log(`  last tick took ${after.lastTickMs} ms (budget: 100 ms)`);
bots.forEach((b) => b.ws.close());
process.exit(0);
