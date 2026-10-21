// Two rate limiters. Each one is a single Lua script, so every check is atomic.

// 1) Fixed window: the video's counter. INCR, and set the TTL only on the
//    first hit so the window doesn't slide forward on every request.
//    Doing it in one script fixes the race the INCR docs warn about
//    (a client that INCRs and then dies before EXPIRE leaks the key forever).
const FIXED_WINDOW = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return { n, redis.call("PTTL", KEYS[1]) }`;

export async function fixedWindow(redis, id, { limit, windowMs }) {
  const [count, ttlMs] = await redis.eval(FIXED_WINDOW, {
    keys: [`rl:fixed:${id}`],
    arguments: [String(windowMs)],
  });
  return { allowed: count <= limit, count, limit, retryAfterMs: count <= limit ? 0 : ttlMs };
}

// 2) Sliding window log: a sorted set of request timestamps (score = time).
//    Drop entries older than the window, count what's left, and add this
//    request only if under the limit. No burst at window boundaries.
const SLIDING_WINDOW = `
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - window)
local count = redis.call("ZCARD", KEYS[1])
if count < limit then
  redis.call("ZADD", KEYS[1], now, ARGV[4])
  redis.call("PEXPIRE", KEYS[1], window)
  return { 1, count + 1, 0 }
end
local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
return { 0, count, (tonumber(oldest[2]) + window) - now }`;

export async function slidingWindow(redis, id, { limit, windowMs }) {
  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2)}`; // unique per request
  const [ok, count, retryAfterMs] = await redis.eval(SLIDING_WINDOW, {
    keys: [`rl:sliding:${id}`],
    arguments: [String(now), String(windowMs), String(limit), member],
  });
  return { allowed: ok === 1, count, limit, retryAfterMs };
}
