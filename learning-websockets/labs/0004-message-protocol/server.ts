// Lesson 0004 reference server: a chat lobby on top of the protocol router.
// Run: bun server.ts    Check: URL=http://localhost:8080 bun test check.test.ts
import { z } from "zod";
import { createRouter, ClientError, send } from "./protocol";

type Data = { name: string };
const PORT = Number(process.env.PORT ?? 8080);

const router = createRouter<Data>()
  .on("ping", z.unknown(), () => ({ time: Date.now() }))

  .on("echo", z.unknown(), ({ data }) => data)

  .on("chat.send", z.object({ text: z.string().trim().min(1).max(500) }), ({ ws, data }) => {
    if (data.text.startsWith("/admin")) throw new ClientError("forbidden", "you are not an admin");
    const event = JSON.stringify({ type: "chat.message", data: { from: ws.data.name, text: data.text, at: Date.now() } });
    server.publish("lobby", event);
    return { delivered: true };
  });

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const name = new URL(req.url).searchParams.get("name")?.slice(0, 32) || "anon";
    if (server.upgrade(req, { data: { name } })) return;
    return new Response("WebSocket only", { status: 426 });
  },
  websocket: {
    data: {} as Data,
    open(ws) {
      ws.subscribe("lobby");
      send(ws, "welcome", { name: ws.data.name });
    },
    message(ws, raw) {
      router.handle(ws, raw);
    },
  },
});

console.log(`lesson 0004 server on ws://localhost:${server.port}`);
