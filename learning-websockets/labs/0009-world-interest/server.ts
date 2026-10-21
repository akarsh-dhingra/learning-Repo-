// Lesson 0009 reference server: a Gather Town-style 2D world.
//   • server-authoritative positions (clients send where they WANT to go; the server clamps it)
//   • a fixed tick loop: input is applied immediately, but updates go out once per tick, batched
//   • interest management: each player only hears about players within RADIUS (spatial grid lookup)
//   • per-recipient deltas: "enter" (new in view, with name), "moves" (changed), "leave" (gone from view)
//   • proximity chat: messages reach only players within RADIUS
// Run: bun server.ts → http://localhost:8090      Compare: INTEREST=off bun server.ts
// Check: URL=http://localhost:8090 bun test check.test.ts
import { z } from "zod";
import type { ServerWebSocket } from "bun";
import { createRouter, send } from "./protocol";

const PORT = Number(process.env.PORT ?? 8090);
const WORLD = { w: 3000, h: 3000 };
const RADIUS = 300;          // how far you can "see" and be heard
const TICK_MS = 100;         // 10 ticks/sec
const MAX_STEP = 50;         // max distance per move message (anti-teleport)
const INTEREST = process.env.INTEREST !== "off";

type Player = { id: string; name: string; x: number; y: number; dirty: boolean; ws: ServerWebSocket<Data>; seen: Set<string> };
type Data = { player: Player };
const players = new Map<string, Player>();
const stats = { players: 0, ticks: 0, msgsOut: 0, bytesOut: 0, lastTickMs: 0, interest: INTEREST };

// ── Spatial grid: cell size = RADIUS, so everything within RADIUS is in the 3×3 cells around you ──
const grid = new Map<string, Set<Player>>();
const cellKey = (x: number, y: number) => `${Math.floor(x / RADIUS)},${Math.floor(y / RADIUS)}`;
function gridAdd(p: Player) { const k = cellKey(p.x, p.y); (grid.get(k) ?? grid.set(k, new Set()).get(k)!).add(p); }
function gridRemove(p: Player) { grid.get(cellKey(p.x, p.y))?.delete(p); }
function nearby(p: Player): Player[] {
  if (!INTEREST) return [...players.values()].filter((o) => o !== p);
  const cx = Math.floor(p.x / RADIUS), cy = Math.floor(p.y / RADIUS), out: Player[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const o of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (o !== p && (o.x - p.x) ** 2 + (o.y - p.y) ** 2 <= RADIUS ** 2) out.push(o);
    }
  }
  return out;
}

function sendRaw(p: Player, msg: string) {
  p.ws.send(msg);
  stats.msgsOut++;
  stats.bytesOut += msg.length;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const router = createRouter<Data>()
  // Input: applied to server state now, broadcast on the next tick.
  .on("move", z.object({ x: z.number(), y: z.number() }), ({ ws, data }) => {
    const p = ws.data.player;
    let dx = data.x - p.x, dy = data.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_STEP) { dx *= MAX_STEP / dist; dy *= MAX_STEP / dist; } // clamp, don't trust the client
    gridRemove(p);
    p.x = Math.round(clamp(p.x + dx, 0, WORLD.w));
    p.y = Math.round(clamp(p.y + dy, 0, WORLD.h));
    gridAdd(p);
    p.dirty = true;
  })

  .on("chat.send", z.object({ text: z.string().trim().min(1).max(300) }), ({ ws, data }) => {
    const p = ws.data.player;
    const msg = JSON.stringify({ type: "chat.message", data: { from: p.id, name: p.name, text: data.text } });
    const audience = [p, ...nearby(p)];
    audience.forEach((o) => sendRaw(o, msg));
    return { heardBy: audience.length - 1 };
  });

// ── The tick: one message per player per tick, containing only what changed in THEIR view ──
setInterval(() => {
  const t0 = performance.now();
  stats.ticks++;
  for (const p of players.values()) {
    const visible = nearby(p);
    const enter: object[] = [], moves: (string | number)[][] = [], visibleIds = new Set<string>();
    for (const o of visible) {
      visibleIds.add(o.id);
      if (!p.seen.has(o.id)) enter.push({ id: o.id, name: o.name, x: o.x, y: o.y });
      else if (o.dirty) moves.push([o.id, o.x, o.y]); // compact tuple: [id, x, y]
    }
    const leave = [...p.seen].filter((id) => !visibleIds.has(id));
    p.seen = visibleIds;
    const you = p.dirty ? { x: p.x, y: p.y } : undefined; // the server's verdict on your own position
    if (!enter.length && !moves.length && !leave.length && !you) continue; // nothing new: send nothing
    sendRaw(p, JSON.stringify({ type: "tick", data: { t: stats.ticks, you, enter, moves, leave } }));
  }
  for (const p of players.values()) p.dirty = false;
  stats.lastTickMs = +(performance.now() - t0).toFixed(2);
}, TICK_MS);

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/stats") return Response.json(stats);
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const name = (url.searchParams.get("name") || "anon").slice(0, 24);
      // ?x=&y= picks a spawn point (handy for tests and bots); otherwise spawn near the middle
      const x = clamp(Number(url.searchParams.get("x") ?? WORLD.w / 2 + Math.random() * 200 - 100), 0, WORLD.w);
      const y = clamp(Number(url.searchParams.get("y") ?? WORLD.h / 2 + Math.random() * 200 - 100), 0, WORLD.h);
      const player = { id: crypto.randomUUID().slice(0, 8), name, x: Math.round(x), y: Math.round(y), dirty: true, seen: new Set<string>() } as Player;
      if (server.upgrade(req, { data: { player } })) return;
      return new Response("upgrade failed", { status: 400 });
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${import.meta.dir}/public${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
  websocket: {
    data: {} as Data,
    open(ws) {
      const p = ws.data.player;
      p.ws = ws;
      players.set(p.id, p);
      gridAdd(p);
      stats.players = players.size;
      send(ws, "world.joined", { you: { id: p.id, name: p.name, x: p.x, y: p.y }, world: WORLD, radius: RADIUS, tickMs: TICK_MS });
    },
    message(ws, raw) {
      router.handle(ws, raw);
    },
    close(ws) {
      const p = ws.data.player;
      players.delete(p.id);
      gridRemove(p);
      stats.players = players.size;
      // others notice on the next tick: p is no longer in their visible set → "leave"
    },
  },
});

console.log(`lesson 0009 world on http://localhost:${server.port} (interest management ${INTEREST ? "ON" : "OFF"})`);
