// Black-box checks for lesson 0009 (tick loop, interest management, deltas, proximity chat).
//   URL=http://localhost:8090 bun test ~/learning-websockets/labs/0009-world-interest/check.test.ts
// Assumes RADIUS 300, MAX_STEP 50, TICK 100ms, and spawn via ?x=&y= (as in the lesson).
import { test, expect, afterEach } from "bun:test";
import { connect, type TestClient } from "../_shared/test-client";

const WS = (process.env.URL ?? "http://localhost:8090").replace(/^http/, "ws");
const open: TestClient[] = [];
// each test uses its own far-away corner of the world so tests don't see each other
let corner = 0;
const area = () => { const i = corner++; return { x: 200 + (i % 4) * 700, y: 200 + Math.floor(i / 4) * 700 }; };
async function spawn(name: string, x: number, y: number) {
  const c = await connect(`${WS}/?name=${name}&x=${x}&y=${y}`);
  open.push(c);
  const j = await c.next((m) => m.type === "world.joined");
  return { c, id: j.data.you.id as string, joined: j };
}
afterEach(() => open.splice(0).forEach((c) => c.close()));
const ticks = (c: TestClient) => c.messages.filter((m) => m.type === "tick");

test("world.joined tells you your id, position, radius and tick rate", async () => {
  const { x, y } = area();
  const { joined } = await spawn("alice", x, y);
  expect(joined.data.you).toMatchObject({ name: "alice", x, y });
  expect(joined.data.radius).toBe(300);
  expect(joined.data.tickMs).toBe(100);
});

test("a player within the radius 'enter's your view with name and position", async () => {
  const { x, y } = area();
  const a = await spawn("alice", x, y);
  const b = await spawn("bob", x + 100, y);
  const t = await a.c.next((m) => m.type === "tick" && m.data.enter?.some((e: any) => e.id === b.id));
  expect(t.data.enter.find((e: any) => e.id === b.id)).toEqual({ id: b.id, name: "bob", x: x + 100, y });
});

test("a player outside the radius never appears in your ticks", async () => {
  const { x, y } = area();
  const a = await spawn("alice", x, y);
  const far = await spawn("far", x + 350, y); // 350 > 300
  await Bun.sleep(350);
  const mentioned = JSON.stringify(ticks(a.c)).includes(far.id);
  expect(mentioned).toBe(false);
});

test("walking into range → enter; walking out → leave", async () => {
  const { x, y } = area();
  const a = await spawn("alice", x, y);
  const b = await spawn("bob", x + 380, y);
  for (const bx of [x + 330, x + 280]) b.c.send({ type: "move", data: { x: bx, y } });
  await a.c.next((m) => m.type === "tick" && m.data.enter?.some((e: any) => e.id === b.id));
  for (const bx of [x + 330, x + 380]) b.c.send({ type: "move", data: { x: bx, y } });
  await a.c.next((m) => m.type === "tick" && m.data.leave?.includes(b.id));
});

test("moves are batched per tick: 20 rapid moves → at most 3 ticks mentioning that player", async () => {
  const { x, y } = area();
  const a = await spawn("alice", x, y);
  const b = await spawn("bob", x + 50, y);
  await a.c.next((m) => m.type === "tick" && m.data.enter?.some((e: any) => e.id === b.id));
  const before = ticks(a.c).length;
  for (let i = 1; i <= 20; i++) b.c.send({ type: "move", data: { x: x + 50, y: y + i } });
  await Bun.sleep(350);
  const after = ticks(a.c).slice(before).filter((t) => t.data.moves?.some((m: any) => m[0] === b.id));
  expect(after.length).toBeGreaterThanOrEqual(1);
  expect(after.length).toBeLessThanOrEqual(4);
  const last = after.at(-1)!.data.moves.find((m: any) => m[0] === b.id);
  expect(last).toEqual([b.id, x + 50, y + 20]);
});

test("teleport attempts are clamped to 50px and the server tells you where you really are", async () => {
  const { x, y } = area();
  const a = await spawn("alice", x, y);
  a.c.send({ type: "move", data: { x: x + 1000, y } });
  const t = await a.c.next((m) => m.type === "tick" && m.data.you && m.data.you.x !== x);
  expect(t.data.you).toEqual({ x: x + 50, y });
});

test("proximity chat: near players hear it, far players don't", async () => {
  const { x, y } = area();
  const a = await spawn("alice", x, y);
  const near = await spawn("near", x + 100, y + 100);
  const far = await spawn("far", x + 500, y);
  a.c.send({ type: "chat.send", id: "c1", data: { text: "hello neighbours" } });
  expect((await a.c.next((m) => m.id === "c1")).data.heardBy).toBe(1);
  expect((await near.c.next((m) => m.type === "chat.message")).data.text).toBe("hello neighbours");
  await far.c.none((m) => m.type === "chat.message");
});
