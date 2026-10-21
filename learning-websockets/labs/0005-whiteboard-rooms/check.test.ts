// Black-box checks for lesson 0005 (whiteboard rooms). Point them at YOUR server:
//   URL=http://localhost:8080 bun test ~/learning-websockets/labs/0005-whiteboard-rooms/check.test.ts
import { test, expect, afterEach } from "bun:test";
import { connect, WS, upgradeStatus, type TestClient } from "../_shared/test-client";

const open: TestClient[] = [];
const join = async (room: string, name: string) => { const c = await connect(`${WS}/?room=${room}&name=${name}`); open.push(c); return c; };
afterEach(() => open.splice(0).forEach((c) => c.close()));
const uniq = () => "r" + Math.random().toString(36).slice(2, 8);
const stroke = (id: string) => ({ id, color: "#1971c2", width: 3, points: [[10, 10], [20, 25]] });

test("missing or bad room → HTTP 400 before upgrade", async () => {
  expect(await upgradeStatus("/?name=x")).toBe(400);
  expect(await upgradeStatus("/?room=../etc&name=x")).toBe(400);
});

test("first message is room.state with you, users and strokes", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  const s = await a.next();
  expect(s.type).toBe("room.state");
  expect(s.data.you).toMatchObject({ name: "alice" });
  expect(typeof s.data.you.id).toBe("string");
  expect(s.data.users).toEqual([]);
  expect(s.data.strokes).toEqual([]);
});

test("second joiner sees the first in users; the first gets user.joined", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  const aState = await a.next((m) => m.type === "room.state");
  const b = await join(room, "bob");
  const bState = await b.next((m) => m.type === "room.state");
  expect(bState.data.users.map((u: any) => u.id)).toEqual([aState.data.you.id]);
  const joined = await a.next((m) => m.type === "user.joined");
  expect(joined.data.user).toMatchObject({ name: "bob", id: bState.data.you.id });
});

test("stroke.add: sender gets an ack, peers get stroke.added, sender does NOT get its own echo", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  const b = await join(room, "bob");
  await a.next((m) => m.type === "user.joined");
  a.send({ type: "stroke.add", id: "s1", data: { stroke: stroke("st-1") } });
  expect((await a.next((m) => m.id === "s1")).type).toBe("ack");
  const added = await b.next((m) => m.type === "stroke.added");
  expect(added.data.stroke.id).toBe("st-1");
  await a.none((m) => m.type === "stroke.added");
});

test("a late joiner receives existing strokes in room.state", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  a.send({ type: "stroke.add", id: "s1", data: { stroke: stroke("st-1") } });
  a.send({ type: "stroke.add", id: "s2", data: { stroke: stroke("st-2") } });
  await a.next((m) => m.id === "s2");
  const c = await join(room, "carol");
  const s = await c.next((m) => m.type === "room.state");
  expect(s.data.strokes.map((x: any) => x.id)).toEqual(["st-1", "st-2"]);
});

test("invalid strokes are rejected with error invalid", async () => {
  const a = await join(uniq(), "alice");
  a.send({ type: "stroke.add", id: "bad1", data: { stroke: { ...stroke("x"), color: "red" } } });
  expect((await a.next((m) => m.id === "bad1")).data.code).toBe("invalid");
  a.send({ type: "stroke.add", id: "bad2", data: { stroke: { ...stroke("x"), points: [] } } });
  expect((await a.next((m) => m.id === "bad2")).data.code).toBe("invalid");
});

test("cursor goes to peers only (with userId), never back to the sender", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  const aState = await a.next((m) => m.type === "room.state");
  const b = await join(room, "bob");
  await a.next((m) => m.type === "user.joined");
  a.send({ type: "cursor", data: { x: 100, y: 200 } });
  const cur = await b.next((m) => m.type === "cursor");
  expect(cur.data).toEqual({ userId: aState.data.you.id, x: 100, y: 200 });
  await a.none((m) => m.type === "cursor");
});

test("rooms are isolated", async () => {
  const a = await join(uniq(), "alice");
  const x = await join(uniq(), "xavier");
  a.send({ type: "stroke.add", id: "s1", data: { stroke: stroke("st-1") } });
  a.send({ type: "cursor", data: { x: 1, y: 1 } });
  await a.next((m) => m.id === "s1");
  await x.none((m) => m.type === "stroke.added" || m.type === "cursor");
});

test("scene.clear empties the room for everyone, including the sender", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  const b = await join(room, "bob");
  a.send({ type: "stroke.add", id: "s1", data: { stroke: stroke("st-1") } });
  await a.next((m) => m.id === "s1");
  b.send({ type: "scene.clear", id: "clr" });
  await a.next((m) => m.type === "scene.cleared");
  await b.next((m) => m.type === "scene.cleared");
  const c = await join(room, "carol");
  expect((await c.next((m) => m.type === "room.state")).data.strokes).toEqual([]);
});

test("leaving broadcasts user.left", async () => {
  const room = uniq();
  const a = await join(room, "alice");
  const b = await join(room, "bob");
  const bState = await b.next((m) => m.type === "room.state");
  b.close();
  const left = await a.next((m) => m.type === "user.left");
  expect(left.data.userId).toBe(bState.data.you.id);
});
