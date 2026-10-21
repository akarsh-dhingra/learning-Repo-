// Lesson 0008 lab: rate-limit an API per client with Redis.
import express from "express";
import { createClient } from "redis";
import { fixedWindow, slidingWindow } from "./limiters.js";

const redis = createClient({ url: "redis://localhost:6379" });
redis.on("error", (err) => console.error("Redis Client Error", err));
await redis.connect();

const app = express();

function rateLimit(algo, opts) {
  return async (req, res, next) => {
    const id = req.get("x-user-id") ?? req.ip; // who are we limiting?
    try {
      const r = await algo(redis, id, opts);
      res.set("X-RateLimit-Limit", String(r.limit));
      res.set("X-RateLimit-Remaining", String(Math.max(0, r.limit - r.count)));
      if (!r.allowed) {
        res.set("Retry-After", String(Math.ceil(r.retryAfterMs / 1000)));
        return res.status(429).json({ error: "Too Many Requests", retryAfterMs: r.retryAfterMs });
      }
      next();
    } catch (err) {
      // Fail open: if Redis is down, serve the request rather than take the API down.
      console.error("rate limiter unavailable, failing open", err.message);
      next();
    }
  };
}

app.get("/fixed", rateLimit(fixedWindow, { limit: 10, windowMs: 10_000 }), (req, res) => res.json({ ok: true }));
app.get("/sliding", rateLimit(slidingWindow, { limit: 10, windowMs: 10_000 }), (req, res) => res.json({ ok: true }));

app.listen(3000, () => console.log("Listening on http://localhost:3000  (/fixed, /sliding: 10 req per 10s)"));
