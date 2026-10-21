// Minimal signed tokens (same idea as a JWT, without the library):
//   token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(SECRET, payloadPart))
//   payload = { sub: userId, name, exp: unix seconds }
// In a real system your main API issues these at login; the socket server only VERIFIES them.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SECRET = process.env.SECRET ?? "dev-secret-change-me";
export type TokenPayload = { sub: string; name: string; exp: number };

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const sign = (part: string) => createHmac("sha256", SECRET).update(part).digest();

export function signToken(payload: TokenPayload): string {
  const part = b64url(JSON.stringify(payload));
  return `${part}.${b64url(sign(part))}`;
}

export function verifyToken(token: string | null): TokenPayload | null {
  if (!token) return null;
  const [part, sig] = token.split(".");
  if (!part || !sig) return null;
  const expected = sign(part);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null; // constant-time compare
  try {
    const p = JSON.parse(Buffer.from(part, "base64url").toString()) as TokenPayload;
    if (typeof p.sub !== "string" || typeof p.exp !== "number") return null;
    if (p.exp * 1000 <= Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
