// Shared helper for every check.test.ts: a WebSocket client you can `await` messages from.
//
//   const a = await connect(`${WS}/?name=alice`);
//   a.send({ type: "ping", id: "1" });
//   const ack = await a.next((m) => m.type === "ack" && m.id === "1");
//   a.close();

export type Msg = { type: string; id?: string; seq?: number; data?: any; [k: string]: unknown };

export const BASE = (process.env.URL ?? "http://localhost:8080").replace(/\/$/, "");
export const WS = BASE.replace(/^http/, "ws");

export type TestClient = {
  ws: WebSocket;
  messages: Msg[];                       // everything received so far, in order
  send(msg: unknown): void;              // objects are JSON.stringify-ed, strings sent raw
  next(match?: (m: Msg) => boolean, timeoutMs?: number): Promise<Msg>;
  none(match: (m: Msg) => boolean, waitMs?: number): Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  close(code?: number): void;
};

export function connect(url: string, opts: { headers?: Record<string, string> } = {}): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    // Bun's client accepts headers (e.g. Origin); browsers do not.
    const ws = new WebSocket(url, opts.headers ? ({ headers: opts.headers } as any) : undefined);
    const messages: Msg[] = [];
    const used = new Set<number>(); // next() marks what it returns, so one message is never matched twice
    const waiters: Array<() => void> = [];
    let resolveClosed!: (v: { code: number; reason: string }) => void;
    const closed = new Promise<{ code: number; reason: string }>((r) => (resolveClosed = r));

    ws.onmessage = (e) => {
      let m: Msg;
      try { m = JSON.parse(String(e.data)); } catch { m = { type: "__non_json__", data: String(e.data) }; }
      messages.push(m);
      waiters.splice(0).forEach((w) => w());
    };
    ws.onclose = (e) => { resolveClosed({ code: e.code, reason: e.reason }); waiters.splice(0).forEach((w) => w()); };
    ws.onerror = () => reject(new Error(`could not connect to ${url}`));

    const client: TestClient = {
      ws, messages, closed,
      send(msg) { ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); },
      next(match = () => true, timeoutMs = 2000) {
        return new Promise((ok, fail) => {
          let done = false;
          const timer = setTimeout(() => { done = true; fail(new Error(`timed out waiting for a matching message. Received so far: ${JSON.stringify(messages.slice(-5))}`)); }, timeoutMs);
          const check = () => {
            if (done) return;
            for (let i = 0; i < messages.length; i++) {
              if (!used.has(i) && match(messages[i])) { used.add(i); clearTimeout(timer); ok(messages[i]); return; }
            }
            waiters.push(check);
          };
          check();
        });
      },
      async none(match, waitMs = 300) {
        const start = messages.length;
        await Bun.sleep(waitMs);
        const bad = messages.slice(start).find(match);
        if (bad) throw new Error(`received a message that should NOT arrive: ${JSON.stringify(bad)}`);
      },
      close(code = 1000) { ws.close(code); },
    };
    ws.onopen = () => resolve(client);
  });
}

// Expect the upgrade to be refused with an HTTP status (e.g. 401/403) before any socket exists.
export async function upgradeStatus(path: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await fetch(BASE + path, {
    headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers,
    },
  });
  return res.status;
}
