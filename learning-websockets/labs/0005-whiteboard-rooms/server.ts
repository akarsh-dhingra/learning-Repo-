// Lesson 0005 reference server: Excalidraw-style rooms.
// Run: bun server.ts → open http://localhost:8080/?room=demo in two windows.
// Check: URL=http://localhost:8080 bun test check.test.ts
import { z } from "zod";
import { createRouter, ClientError, send } from "./protocol";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_STROKES = 5000;
const COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599", "#e8590c", "#5c940d"];

type User = { id: string; name: string; color: string };
type Data = { user: User; room: string };
const Stroke = z.object({
  id: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  width: z.number().min(1).max(20),
  points: z.array(z.tuple([z.number(), z.number()])).min(1).max(2000),
});
type Stroke = z.infer<typeof Stroke>;

// ── Room state lives in memory on this one process (lesson 0008 makes this multi-node) ──
type Room = { users: Map<string, User>; strokes: Stroke[] };
const rooms = new Map<string, Room>();
const getRoom = (id: string) => rooms.get(id) ?? rooms.set(id, { users: new Map(), strokes: [] }).get(id)!;

// Room events are published as one pre-serialised string: serialise once, fan out many.
const event = (type: string, data: unknown) => JSON.stringify({ type, data });

const router = createRouter<Data>()
  // Ephemeral: not stored, no ack, sender excluded. Losing one is harmless; the next one replaces it.
  .on("cursor", z.object({ x: z.number(), y: z.number() }), ({ ws, data }) => {
    ws.publish(ws.data.room, event("cursor", { userId: ws.data.user.id, x: data.x, y: data.y }));
  })

  // Durable: stored in the room scene so late joiners see it, acked so the sender knows it landed.
  .on("stroke.add", z.object({ stroke: Stroke }), ({ ws, data }) => {
    const room = getRoom(ws.data.room);
    if (room.strokes.length >= MAX_STROKES) throw new ClientError("limit", "room is full, clear it first");
    room.strokes.push(data.stroke);
    ws.publish(ws.data.room, event("stroke.added", { userId: ws.data.user.id, stroke: data.stroke }));
    return { count: room.strokes.length };
  })

  .on("scene.clear", z.unknown(), ({ ws }) => {
    getRoom(ws.data.room).strokes = [];
    server.publish(ws.data.room, event("scene.cleared", { by: ws.data.user.id }));
  });

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const room = url.searchParams.get("room") ?? "";
      if (!/^[a-z0-9-]{1,40}$/i.test(room)) return new Response("room must match [a-z0-9-]{1,40}", { status: 400 });
      const name = (url.searchParams.get("name") || "anon").slice(0, 32);
      const user = { id: crypto.randomUUID(), name, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
      if (server.upgrade(req, { data: { user, room } })) return;
      return new Response("upgrade failed", { status: 400 });
    }

    // Static files for the browser client
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${import.meta.dir}/public${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },

  websocket: {
    data: {} as Data,
    open(ws) {
      const room = getRoom(ws.data.room);
      // 1. snapshot for the newcomer (before they're subscribed, so no duplicate events)
      send(ws, "room.state", { you: ws.data.user, users: [...room.users.values()], strokes: room.strokes });
      // 2. tell everyone else
      ws.publish(ws.data.room, event("user.joined", { user: ws.data.user }));
      room.users.set(ws.data.user.id, ws.data.user);
      ws.subscribe(ws.data.room);
    },
    message(ws, raw) {
      router.handle(ws, raw);
    },
    close(ws) {
      const room = getRoom(ws.data.room);
      room.users.delete(ws.data.user.id);
      server.publish(ws.data.room, event("user.left", { userId: ws.data.user.id }));
      if (room.users.size === 0) rooms.delete(ws.data.room); // free memory; a real app would persist first
    },
  },
});

console.log(`lesson 0005 whiteboard on http://localhost:${server.port}/?room=demo`);
