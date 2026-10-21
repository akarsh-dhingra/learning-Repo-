// Black-box checks for lesson 0012 (metrics + graceful drain).
//   ./start-cluster.sh   then   bun test check.test.ts
// The drain test DRAINS node 3 (8083), which then exits. Restart everything afterwards: ./stop-cluster.sh && ./start-cluster.sh
import { test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { connect, type TestClient } from "../_shared/test-client";

const NODE = process.env.URL ?? "http://localhost:8081";
const DRAIN_NODE = process.env.URL_DRAIN ?? "http://localhost:8083";
const DRAIN_MS = Number(process.env.DRAIN_MS ?? 5000);
const SECRET = process.env.SECRET ?? "dev-secret-change-me";
const token = (sub: string) => {
  const part = Buffer.from(JSON.stringify({ sub, name: sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${part}.${createHmac("sha256", SECRET).update(part).digest("base64url")}`;
};
const upgrade = (base: string) => fetch(`${base}/?room=x&token=${token("u")}`, {
  headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
});

test("/metrics exposes the core gauges and counters in Prometheus text format", async () => {
  const c = await connect(`${NODE.replace(/^http/, "ws")}/?room=metrics-test&token=${token("m")}`);
  await c.next((m) => m.type === "room.state");
  const res = await fetch(`${NODE}/metrics`);
  expect(res.headers.get("content-type")).toContain("text/plain");
  const text = await res.text();
  for (const name of ["ws_connections", "ws_messages_in_total", "ws_messages_out_total", "ws_kicked_total", "ws_max_buffered_bytes", "nodejs_eventloop_lag_ms", "process_resident_memory_bytes"]) {
    expect(text).toMatch(new RegExp(`^# TYPE ${name} (gauge|counter)$`, "m"));
    expect(text).toMatch(new RegExp(`^${name}(\\{[^}]*\\})? [0-9.e+-]+$`, "m"));
  }
  expect(Number(/^ws_connections(?:\{[^}]*\})? (\S+)/m.exec(text)![1])).toBeGreaterThanOrEqual(1);
  c.close();
});

test("drain: health check fails, new sockets refused, existing ones closed with 1001 spread over the window", async () => {
  const clients: TestClient[] = [];
  for (let i = 0; i < 20; i++) {
    const c = await connect(`${DRAIN_NODE.replace(/^http/, "ws")}/?room=drain-${i % 4}&token=${token(`d${i}`)}`);
    await c.next((m) => m.type === "room.state");
    clients.push(c);
  }
  const closedAt: number[] = [];
  const t0 = Date.now();
  clients.forEach((c) => c.closed.then(({ code }) => { expect(code).toBe(1001); closedAt.push(Date.now() - t0); }));

  await fetch(`${DRAIN_NODE}/admin/drain`, { method: "POST" });
  expect((await fetch(`${DRAIN_NODE}/healthz`)).status).toBe(503);
  expect((await upgrade(DRAIN_NODE)).status).toBe(503);

  await Promise.all(clients.map((c) => c.closed));
  expect(closedAt.length).toBe(20);
  const spread = Math.max(...closedAt) - Math.min(...closedAt);
  expect(spread).toBeGreaterThan(DRAIN_MS * 0.4); // not a thundering herd
  expect(Math.max(...closedAt)).toBeLessThan(DRAIN_MS + 1500);
  console.log(`\n  20 sockets closed over ${spread} ms. Node ${DRAIN_NODE} is exiting: restart with ./stop-cluster.sh && ./start-cluster.sh`);
}, 20_000);
