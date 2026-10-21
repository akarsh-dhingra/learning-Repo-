// Chat-room server on Bun: every message is broadcast to every connected client.
const PORT = Number(process.env.PORT ?? 8080);

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return; // handshake done, Bun answered 101
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  },
  websocket: {
    open(ws) {
      ws.subscribe("room");
    },
    message(ws, msg) {
      server.publish("room", msg); // publish to all subscribers, sender included
    },
  },
});

console.log(`bun ${Bun.version} chat server on :${server.port}`);
