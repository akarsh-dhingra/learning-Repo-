// The message protocol: one JSON envelope for everything, a router keyed by `type`,
// and Zod schemas so handlers only ever see valid data.
import { z } from "zod";
import type { ServerWebSocket } from "bun";

// ── The envelope ─────────────────────────────────────────────
// client → server: { type, id?, data? }
//   id is optional: send it when you want an ack/error reply you can match up.
// server → client: { type: "ack", id, data? } | { type: "error", id?, data: { code, message } } | events
export const Envelope = z.object({
  type: z.string().min(1).max(64),
  id: z.string().max(64).optional(),
  data: z.unknown().optional(),
});
export type Envelope = z.infer<typeof Envelope>;

export type ErrorCode = "bad_json" | "bad_envelope" | "unknown_type" | "invalid" | "forbidden" | "limit" | "rate_limited" | "internal";

// Thrown inside a handler to send a typed error back to the caller.
export class ClientError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
}

export function send(ws: ServerWebSocket<any>, type: string, data?: unknown, extra: Record<string, unknown> = {}) {
  return ws.send(JSON.stringify({ type, ...extra, data }));
}

// ── The router ───────────────────────────────────────────────
type Handler<S extends z.ZodType, D> = (ctx: {
  ws: ServerWebSocket<D>;
  data: z.infer<S>;
  id?: string;
}) => unknown | Promise<unknown>;

export function createRouter<D>() {
  const routes = new Map<string, { schema: z.ZodType; handler: Handler<any, D> }>();

  return {
    // Register a handler. Whatever it returns becomes the ack's data.
    on<S extends z.ZodType>(type: string, schema: S, handler: Handler<S, D>) {
      routes.set(type, { schema, handler });
      return this;
    },

    // Call this from websocket.message. Never throws: every failure becomes an error reply.
    async handle(ws: ServerWebSocket<D>, raw: string | Buffer) {
      let id: string | undefined;
      try {
        let json: unknown;
        try { json = JSON.parse(String(raw)); }
        catch { throw new ClientError("bad_json", "message is not valid JSON"); }

        const env = Envelope.safeParse(json);
        if (!env.success) throw new ClientError("bad_envelope", "expected { type, id?, data? }");
        id = env.data.id;

        const route = routes.get(env.data.type);
        if (!route) throw new ClientError("unknown_type", `unknown message type "${env.data.type}"`);

        const parsed = route.schema.safeParse(env.data.data);
        if (!parsed.success) throw new ClientError("invalid", z.prettifyError(parsed.error));

        const result = await route.handler({ ws, data: parsed.data, id });
        if (id) send(ws, "ack", result ?? null, { id });
      } catch (err) {
        if (err instanceof ClientError) {
          send(ws, "error", { code: err.code, message: err.message }, { id });
        } else {
          console.error("handler crashed:", err);  // log the real error, tell the client nothing internal
          send(ws, "error", { code: "internal", message: "internal error" }, { id });
        }
      }
    },
  };
}
