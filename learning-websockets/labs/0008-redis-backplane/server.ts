// Lesson 0008 reference server: the 0007 whiteboard, now stateless enough to run as MANY nodes.
// Room state, sequence numbers, the resume log and presence live in Redis; Redis Pub/Sub is the backplane.
//
// Run 3 nodes + Redis:  ./start-cluster.sh      (stop: ./stop-cluster.sh)
// Or one node by hand:  NODE_ID=a PORT=8081 bun server.ts
// Check:                bun test check.test.ts   (expects nodes on 8081 and 8082)
import { z } from "zod";
import type { ServerWebSocket } from "bun";
import { createRouter, ClientError, send } from "./protocol";
import { verifyToken, signToken } from "./auth";
import * as rooms from "./rooms";

const PORT = Number(process.env.PORT ?? 8081);
const NODE_ID = process.env.NODE_ID ?? `node-${PORT}`;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:8080,http://localhost:8081,http://localhost:8082,http://localhost:8083").split(",");
const MAX_STROKES = 5000;
const CURSOR_TICK_MS = 50;
const SOFT_LIMIT = 64 * 1024;
const HARD_LIMIT = 1024 * 1024;
const COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599", "#e8590c", "#5c940d"];
const stats = { node: NODE_ID, connections: 0, cursorBatches: 0, cursorDrops: 0, kicked: 0, fromRedis: 0 };

type User = { id: string; name: string; color: string };
type Data = { user: User; room: string; exp: number; lastSeq: number | null; epoch: string | null; expiry?: Timer };
type Socket = ServerWebSocket<Data>;
const Stroke = z.object({
  id: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  width: z.number().min(1).max(20),
  points: z.array(z.tuple([z.number(), z.number()])).min(1).max(2000),
});

// Local bookkeeping only: which sockets on THIS node are in which room, and their pending cursors.
const local = new Map<string, { sockets: Set<Socket>; cursors: Map<string, { userId: string; x: number; y: number }> }>();
const localRoom = (id: string) => local.get(id) ?? local.set(id, { sockets: new Set(), cursors: new Map() }).get(id)!;

// Everything a node sends to its sockets arrives here, from Redis. Including its own events.
function deliver(room: string, msg: string) {
  stats.fromRedis++;
  const lr = local.get(room);
  if (!lr) return;
  if (msg.startsWith('{"type":"cursors"')) {
    for (const ws of lr.sockets) {
      if (ws.getBufferedAmount() > SOFT_LIMIT) { stats.cursorDrops++; continue; }
      ws.send(msg);
    }
    return;
  }
  server.publish(room, msg); // local fan-out to this node's subscribers
  for (const ws of lr.sockets) {
    if (ws.getBufferedAmount() > HARD_LIMIT) { stats.kicked++; ws.terminate(); }
  }
}

const router = createRouter<Data>()
  .on("ping", z.unknown(), () => ({ time: Date.now(), node: NODE_ID }))

  .on("cursor", z.object({ x: z.number(), y: z.number() }), ({ ws, data }) => {
    localRoom(ws.data.room).cursors.set(ws.data.user.id, { userId: ws.data.user.id, x: data.x, y: data.y });
  })

  .on("stroke.add", z.object({ stroke: Stroke }), async ({ ws, data }) => {
    if ((await rooms.strokeCount(ws.data.room)) >= MAX_STROKES) throw new ClientError("limit", "room is full, clear it first");
    const seq = await rooms.emitDurable(ws.data.room, "stroke.added", { userId: ws.data.user.id, stroke: data.stroke }, "add", data.stroke);
    return { seq };
  })

  .on("scene.clear", z.unknown(), async ({ ws }) => {
    return { seq: await rooms.emitDurable(ws.data.room, "scene.cleared", { by: ws.data.user.id }, "clear") };
  });

// Each node batches ITS users' cursors and publishes one batch per room per tick.
setInterval(() => {
  for (const [room, lr] of local) {
    if (lr.cursors.size === 0) continue;
    rooms.emitEphemeral(room, "cursors", [...lr.cursors.values()]);
    lr.cursors.clear();
    stats.cursorBatches++;
  }
}, CURSOR_TICK_MS);

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/stats") return Response.json(stats);
    if (url.pathname === "/healthz") return new Response("ok");

    if (req.method === "POST" && url.pathname === "/login") {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name ?? "").trim().slice(0, 32);
      if (!name) return Response.json({ error: "name required" }, { status: 400 });
      return Response.json({ token: signToken({ sub: crypto.randomUUID(), name, exp: Math.floor(Date.now() / 1000) + 3600 }) });
    }

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const origin = req.headers.get("origin");
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response("bad origin", { status: 403 });
      const auth = verifyToken(url.searchParams.get("token"));
      if (!auth) return new Response("invalid or expired token", { status: 401 });
      const room = url.searchParams.get("room") ?? "";
      if (!/^[a-z0-9-]{1,40}$/i.test(room)) return new Response("room must match [a-z0-9-]{1,40}", { status: 400 });
      const lastSeq = url.searchParams.get("lastSeq");
      const user = { id: auth.sub, name: auth.name, color: COLORS[parseInt(auth.sub.slice(0, 2), 16) % COLORS.length] };
      if (server.upgrade(req, { data: { user, room, exp: auth.exp, lastSeq: lastSeq === null ? null : Number(lastSeq), epoch: url.searchParams.get("epoch") } })) return;
      return new Response("upgrade failed", { status: 400 });
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${import.meta.dir}/public${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },

  websocket: {
    data: {} as Data,
    idleTimeout: 30,
    backpressureLimit: 4 * HARD_LIMIT,
    async open(ws) {
      stats.connections++;
      const { room, user, lastSeq, epoch } = ws.data;

      // ORDER MATTERS: start receiving live events BEFORE reading the snapshot, so nothing falls in the gap.
      // Events that arrive before the snapshot are duplicates or newer; the client sorts it out by seq.
      ws.subscribe(room);
      localRoom(room).sockets.add(ws);
      await rooms.attach(room, deliver);

      const snap = await rooms.snapshot(room);
      let resumed = false;
      if (lastSeq !== null && epoch === snap.epoch && lastSeq <= snap.seq) {
        const { events, oldest } = await rooms.eventsAfter(room, lastSeq);
        if (oldest !== undefined ? lastSeq >= oldest - 1 : lastSeq === snap.seq) {
          send(ws, "room.resume", { you: user, users: snap.users.filter((u) => u.id !== user.id), events, seq: snap.seq, epoch: snap.epoch });
          resumed = true;
        }
      }
      if (!resumed) send(ws, "room.state", { you: user, users: snap.users.filter((u) => u.id !== user.id), strokes: snap.strokes, seq: snap.seq, epoch: snap.epoch });

      if (await rooms.presenceJoin(room, user)) rooms.emitEphemeral(room, "user.joined", { user });
      ws.data.expiry = setTimeout(() => ws.close(4001, "token expired"), ws.data.exp * 1000 - Date.now());
    },
    message(ws, raw) {
      router.handle(ws, raw);
    },
    async close(ws) {
      stats.connections--;
      clearTimeout(ws.data.expiry);
      const lr = local.get(ws.data.room);
      lr?.sockets.delete(ws);
      if (lr && lr.sockets.size === 0) local.delete(ws.data.room);
      await rooms.detach(ws.data.room);
      if (await rooms.presenceLeave(ws.data.room, ws.data.user.id)) rooms.emitEphemeral(ws.data.room, "user.left", { userId: ws.data.user.id });
    },
  },
});

console.log(`[${NODE_ID}] whiteboard node on http://localhost:${server.port}/?room=demo`);
