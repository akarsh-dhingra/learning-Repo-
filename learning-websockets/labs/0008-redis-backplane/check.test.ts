// Black-box checks for lesson 0008: TWO nodes sharing rooms through Redis.
//   ./start-cluster.sh   then   bun test check.test.ts
//   (or point at your own nodes: URL_A=http://localhost:8081 URL_B=http://localhost:8082 bun test ...)
import { test, expect, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { connect, type TestClient } from "../_shared/test-client";

const A = (process.env.URL_A ?? "http://localhost:8081").replace(/^http/, "ws");
const B = (process.env.URL_B ?? "http://localhost:8082").replace(/^http/, "ws");
const SECRET = process.env.SECRET ?? "dev-secret-change-me";
const token = (sub: string) => {
  const part = Buffer.from(JSON.stringify({ sub, name: sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${part}.${createHmac("sha256", SECRET).update(part).digest("base64url")}`;
};
const open: TestClient[] = [];
const uniq = () => "r" + Math.random().toString(36).slice(2, 8);
async function join(node: string, room: string, sub: string, extra = "") {
  const c = await connect(`${node}/?room=${room}&token=${token(sub)}${extra}`);
  open.push(c);
  return c;
}
const ready = (c: TestClient) => c.next((m) => m.type === "room.state" || m.type === "room.resume");
afterEach(() => open.splice(0).forEach((c) => c.close()));
const stroke = (id: string) => ({ id, color: "#1971c2", width: 3, points: [[1, 1]] });

test("the two URLs are different nodes", async () => {
  const a = await join(A, uniq(), "alice"); await ready(a);
  const b = await join(B, uniq(), "bob"); await ready(b);
  a.send({ type: "ping", id: "1" }); b.send({ type: "ping", id: "1" });
  const [pa, pb] = await Promise.all([a.next((m) => m.id === "1"), b.next((m) => m.id === "1")]);
  expect(pa.data.node).toBeDefined();
  expect(pa.data.node).not.toBe(pb.data.node);
});

test("a stroke on node A reaches a user on node B (and the sender gets it too, with a seq)", async () => {
  const room = uniq();
  const a = await join(A, room, "alice"); await ready(a);
  const b = await join(B, room, "bob"); await ready(b);
  a.send({ type: "stroke.add", id: "s1", data: { stroke: stroke("cross-node") } });
  const atB = await b.next((m) => m.type === "stroke.added");
  const atA = await a.next((m) => m.type === "stroke.added");
  expect(atB.data.stroke.id).toBe("cross-node");
  expect(atA.seq).toBe(atB.seq);
});

test("a late joiner on node B gets strokes drawn on node A", async () => {
  const room = uniq();
  const a = await join(A, room, "alice"); await ready(a);
  a.send({ type: "stroke.add", id: "s1", data: { stroke: stroke("from-a") } });
  await a.next((m) => m.id === "s1");
  const b = await join(B, room, "bob");
  expect((await ready(b)).data.strokes.map((s: any) => s.id)).toEqual(["from-a"]);
});

test("presence crosses nodes: joiners on A appear for users on B", async () => {
  const room = uniq();
  const b = await join(B, room, "bob"); await ready(b);
  const a = await join(A, room, "alice"); await ready(a);
  // (bob also receives his OWN user.joined: everything goes through Redis, so clients ignore their own id)
  await b.next((m) => m.type === "user.joined" && m.data.user.id === "alice");
  const c = await join(B, room, "carol");
  const users = (await ready(c)).data.users.map((u: any) => u.id).sort();
  expect(users).toEqual(["alice", "bob"]);
});

test("cursor batches cross nodes", async () => {
  const room = uniq();
  const a = await join(A, room, "alice"); await ready(a);
  const b = await join(B, room, "bob"); await ready(b);
  a.send({ type: "cursor", data: { x: 5, y: 6 } });
  const batch = await b.next((m) => m.type === "cursors" && m.data.some((c: any) => c.userId === "alice"));
  expect(batch.data.find((c: any) => c.userId === "alice")).toEqual({ userId: "alice", x: 5, y: 6 });
});

test("seq is global: interleaved writes from both nodes arrive at every client gap-free and in order", async () => {
  const room = uniq();
  const a = await join(A, room, "alice"); const sa = await ready(a);
  const b = await join(B, room, "bob"); await ready(b);
  for (let i = 0; i < 10; i++) {
    a.send({ type: "stroke.add", id: `a${i}`, data: { stroke: stroke(`a${i}`) } });
    b.send({ type: "stroke.add", id: `b${i}`, data: { stroke: stroke(`b${i}`) } });
  }
  await a.next((m) => m.id === "a9"); await b.next((m) => m.id === "b9");
  await Bun.sleep(200);
  for (const c of [a, b]) {
    const seqs = c.messages.filter((m) => m.type === "stroke.added").map((m) => m.seq);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => sa.data.seq + 1 + i));
  }
});

test("resume works on a DIFFERENT node than the one you left", async () => {
  const room = uniq();
  const a = await join(A, room, "alice"); const s = await ready(a);
  const b = await join(B, room, "bob"); await ready(b);
  a.close();
  await Bun.sleep(50);
  b.send({ type: "stroke.add", id: "m1", data: { stroke: stroke("missed-1") } });
  b.send({ type: "stroke.add", id: "m2", data: { stroke: stroke("missed-2") } });
  await b.next((m) => m.id === "m2");
  const a2 = await join(B, room, "alice", `&lastSeq=${s.data.seq}&epoch=${s.data.epoch}`);
  const r = await ready(a2);
  expect(r.type).toBe("room.resume");
  expect(r.data.events.map((e: any) => e.data.stroke.id)).toEqual(["missed-1", "missed-2"]);
});
