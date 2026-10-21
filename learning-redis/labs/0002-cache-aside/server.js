// Lesson 0002 lab: cache-aside in front of a slow external API.
// Run Redis first (see lesson), then: npm install && npm start
// Try: curl -s localhost:3000/posts/10   (twice, compare "ms")
import express from "express";
import { createClient } from "redis";

const TTL_SECONDS = 600;

const redis = createClient({ url: "redis://localhost:6379" });
redis.on("error", (err) => console.error("Redis Client Error", err));
await redis.connect();

const app = express();

app.get("/posts/:id", async (req, res) => {
  const started = performance.now();
  const key = `post:${req.params.id}`;

  // 1. Check the cache first
  const cached = await redis.get(key);
  if (cached) {
    return res.json({
      source: "redis",
      ms: +(performance.now() - started).toFixed(1),
      data: JSON.parse(cached),
    });
  }

  // 2. Miss: go to the slow source of truth
  const upstream = await fetch(`https://jsonplaceholder.typicode.com/posts/${req.params.id}`);
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: "not found upstream" });
  }
  const data = await upstream.json();

  // 3. Fill the cache with a TTL, then respond
  await redis.set(key, JSON.stringify(data), { EX: TTL_SECONDS });

  res.json({
    source: "external-api",
    ms: +(performance.now() - started).toFixed(1),
    data,
  });
});

app.listen(3000, () => console.log("Listening on http://localhost:3000"));


