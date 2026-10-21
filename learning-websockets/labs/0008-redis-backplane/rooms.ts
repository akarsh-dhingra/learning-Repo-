// Room state + event fan-out, moved out of process memory into Redis so ANY node can serve ANY room.
//
// The one rule that keeps this correct:
//   every room message goes THROUGH Redis, and a node only fans out what it RECEIVES from Redis.
// Durable events are created by one Lua script (INCR seq + store + PUBLISH, atomically), so the
// order everyone receives them in is exactly the seq order. No node takes a local shortcut.
import { RedisClient } from "bun";

export const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6390");
const sub = await redis.duplicate(); // a subscribed connection can't run normal commands

const LOG_SIZE = 200;
const ROOM_TTL = 24 * 3600; // forget idle rooms after a day

const k = (room: string) => ({
  seq: `room:${room}:seq`,
  log: `room:${room}:log`,
  strokes: `room:${room}:strokes`,
  epoch: `room:${room}:epoch`,
  users: `room:${room}:users`,      // userId → user JSON
  conns: `room:${room}:conns`,      // userId → number of open connections (all nodes)
  channel: `ch:room:${room}`,
});

// KEYS: seq, log, strokes, channel   ARGV: type, dataJson, op ("add" | "clear" | "none"), strokeJson, logSize, ttl
const EMIT_DURABLE = `
local seq = redis.call('INCR', KEYS[1])
local msg = '{"type":"' .. ARGV[1] .. '","seq":' .. seq .. ',"data":' .. ARGV[2] .. '}'
if ARGV[3] == 'add' then redis.call('RPUSH', KEYS[3], ARGV[4]) end
if ARGV[3] == 'clear' then redis.call('DEL', KEYS[3]) end
redis.call('RPUSH', KEYS[2], msg)
redis.call('LTRIM', KEYS[2], -tonumber(ARGV[5]), -1)
for i = 1, 3 do redis.call('EXPIRE', KEYS[i], ARGV[6]) end
redis.call('PUBLISH', KEYS[4], msg)
return seq`;

export async function emitDurable(room: string, type: string, data: unknown, op: "add" | "clear" | "none" = "none", stroke?: unknown) {
  const key = k(room);
  const seq = await redis.send("EVAL", [
    EMIT_DURABLE, "4", key.seq, key.log, key.strokes, key.channel,
    type, JSON.stringify(data), op, stroke ? JSON.stringify(stroke) : "", String(LOG_SIZE), String(ROOM_TTL),
  ]);
  return Number(seq);
}

// Ephemeral events (cursors, presence) skip seq and storage: just PUBLISH.
export const emitEphemeral = (room: string, type: string, data: unknown) =>
  redis.publish(k(room).channel, JSON.stringify({ type, data }));

// ── Subscriptions: this node listens to a room's channel only while it has local members ──
type Sub = { count: number; ready: Promise<unknown>; listener: (msg: string) => void };
const subs = new Map<string, Sub>();
export async function attach(room: string, deliver: (room: string, msg: string) => void) {
  let s = subs.get(room);
  if (!s) {
    const listener = (message: string) => deliver(room, message);
    subs.set(room, (s = { count: 0, listener, ready: sub.subscribe(k(room).channel, listener) }));
  }
  s.count++;
  await s.ready; // a second local joiner waits for the SAME subscription instead of racing past it
}
export async function detach(room: string) {
  const s = subs.get(room);
  if (!s || --s.count > 0) return;
  subs.delete(room);
  try {
    await s.ready; // the last socket may leave before the subscribe even finished
    await sub.unsubscribe(k(room).channel, s.listener); // only OUR listener: a newer attach may have re-subscribed
  } catch (err) {
    console.error(`unsubscribe ${room} failed:`, err); // cleanup must never crash the node
  }
}

// ── Snapshot / resume reads ──
export async function snapshot(room: string) {
  const key = k(room);
  await redis.send("SET", [key.epoch, crypto.randomUUID().slice(0, 8), "NX", "EX", String(ROOM_TTL)]);
  const [epoch, seq, strokes, users] = await Promise.all([
    redis.get(key.epoch), redis.get(key.seq), redis.send("LRANGE", [key.strokes, "0", "-1"]), redis.hvals(key.users),
  ]);
  return {
    epoch: epoch!, seq: Number(seq ?? 0),
    strokes: (strokes as string[]).map((s) => JSON.parse(s)),
    users: (users as string[]).map((u) => JSON.parse(u)),
  };
}
export async function eventsAfter(room: string, lastSeq: number) {
  const log = (await redis.send("LRANGE", [k(room).log, "0", "-1"])) as string[];
  const events = log.map((m) => JSON.parse(m));
  const oldest = events[0]?.seq;
  return { events: events.filter((e) => e.seq > lastSeq), oldest };
}
export const strokeCount = async (room: string) => Number(await redis.send("LLEN", [k(room).strokes]));

// ── Presence across nodes: count connections per user; announce on 0→1 and 1→0 ──
export async function presenceJoin(room: string, user: { id: string }) {
  const key = k(room);
  await redis.hset(key.users, { [user.id]: JSON.stringify(user) });
  const conns = await redis.hincrby(key.conns, user.id, 1);
  return conns === 1; // first connection anywhere in the cluster
}
export async function presenceLeave(room: string, userId: string) {
  const key = k(room);
  const conns = await redis.hincrby(key.conns, userId, -1);
  if (conns > 0) return false;
  await Promise.all([redis.hdel(key.conns, userId), redis.hdel(key.users, userId)]);
  return true; // last connection anywhere in the cluster
}
