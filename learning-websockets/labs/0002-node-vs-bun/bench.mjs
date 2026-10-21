// Load generator: N clients in one room, each keeps WINDOW of its own messages in flight.
// Counts every message delivered to every client (that is what "messages/sec" means for a chat room).
// Run with: bun bench.mjs [clients] [seconds]   (works under node too: uses the built-in WebSocket client)
const URL = process.env.URL ?? "ws://localhost:8080";
const CLIENTS = Number(process.argv[2] ?? 16);
const SECONDS = Number(process.argv[3] ?? 10);
const WINDOW = 32;
const PAYLOAD = "x".repeat(64);

let delivered = 0;
let running = true;

function connect(id) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let inFlight = 0;
    const pump = () => {
      while (running && inFlight < WINDOW) {
        ws.send(`${id}|${PAYLOAD}`);
        inFlight++;
      }
    };
    ws.onopen = () => resolve({ ws, pump });
    ws.onmessage = (e) => {
      delivered++;
      if (e.data.startsWith(`${id}|`)) { inFlight--; pump(); }
    };
  });
}

const clients = await Promise.all(Array.from({ length: CLIENTS }, (_, i) => connect(i)));
const t0 = performance.now();
clients.forEach((c) => c.pump());

await new Promise((r) => setTimeout(r, SECONDS * 1000));
running = false;
const secs = (performance.now() - t0) / 1000;
console.log(`${CLIENTS} clients · ${Math.round(delivered / secs).toLocaleString()} msgs/sec delivered`);
clients.forEach((c) => c.ws.close());
process.exit(0);
