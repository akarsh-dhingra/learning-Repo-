// Lesson 0010 reference: a space node. Owns a subset of spaces (Pattern B) and runs the 0009 world for each.
//   • registers itself in Redis with a TTL heartbeat (cluster.ts)
//   • refuses connections for spaces it doesn't own (HTTP 421 → client asks the directory again)
//   • when membership changes and it loses a space, it moves those players away (close 4010)
//   • writes presence (who is online in which space) with heartbeat timestamps
//   • caps players per space (a hot space must not take the node down)
// Run 3 nodes + directory + Redis: ./start-cluster.sh
import { z } from "zod";
import type { ServerWebSocket } from "bun";
import { createRouter, send } from "./protocol";
import { redis, liveNodes, ownerOf, startHeartbeat, presenceKey, type Node } from "./cluster";

const PORT = Number(process.env.PORT ?? 9001);
const NODE_ID = process.env.NODE_ID ?? `node-${PORT}`;
const SELF: Node = { id: NODE_ID, url: `ws://localhost:${PORT}` };
const MAX_PER_SPACE = Number(process.env.MAX_PER_SPACE ?? 200);
const WORLD = { w: 3000, h: 3000 };
const RADIUS = 300, TICK_MS = 100, MAX_STEP = 50;

type Player = { id: string; name: string; x: number; y: number; dirty: boolean; seen: Set<string>; ws: ServerWebSocket<Data>; presence: string };
type Data = { player: Player; space: string };
type Space = { players: Map<string, Player>; grid: Map<string, Set<Player>> };
const spaces = new Map<string, Space>();
const getSpace = (id: string) => spaces.get(id) ?? spaces.set(id, { players: new Map(), grid: new Map() }).get(id)!;

// ── Membership: cache the live node list (refreshed every second) instead of asking Redis per connection ──
let nodes: Node[] = [];
async function refreshMembership() {
  nodes = await liveNodes();
  if (!nodes.some((n) => n.id === NODE_ID)) nodes.push(SELF); // our own key may not be visible yet at boot
  // Rebalance: a node joined (or we were briefly missing) and a space we host now belongs elsewhere.
  for (const [id, s] of spaces) {
    if (ownerOf(id, nodes)?.id !== NODE_ID) for (const p of s.players.values()) p.ws.close(4010, "space moved");
  }
}
startHeartbeat(SELF);
await refreshMembership();
setInterval(refreshMembership, 1000);

// ── The 0009 world, per space ──
const cellKey = (x: number, y: number) => `${Math.floor(x / RADIUS)},${Math.floor(y / RADIUS)}`;
const gridAdd = (s: Space, p: Player) => { const k = cellKey(p.x, p.y); (s.grid.get(k) ?? s.grid.set(k, new Set()).get(k)!).add(p); };
const gridRemove = (s: Space, p: Player) => s.grid.get(cellKey(p.x, p.y))?.delete(p);
function nearby(s: Space, p: Player) {
  const cx = Math.floor(p.x / RADIUS), cy = Math.floor(p.y / RADIUS), out: Player[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
    for (const o of s.grid.get(`${cx + dx},${cy + dy}`) ?? [])
      if (o !== p && (o.x - p.x) ** 2 + (o.y - p.y) ** 2 <= RADIUS ** 2) out.push(o);
  return out;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const router = createRouter<Data>()
  .on("move", z.object({ x: z.number(), y: z.number() }), ({ ws, data }) => {
    const p = ws.data.player, s = getSpace(ws.data.space);
    let dx = data.x - p.x, dy = data.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_STEP) { dx *= MAX_STEP / d; dy *= MAX_STEP / d; }
    gridRemove(s, p);
    p.x = Math.round(clamp(p.x + dx, 0, WORLD.w)); p.y = Math.round(clamp(p.y + dy, 0, WORLD.h));
    gridAdd(s, p);
    p.dirty = true;
  })
  .on("chat.send", z.object({ text: z.string().trim().min(1).max(300) }), ({ ws, data }) => {
    const p = ws.data.player, s = getSpace(ws.data.space);
    const msg = JSON.stringify({ type: "chat.message", data: { from: p.id, name: p.name, text: data.text } });
    const audience = [p, ...nearby(s, p)];
    audience.forEach((o) => o.ws.send(msg));
    return { heardBy: audience.length - 1 };
  });

setInterval(() => {
  for (const s of spaces.values()) {
    for (const p of s.players.values()) {
      const enter: object[] = [], moves: (string | number)[][] = [], ids = new Set<string>();
      for (const o of nearby(s, p)) {
        ids.add(o.id);
        if (!p.seen.has(o.id)) enter.push({ id: o.id, name: o.name, x: o.x, y: o.y });
        else if (o.dirty) moves.push([o.id, o.x, o.y]);
      }
      const leave = [...p.seen].filter((id) => !ids.has(id));
      p.seen = ids;
      const you = p.dirty ? { x: p.x, y: p.y } : undefined;
      if (enter.length || moves.length || leave.length || you) p.ws.send(JSON.stringify({ type: "tick", data: { you, enter, moves, leave } }));
    }
    for (const p of s.players.values()) p.dirty = false;
  }
}, TICK_MS);

// ── Presence heartbeat: refresh the timestamp of every local player every 5s ──
setInterval(() => {
  const now = String(Date.now());
  for (const [id, s] of spaces) for (const p of s.players.values()) redis.send("ZADD", [presenceKey(id), now, p.presence]);
}, 5000);

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/stats") return Response.json({ node: NODE_ID, spaces: Object.fromEntries([...spaces].map(([id, s]) => [id, s.players.size])) });
    if (req.method === "POST" && url.pathname === "/__crash") { console.log(`[${NODE_ID}] crashing on purpose`); setTimeout(() => process.exit(1), 10); return new Response("bye"); }

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const space = url.searchParams.get("space") ?? "";
      if (!/^[a-z0-9-]{1,40}$/i.test(space)) return new Response("bad space", { status: 400 });
      const owner = ownerOf(space, nodes);
      if (owner?.id !== NODE_ID) return new Response(`space ${space} is owned by ${owner?.id}`, { status: 421 }); // Misdirected Request
      if ((spaces.get(space)?.players.size ?? 0) >= MAX_PER_SPACE) return new Response("space is full", { status: 503 });

      const name = (url.searchParams.get("name") || "anon").slice(0, 24);
      const x = clamp(Number(url.searchParams.get("x") ?? 1500 + Math.random() * 200 - 100), 0, WORLD.w);
      const y = clamp(Number(url.searchParams.get("y") ?? 1500 + Math.random() * 200 - 100), 0, WORLD.h);
      const id = crypto.randomUUID().slice(0, 8);
      const player = { id, name, x: Math.round(x), y: Math.round(y), dirty: true, seen: new Set(), presence: JSON.stringify({ id, name }) } as unknown as Player;
      if (server.upgrade(req, { data: { player, space } })) return;
      return new Response("upgrade failed", { status: 400 });
    }
    return new Response("space node: connect via the directory", { status: 404 });
  },
  websocket: {
    data: {} as Data,
    open(ws) {
      const { player: p, space } = ws.data, s = getSpace(space);
      p.ws = ws;
      s.players.set(p.id, p);
      gridAdd(s, p);
      redis.send("ZADD", [presenceKey(space), String(Date.now()), p.presence]);
      send(ws, "world.joined", { you: { id: p.id, name: p.name, x: p.x, y: p.y }, node: NODE_ID, space, world: WORLD, radius: RADIUS, tickMs: TICK_MS });
    },
    message(ws, raw) { router.handle(ws, raw); },
    close(ws) {
      const { player: p, space } = ws.data, s = getSpace(space);
      s.players.delete(p.id);
      gridRemove(s, p);
      if (s.players.size === 0) spaces.delete(space);
      redis.send("ZREM", [presenceKey(space), p.presence]);
    },
  },
});

console.log(`[${NODE_ID}] space node on ${SELF.url}`);
