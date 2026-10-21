// Browser side of the protocol: request() returns a Promise resolved by the matching ack/error,
// on(type, fn) subscribes to server events. Reused by every browser client in this course.
export function createClient(url) {
  const ws = new WebSocket(url);
  const pending = new Map(); // id → { resolve, reject, timer }
  const handlers = new Map(); // type → Set<fn>
  let nextId = 1;

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if ((msg.type === "ack" || msg.type === "error") && msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.type === "ack" ? p.resolve(msg.data) : p.reject(Object.assign(new Error(msg.data.message), msg.data));
      return;
    }
    handlers.get(msg.type)?.forEach((fn) => fn(msg.data, msg));
  };

  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  return {
    ws,
    ready,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    // fire-and-forget (cursors): no id, so the server sends no ack
    emit(type, data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
    },
    // request/response over the socket (strokes, chat): resolves with ack data, rejects on error/timeout
    request(type, data, timeoutMs = 5000) {
      const id = String(nextId++);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${type} timed out`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ type, id, data }));
      });
    },
  };
}
