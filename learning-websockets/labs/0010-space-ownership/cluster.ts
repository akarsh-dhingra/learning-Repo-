// Cluster membership + ownership, shared by the directory and every space node.
//
// Membership: each node writes  node:<id> = <ws url>  with a 5s TTL and refreshes it every 1.5s.
//             A node that crashes simply stops refreshing; its key expires; it's gone from the list.
// Ownership:  rendezvous (highest-random-weight) hashing. For a space, score every live node with
//             hash(space + nodeId) and pick the highest. Everyone computes the same answer with no
//             coordination, and when a node leaves only ITS spaces move.
import { RedisClient } from "bun";

export const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6390");
export const NODE_TTL_S = 5;

export type Node = { id: string; url: string };

export async function liveNodes(): Promise<Node[]> {
  const keys = (await redis.send("KEYS", ["node:*"])) as string[]; // fine for a handful of nodes; use SCAN or a set at scale
  if (keys.length === 0) return [];
  const urls = (await redis.send("MGET", keys)) as (string | null)[];
  return keys.map((k, i) => ({ id: k.slice(5), url: urls[i]! })).filter((n) => n.url).sort((a, b) => a.id.localeCompare(b.id));
}

export function ownerOf(space: string, nodes: Node[]): Node | undefined {
  let best: Node | undefined, bestScore = -1n;
  for (const n of nodes) {
    const score = BigInt(Bun.hash(`${space}|${n.id}`));
    if (score > bestScore) { best = n; bestScore = score; }
  }
  return best;
}

export function startHeartbeat(node: Node) {
  const beat = () => redis.send("SET", [`node:${node.id}`, node.url, "EX", String(NODE_TTL_S)]);
  beat();
  return setInterval(beat, 1500);
}

// ── Presence: one sorted set per space, score = last heartbeat time. Stale entries = crashed nodes. ──
export const PRESENCE_STALE_MS = 15_000;
export const presenceKey = (space: string) => `presence:${space}`;

export async function onlineIn(space: string): Promise<{ id: string; name: string }[]> {
  const members = (await redis.send("ZRANGEBYSCORE", [presenceKey(space), String(Date.now() - PRESENCE_STALE_MS), "+inf"])) as string[];
  return members.map((m) => JSON.parse(m));
}
