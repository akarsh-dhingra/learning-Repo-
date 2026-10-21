// Black-box checks for lesson 0006 (auth, origin, presence, sequence numbers, resume).
//   URL=http://localhost:8080 bun test ~/learning-websockets/labs/0006-auth-heartbeat-resume/check.test.ts
// Your server must use the token format from the lesson and the same SECRET (default "dev-secret-change-me").
import { test, expect, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { connect, WS, BASE, upgradeStatus, type TestClient } from "../_shared/test-client";

const SECRET = process.env.SECRET ?? "dev-secret-change-me";
const LOG_SIZE = 200;

function token(sub: string, name: string, expInSec = 3600) {
  const part = Buffer.from(JSON.stringify({ sub, name, exp: Math.floor(Date.now() / 1000) + expInSec })).toString("base64url");
  return `${part}.${createHmac("sha256", SECRET).update(part).digest("base64url")}`;
}
const open: TestClient[] = [];
const uniq = () => "r" + Math.random().toString(36).slice(2, 8);
async function join(room: string, tok: string, extra = "") {
  const c = await connect(`${WS}/?room=${room}&token=${tok}${extra}`);
  open.push(c);
  return c;
}
afterEach(() => open.splice(0).forEach((c) => c.close()));
const stroke = (id: string) => ({ id, color: "#1971c2", width: 3, points: [[1, 1]] });

test("POST /login returns a token that works for the upgrade", async () => {
  const res = await fetch(`${BASE}/login`, { method: "POST", body: JSON.stringify({ name: "alice" }) });
  const { token: t } = await res.json();
  expect(typeof t).toBe("string");
  const a = await join(uniq(), t);
  expect((await a.next()).data.you.name).toBe("alice");
});

test("missing, garbage, tampered and expired tokens → HTTP 401 before upgrade", async () => {
  const room = uniq();
  expect(await upgradeStatus(`/?room=${room}`)).toBe(401);
  expect(await upgradeStatus(`/?room=${room}&token=garbage`)).toBe(401);
  const good = token("u1", "alice");
  const tampered = good.slice(0, -3) + (good.endsWith("AAA") ? "BBB" : "AAA");
  expect(await upgradeStatus(`/?room=${room}&token=${tampered}`)).toBe(401);
  expect(await upgradeStatus(`/?room=${room}&token=${token("u1", "alice", -10)}`)).toBe(401);
});

test("a foreign Origin → 403; your own origin is accepted", async () => {
  const room = uniq(), t = token("u1", "alice");
  expect(await upgradeStatus(`/?room=${room}&token=${t}`, { Origin: "https://evil.example" })).toBe(403);
  const ok = await connect(`${WS}/?room=${room}&token=${t}`, { headers: { Origin: BASE } });
  open.push(ok);
  expect((await ok.next()).type).toBe("room.state");
});

test("user identity comes from the token (sub), not from the query string", async () => {
  const a = await join(uniq(), token("user-42", "alice"), "&name=mallory");
  expect((await a.next()).data.you).toMatchObject({ id: "user-42", name: "alice" });
});

test("room.state carries seq and epoch; durable events carry seq that increases by 1", async () => {
  const room = uniq();
  const a = await join(room, token("a", "alice"));
  const b = await join(room, token("b", "bob"));
  const s = await b.next((m) => m.type === "room.state");
  expect(typeof s.data.seq).toBe("number");
  expect(typeof s.data.epoch).toBe("string");
  a.send({ type: "stroke.add", id: "1", data: { stroke: stroke("s1") } });
  a.send({ type: "stroke.add", id: "2", data: { stroke: stroke("s2") } });
  const e1 = await b.next((m) => m.type === "stroke.added");
  const e2 = await b.next((m) => m.type === "stroke.added");
  expect([e1.seq, e2.seq]).toEqual([s.data.seq + 1, s.data.seq + 2]);
});

test("reconnect with lastSeq + epoch → room.resume with exactly the missed events", async () => {
  const room = uniq();
  const a = await join(room, token("a", "alice"));
  const state = await a.next((m) => m.type === "room.state");
  const b = await join(room, token("b", "bob"));
  a.close();
  await Bun.sleep(50);
  b.send({ type: "stroke.add", id: "1", data: { stroke: stroke("missed-1") } });
  b.send({ type: "stroke.add", id: "2", data: { stroke: stroke("missed-2") } });
  await b.next((m) => m.id === "2");
  const a2 = await join(room, token("a", "alice"), `&lastSeq=${state.data.seq}&epoch=${state.data.epoch}`);
  const r = await a2.next();
  expect(r.type).toBe("room.resume");
  expect(r.data.events.map((e: any) => e.data.stroke.id)).toEqual(["missed-1", "missed-2"]);
  expect(r.data.events.map((e: any) => e.seq)).toEqual([state.data.seq + 1, state.data.seq + 2]);
});

test("wrong epoch → full room.state instead of resume", async () => {
  const room = uniq();
  const a = await join(room, token("a", "alice"));
  await a.next();
  const b = await join(room, token("b", "bob"), "&lastSeq=0&epoch=not-this-room");
  expect((await b.next()).type).toBe("room.state");
});

test(`lastSeq older than the last ${LOG_SIZE} events → full room.state`, async () => {
  const room = uniq();
  const a = await join(room, token("a", "alice"));
  const state = await a.next();
  for (let i = 0; i < LOG_SIZE + 5; i++) a.send({ type: "stroke.add", id: `k${i}`, data: { stroke: stroke(`k${i}`) } });
  await a.next((m) => m.id === `k${LOG_SIZE + 4}`, 5000);
  const b = await join(room, token("b", "bob"), `&lastSeq=${state.data.seq}&epoch=${state.data.epoch}`);
  const r = await b.next();
  expect(r.type).toBe("room.state");
  expect(r.data.strokes.length).toBe(LOG_SIZE + 5);
});

test("presence is per user: two tabs of one user → one user.joined, user.left only after both close", async () => {
  const room = uniq();
  const watcher = await join(room, token("w", "watcher"));
  await watcher.next();
  const tab1 = await join(room, token("same-user", "alice"));
  const tab2 = await join(room, token("same-user", "alice"));
  await tab2.next();
  await watcher.next((m) => m.type === "user.joined");
  await watcher.none((m) => m.type === "user.joined");
  tab1.close();
  await watcher.none((m) => m.type === "user.left");
  tab2.close();
  expect((await watcher.next((m) => m.type === "user.left")).data.userId).toBe("same-user");
});

test("an expiring token closes the socket with code 4001", async () => {
  const a = await join(uniq(), token("a", "alice", 1));
  const { code } = await Promise.race([a.closed, Bun.sleep(3000).then(() => ({ code: -1, reason: "" }))]);
  expect(code).toBe(4001);
});
