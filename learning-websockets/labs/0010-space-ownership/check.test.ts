// Black-box checks for lesson 0010 (directory + owner nodes + presence + failover).
//   ./start-cluster.sh   then   bun test check.test.ts
// The LAST test crashes one node on purpose. Restart it afterwards with: ./start-cluster.sh node-N
import { test, expect, afterEach } from "bun:test";
import { connect, upgradeStatus, type TestClient } from "../_shared/test-client";

const DIR = process.env.URL ?? "http://localhost:9000";
const open: TestClient[] = [];
afterEach(() => open.splice(0).forEach((c) => c.close()));
const assign = async (space: string) => (await fetch(`${DIR}/assign?space=${space}`)).json();
const uniq = () => "s" + Math.random().toString(36).slice(2, 8);

test("/assign is stable: the same space always maps to the same node", async () => {
  const space = uniq();
  const first = await assign(space);
  for (let i = 0; i < 5; i++) expect((await assign(space)).node).toBe(first.node);
});

test("spaces spread across nodes", async () => {
  const owners = new Set<string>();
  for (let i = 0; i < 30; i++) owners.add((await assign(`spread-${i}`)).node);
  expect(owners.size).toBeGreaterThanOrEqual(2);
});

test("connecting to the owner works and world.joined says which node you're on", async () => {
  const space = uniq();
  const a = await assign(space);
  const c = await connect(`${a.url}&name=alice`); open.push(c);
  const j = await c.next((m) => m.type === "world.joined");
  expect(j.data).toMatchObject({ node: a.node, space });
});

test("connecting to a node that does NOT own the space → HTTP 421", async () => {
  const space = uniq();
  const a = await assign(space);
  const nodes: { id: string; url: string }[] = await (await fetch(`${DIR}/nodes`)).json();
  const wrong = nodes.find((n) => n.id !== a.node)!;
  const base = wrong.url.replace(/^ws/, "http");
  const res = await fetch(`${base}/?space=${space}&name=x`, {
    headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
  });
  expect(res.status).toBe(421);
});

test("presence: you appear in /presence while connected and disappear after you leave", async () => {
  const space = uniq();
  const a = await assign(space);
  const c = await connect(`${a.url}&name=presence-test`);
  await c.next((m) => m.type === "world.joined");
  await Bun.sleep(100);
  const online = async () => (await (await fetch(`${DIR}/presence?space=${space}`)).json()).online.map((u: any) => u.name);
  expect(await online()).toContain("presence-test");
  c.close();
  await Bun.sleep(200);
  expect(await online()).not.toContain("presence-test");
});

test("failover: crash one node → its spaces move within ~8s, every other space stays put", async () => {
  const before = new Map<string, string>();
  for (let i = 0; i < 30; i++) before.set(`fo-${i}`, (await assign(`fo-${i}`)).node);
  const victim = before.get("fo-0")!;
  const nodes: { id: string; url: string }[] = await (await fetch(`${DIR}/nodes`)).json();
  const victimUrl = nodes.find((n) => n.id === victim)!.url.replace(/^ws/, "http");

  // someone is in a victim-owned space when the node dies
  const c = await connect(`${(await assign("fo-0")).url}&name=survivor`);
  await c.next((m) => m.type === "world.joined");
  await fetch(`${victimUrl}/__crash`, { method: "POST" }).catch(() => {});
  await c.closed; // the client sees the drop (1006)

  const deadline = Date.now() + 10_000;
  while ((await assign("fo-0")).node === victim) {
    if (Date.now() > deadline) throw new Error(`${victim} still owns fo-0 after 10s: is the node key's TTL working?`);
    await Bun.sleep(250);
  }
  for (const [space, owner] of before) {
    const now = (await assign(space)).node;
    if (owner === victim) expect(now).not.toBe(victim);
    else expect(now).toBe(owner); // rendezvous hashing: unaffected spaces don't move
  }
  // and the new owner accepts the reconnect
  const again = await connect(`${(await assign("fo-0")).url}&name=survivor`); open.push(again);
  expect((await again.next((m) => m.type === "world.joined")).data.node).not.toBe(victim);
  console.log(`\n  crashed ${victim}. Restart it with: ./start-cluster.sh ${victim}`);
}, 20_000);
