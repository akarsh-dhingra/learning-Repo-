// Black-box checks for lesson 0007 (cursor batching, skip-when-slow, kicking slow consumers, /stats).
//   URL=http://localhost:8080 bun test ~/learning-websockets/labs/0007-backpressure/check.test.ts
import { test, expect, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { connect, WS, BASE, type TestClient } from "../_shared/test-client";

const SECRET = process.env.SECRET ?? "dev-secret-change-me";
const token = (sub: string, name: string) => {
  const part = Buffer.from(JSON.stringify({ sub, name, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${part}.${createHmac("sha256", SECRET).update(part).digest("base64url")}`;
};
const open: TestClient[] = [];
const uniq = () => "r" + Math.random().toString(36).slice(2, 8);
const join = async (room: string, sub: string) => { const c = await connect(`${WS}/?room=${room}&token=${token(sub, sub)}`); open.push(c); await c.next(); return c; };
afterEach(() => open.splice(0).forEach((c) => c.close()));
const stats = async () => (await fetch(`${BASE}/stats`)).json();

test("GET /stats returns numeric counters", async () => {
  const s = await stats();
  for (const k of ["connections", "cursorBatches", "cursorDrops", "kicked"]) expect(typeof s[k]).toBe("number");
});

test("20 rapid cursor moves arrive as a few `cursors` batches (latest position wins), never as single `cursor` events", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  const b = await join(room, "bob");
  for (let i = 0; i < 20; i++) a.send({ type: "cursor", data: { x: i, y: i * 2 } });
  await Bun.sleep(300);
  const batches = b.messages.filter((m) => m.type === "cursors");
  expect(batches.length).toBeGreaterThanOrEqual(1);
  expect(batches.length).toBeLessThanOrEqual(3);
  const last = batches.at(-1)!.data.find((c: any) => c.userId === "alice");
  expect(last).toEqual({ userId: "alice", x: 19, y: 38 });
  expect(b.messages.some((m) => m.type === "cursor")).toBe(false);
});

test("a client that stops reading gets kicked; healthy clients still receive every durable event", async () => {
  const room = uniq();
  const port = new URL(BASE).port || "80";
  const slow = Bun.spawn(["node", `${import.meta.dir}/slow-client.mjs`, room], { env: { ...process.env, PORT: port, SECRET }, stdout: "pipe" });
  const reader = slow.stdout.getReader();
  let out = "";
  (async () => { for (;;) { const r = await reader.read(); if (r.done) break; out += new TextDecoder().decode(r.value); } })();
  const until = async (word: string, ms: number) => {
    const deadline = Date.now() + ms;
    while (!out.includes(word)) {
      if (Date.now() > deadline) throw new Error(`slow client never printed ${word}. Output: ${out}`);
      await Bun.sleep(50);
    }
  };
  await until("READY", 3000);
  const kickedBefore = (await stats()).kicked;

  const healthy = await join(room, "healthy");
  const flooder = await join(room, "flooder");
  const points = Array.from({ length: 2000 }, (_, i) => [i % 1200, i % 800]);
  const N = 300; // ≈ 6 MB of strokes
  for (let i = 0; i < N; i++) flooder.send({ type: "stroke.add", id: `f${i}`, data: { stroke: { id: `f${i}`, color: "#e03131", width: 2, points } } });

  await until("KICKED", 8000);
  await flooder.next((m) => m.id === `f${N - 1}`, 8000);
  await Bun.sleep(300);
  expect(healthy.messages.filter((m) => m.type === "stroke.added").length).toBe(N);
  expect((await stats()).kicked).toBeGreaterThan(kickedBefore);
  slow.kill();
}, 20_000);
