// Lesson 0006 lab: cache-aside in front of Postgres, plus invalidation on write.
import express from "express";
import { pool, connectRedis } from "./db.js";

const TTL_SECONDS = 600;
const redis = await connectRedis();
const app = express();
app.use(express.json());

const key = (id) => `product:${id}`;

app.get("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 1_000_000) {
    return res.status(400).json({ error: "id must be 1..1000000" });
  }
  const started = performance.now();

  const cached = await redis.get(key(id));
  if (cached) {
    return res.json({ source: "cache", ms: +(performance.now() - started).toFixed(2), data: JSON.parse(cached) });
  }

  const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
  if (rows.length === 0) return res.status(404).json({ error: "not found" });

  await redis.set(key(id), JSON.stringify(rows[0]), { EX: TTL_SECONDS });
  res.json({ source: "db", ms: +(performance.now() - started).toFixed(2), data: rows[0] });
});

// Write path: update the source of truth FIRST, then delete the cache entry.
// The next GET is a miss and refills with fresh data.
app.put("/products/:id/price", async (req, res) => {
  const id = Number(req.params.id);
  const { price } = req.body ?? {};
  if (typeof price !== "number") return res.status(400).json({ error: "body: { price: number }" });

  const { rowCount } = await pool.query(
    "UPDATE products SET price = $1, updated_at = now() WHERE id = $2",
    [price, id],
  );
  if (rowCount === 0) return res.status(404).json({ error: "not found" });

  await redis.del(key(id));
  res.json({ ok: true, invalidated: key(id) });
});

app.listen(3000, () => console.log("Listening on http://localhost:3000"));
