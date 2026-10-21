// Lesson 0006 reference server: the 0005 whiteboard + auth at upgrade, Origin check,
// heartbeats, token expiry, multi-tab presence, and resume-by-sequence-number.
// Run: bun server.ts → open http://localhost:8080/?room=demo in two windows.
// Check: URL=http://localhost:8080 bun test check.test.ts
import { z } from "zod";
import { createRouter, ClientError, send } from "./protocol";
import { signToken, verifyToken } from "./auth";

const PORT = Number(process.env.PORT ?? 8080);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? `http://localhost:${PORT}`).split(",");
const MAX_STROKES = 5000;
const LOG_SIZE = 200; // how many recent events a room remembers for resume
const COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599", "#e8590c", "#5c940d"];

type User = { id: string; name: string; color: string };
type Data = { user: User; room: string; exp: number; lastSeq: number | null; epoch: string | null; expiry?: Timer };
const Stroke = z.object({
  id: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  width: z.number().min(1).max(20),
  points: z.array(z.tuple([z.number(), z.number()])).min(1).max(2000),
});
type Stroke = z.infer<typeof Stroke>;

// ── Room state ──
type Room = {
  epoch: string;                                   // changes if the room is recreated (e.g. server restart)
  seq: number;                                     // last sequence number handed out
  log: { seq: number; msg: string }[];             // last LOG_SIZE durable events, already serialised
  users: Map<string, { user: User; conns: number }>; // presence by USER, not by socket (multi-tab)
  strokes: Stroke[];
};
const rooms = new Map<string, Room>();
function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) rooms.set(id, (r = { epoch: crypto.randomUUID().slice(0, 8), seq: 0, log: [], users: new Map(), strokes: [] }));
  return r;
}
const userList = (r: Room) => [...r.users.values()].map((u) => u.user);

// Durable events get the next seq and go into the log; ephemeral ones (cursor, presence) don't.
function durable(roomId: string, type: string, data: unknown): string {
  const room = getRoom(roomId);
  const msg = JSON.stringify({ type, seq: ++room.seq, data });
  room.log.push({ seq: room.seq, msg });
  if (room.log.length > LOG_SIZE) room.log.shift();
  return msg;
}
const ephemeral = (type: string, data: unknown) => JSON.stringify({ type, data });

const router = createRouter<Data>()
  .on("ping", z.unknown(), () => ({ time: Date.now() }))   // app-level heartbeat for browsers

  .on("cursor", z.object({ x: z.number(), y: z.number() }), ({ ws, data }) => {
    ws.publish(ws.data.room, ephemeral("cursor", { userId: ws.data.user.id, x: data.x, y: data.y }));
  })

  .on("stroke.add", z.object({ stroke: Stroke }), ({ ws, data }) => {
    const room = getRoom(ws.data.room);
    if (room.strokes.length >= MAX_STROKES) throw new ClientError("limit", "room is full, clear it first");
    room.strokes.push(data.stroke);
    const msg = durable(ws.data.room, "stroke.added", { userId: ws.data.user.id, stroke: data.stroke });
    ws.publish(ws.data.room, msg);
    return { seq: room.seq };     // the sender learns the seq of its own stroke
  })

  .on("scene.clear", z.unknown(), ({ ws }) => {
    getRoom(ws.data.room).strokes = [];
    server.publish(ws.data.room, durable(ws.data.room, "scene.cleared", { by: ws.data.user.id }));
    return { seq: getRoom(ws.data.room).seq };
  });

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Stand-in for your real login API: issues a token valid for 1 hour.
    if (req.method === "POST" && url.pathname === "/login") {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name ?? "").trim().slice(0, 32);
      if (!name) return Response.json({ error: "name required" }, { status: 400 });
      const token = signToken({ sub: crypto.randomUUID(), name, exp: Math.floor(Date.now() / 1000) + 3600 });
      return Response.json({ token });
    }

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      // 1. Origin: browsers always send it; reject pages from other sites (cross-site WebSocket hijacking).
      const origin = req.headers.get("origin");
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response("bad origin", { status: 403 });

      // 2. Auth: browsers can't set headers on new WebSocket(), so the token rides in the query string.
      const auth = verifyToken(url.searchParams.get("token"));
      if (!auth) return new Response("invalid or expired token", { status: 401 });

      const room = url.searchParams.get("room") ?? "";
      if (!/^[a-z0-9-]{1,40}$/i.test(room)) return new Response("room must match [a-z0-9-]{1,40}", { status: 400 });

      const lastSeqParam = url.searchParams.get("lastSeq");
      const user = { id: auth.sub, name: auth.name, color: COLORS[parseInt(auth.sub.slice(0, 2), 16) % COLORS.length] };
      const data: Data = {
        user, room, exp: auth.exp,
        lastSeq: lastSeqParam === null ? null : Number(lastSeqParam),
        epoch: url.searchParams.get("epoch"),
      };
      if (server.upgrade(req, { data })) return;
      return new Response("upgrade failed", { status: 400 });
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${import.meta.dir}/public${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },

  websocket: {
    data: {} as Data,
    idleTimeout: 30,   // no traffic (and no pong to Bun's automatic pings) for 30s → connection closed
    open(ws) {
      const { room: roomId, user, lastSeq, epoch } = ws.data;
      const room = getRoom(roomId);

      // Resume if we still have every event after lastSeq in this same room incarnation; otherwise snapshot.
      const oldest = room.log[0]?.seq ?? room.seq + 1;
      const canResume = lastSeq !== null && epoch === room.epoch && lastSeq <= room.seq && lastSeq >= oldest - 1;
      if (canResume) {
        const events = room.log.filter((e) => e.seq > lastSeq!).map((e) => JSON.parse(e.msg));
        send(ws, "room.resume", { you: user, users: userList(room), events, seq: room.seq, epoch: room.epoch });
      } else {
        send(ws, "room.state", { you: user, users: userList(room), strokes: room.strokes, seq: room.seq, epoch: room.epoch });
      }

      // Presence by user: only the FIRST connection of a user announces them.
      const entry = room.users.get(user.id);
      if (entry) entry.conns++;
      else {
        room.users.set(user.id, { user, conns: 1 });
        ws.publish(roomId, ephemeral("user.joined", { user }));
      }
      ws.subscribe(roomId);

      // Token expiry: close with an app code; the client fetches a fresh token and reconnects.
      const msLeft = ws.data.exp * 1000 - Date.now();
      ws.data.expiry = setTimeout(() => ws.close(4001, "token expired"), msLeft);
    },
    message(ws, raw) {
      router.handle(ws, raw);
    },
    close(ws) {
      clearTimeout(ws.data.expiry);
      const room = rooms.get(ws.data.room);
      const entry = room?.users.get(ws.data.user.id);
      if (!room || !entry) return;
      if (--entry.conns === 0) {
        room.users.delete(ws.data.user.id);
        server.publish(ws.data.room, ephemeral("user.left", { userId: ws.data.user.id }));
      }
      // Keep the room (with its log) for 60s after the last user leaves, so quick reconnects can resume.
      if (room.users.size === 0) setTimeout(() => room.users.size === 0 && rooms.delete(ws.data.room), 60_000);
    },
  },
});

console.log(`lesson 0006 whiteboard on http://localhost:${server.port}/?room=demo`);
