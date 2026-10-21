// A deliberately slow consumer: completes the WebSocket handshake, then STOPS READING.
// Everything the server sends piles up (kernel buffers first, then the server's send buffer).
// Run it with NODE, not bun (Bun's node:net keeps reading even when paused):
//   node slow-client.mjs [room]        then, in another terminal: bun flood.ts [room]
import net from "node:net";
import { createHmac, randomUUID } from "node:crypto";

const SECRET = process.env.SECRET ?? "dev-secret-change-me";
const PORT = Number(process.env.PORT ?? 8080);
const room = process.argv[2] ?? "demo";

const part = Buffer.from(JSON.stringify({ sub: `slow-${randomUUID()}`, name: "slowpoke", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
const token = `${part}.${createHmac("sha256", SECRET).update(part).digest("base64url")}`;

const sock = net.connect(PORT, "localhost", () => {
  sock.write(
    `GET /?room=${room}&token=${token} HTTP/1.1\r\nHost: localhost:${PORT}\r\n` +
    `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );
});
sock.once("data", (buf) => {
  if (!buf.toString().startsWith("HTTP/1.1 101")) { console.error(buf.toString().split("\r\n")[0]); process.exit(1); }
  sock.pause(); // ← the whole trick: never read again
  console.log(`READY: slow client joined "${room}" and stopped reading`);
  // A paused socket never notices the server hanging up. So every 300ms we WRITE a tiny masked pong frame
  // (unsolicited pongs are allowed as heartbeats). Writing to a connection the server killed fails → we know.
  const pong = Buffer.from([0x8a, 0x80, 1, 2, 3, 4]);
  sock.on("error", (e) => process.stdout.write(`KICKED: server dropped the slow client (${e.code})\n`, () => process.exit(0)));
  setInterval(() => sock.write(pong), 300);
});
setTimeout(() => process.stdout.write("TIMEOUT: still connected after 20s\n", () => process.exit(2)), 20_000);
