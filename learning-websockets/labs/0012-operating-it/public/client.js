// Browser client, v2: the 0005 request()/on() API plus
//   • automatic reconnect with exponential backoff + full jitter
//   • resume: remembers lastSeq + epoch and sends them on reconnect; replays room.resume events
//   • app-level heartbeat (browsers can't see protocol pings)
//   • token refresh on close code 4001
//   • (0008) events that arrive BEFORE the snapshot are buffered, then replayed on top of it by seq
//
//   const client = createClient({ url: ({ lastSeq, epoch }) => "...", refreshToken: async () => {...} });

export function backoff(attempt, baseMs = 500, capMs = 10_000) {
  return Math.random() * Math.min(capMs, baseMs * 2 ** attempt); // "full jitter"
}

export function createClient({ url, refreshToken, onStatus = () => {}, heartbeatMs = 10_000 }) {
  const handlers = new Map();
  const pending = new Map();
  let ws, nextId = 1, attempt = 0, heartbeat, stopped = false;
  let lastSeq = null, epoch = null;
  let synced = false, early = []; // durable events received before room.state/room.resume

  function dispatch(msg) {
    if (typeof msg.seq === "number" && !synced) return void early.push(msg);
    if (typeof msg.seq === "number") {
      if (lastSeq !== null && msg.seq <= lastSeq) return; // already applied: drop duplicates
      lastSeq = msg.seq;
    }
    handlers.get(msg.type)?.forEach((fn) => fn(msg.data, msg));
  }

  function connect() {
    onStatus({ state: "connecting", attempt });
    ws = new WebSocket(url({ lastSeq, epoch }));

    ws.onopen = () => {
      attempt = 0;
      onStatus({ state: "open" });
      heartbeat = setInterval(() => {
        request("ping", null, 5000).catch(() => ws.close(4000, "heartbeat timeout")); // dead link → reconnect
      }, heartbeatMs);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if ((msg.type === "ack" || msg.type === "error") && msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        return msg.type === "ack" ? p.resolve(msg.data) : p.reject(Object.assign(new Error(msg.data.message), msg.data));
      }
      if (msg.type === "room.state") {             // full snapshot: start counting from its seq
        epoch = msg.data.epoch;
        lastSeq = msg.data.seq;
        handlers.get("room.state")?.forEach((fn) => fn(msg.data, msg));
        synced = true;
        early.splice(0).forEach(dispatch); // anything newer than the snapshot is applied; older is dropped by seq
        return;
      }
      if (msg.type === "room.resume") {            // gap fill: refresh presence, then replay missed events in order
        epoch = msg.data.epoch;
        handlers.get("room.resume")?.forEach((fn) => fn(msg.data, msg));
        synced = true;
        [...msg.data.events, ...early.splice(0)].forEach(dispatch);
        return;
      }
      dispatch(msg);
    };

    ws.onclose = async (e) => {
      clearInterval(heartbeat);
      synced = false; early = [];
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error("connection closed")); }
      pending.clear();
      if (stopped) return onStatus({ state: "closed", code: e.code });

      if (e.code === 4001 && refreshToken) { await refreshToken(); return connect(); } // expired token: refresh, retry now
      const delay = backoff(attempt++);
      onStatus({ state: "reconnecting", code: e.code, delay, attempt });
      setTimeout(connect, delay);
    };
  }

  function request(type, data, timeoutMs = 5000) {
    const id = String(nextId++);
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error("not connected"));
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${type} timed out`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type, id, data }));
    });
  }

  connect();
  return {
    get ws() { return ws; },
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    emit(type, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data })); },
    request,
    close() { stopped = true; ws.close(1000); },
  };
}
