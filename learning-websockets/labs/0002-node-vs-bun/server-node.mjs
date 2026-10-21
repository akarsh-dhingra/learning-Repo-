// Chat-room server on Node + ws: every message is broadcast to every connected client.
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  ws.on("message", (data, isBinary) => {
    for (const client of wss.clients) {
      client.send(data, { binary: isBinary });
    }
  });
});

console.log(`node ${process.version} chat server on :${PORT}`);
