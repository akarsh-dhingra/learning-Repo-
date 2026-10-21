// Black-box checks for lesson 0004. Point them at YOUR server:
//   URL=http://localhost:8080 bun test ~/learning-websockets/labs/0004-message-protocol/check.test.ts
import { test, expect, afterEach } from "bun:test";
import { connect, WS, type TestClient } from "../_shared/test-client";

const open: TestClient[] = [];
const join = async (name: string) => { const c = await connect(`${WS}/?name=${name}`); open.push(c); return c; };
afterEach(() => open.splice(0).forEach((c) => c.close()));

test("greets a new connection with a welcome event", async () => {
  const a = await join("alice");
  const m = await a.next((m) => m.type === "welcome");
  expect(m.data.name).toBe("alice");
});

test("ping with an id gets an ack with the same id", async () => {
  const a = await join("alice");
  a.send({ type: "ping", id: "p1" });
  const ack = await a.next((m) => m.id === "p1");
  expect(ack.type).toBe("ack");
  expect(typeof ack.data.time).toBe("number");
});

test("echo returns its data in the ack", async () => {
  const a = await join("alice");
  a.send({ type: "echo", id: "e1", data: { hello: [1, 2, 3] } });
  const ack = await a.next((m) => m.id === "e1");
  expect(ack).toMatchObject({ type: "ack", data: { hello: [1, 2, 3] } });
});

test("garbage that isn't JSON → error bad_json (and the socket stays open)", async () => {
  const a = await join("alice");
  a.send("this is {not json");
  const err = await a.next((m) => m.type === "error");
  expect(err.data.code).toBe("bad_json");
  a.send({ type: "ping", id: "still-alive" });
  expect((await a.next((m) => m.id === "still-alive")).type).toBe("ack");
});

test("JSON without a type → error bad_envelope", async () => {
  const a = await join("alice");
  a.send({ hello: "world" });
  expect((await a.next((m) => m.type === "error")).data.code).toBe("bad_envelope");
});

test("unknown type → error unknown_type, carrying the request id", async () => {
  const a = await join("alice");
  a.send({ type: "teleport", id: "u1" });
  const err = await a.next((m) => m.type === "error");
  expect(err).toMatchObject({ id: "u1", data: { code: "unknown_type" } });
});

test("chat.send with empty or missing text → error invalid", async () => {
  const a = await join("alice");
  a.send({ type: "chat.send", id: "c0", data: { text: "   " } });
  expect((await a.next((m) => m.id === "c0")).data.code).toBe("invalid");
  a.send({ type: "chat.send", id: "c1", data: {} });
  expect((await a.next((m) => m.id === "c1")).data.code).toBe("invalid");
});

test("chat.send over 500 chars → error invalid", async () => {
  const a = await join("alice");
  a.send({ type: "chat.send", id: "c2", data: { text: "x".repeat(501) } });
  expect((await a.next((m) => m.id === "c2")).data.code).toBe("invalid");
});

test("chat.send reaches everyone (sender too) and the sender gets an ack", async () => {
  const a = await join("alice");
  const b = await join("bob");
  a.send({ type: "chat.send", id: "c3", data: { text: "hi bob" } });
  expect((await a.next((m) => m.id === "c3")).type).toBe("ack");
  const seenByB = await b.next((m) => m.type === "chat.message");
  expect(seenByB.data).toMatchObject({ from: "alice", text: "hi bob" });
  const seenByA = await a.next((m) => m.type === "chat.message");
  expect(seenByA.data.text).toBe("hi bob");
});

test("/admin messages are refused with error forbidden and NOT broadcast", async () => {
  const a = await join("alice");
  const b = await join("bob");
  a.send({ type: "chat.send", id: "c4", data: { text: "/admin delete everything" } });
  expect((await a.next((m) => m.id === "c4")).data.code).toBe("forbidden");
  await b.none((m) => m.type === "chat.message");
});
