// Seeds 1,000,000 products. The video inserts them in 10k-row batches from JS;
// generate_series does the same thing inside Postgres in a single statement.
import { pool } from "./db.js";

await pool.query(`
  CREATE TABLE IF NOT EXISTS products (
    id          INT PRIMARY KEY,
    name        TEXT NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    description TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

const { rows } = await pool.query("SELECT count(*)::int AS n FROM products");
if (rows[0].n >= 1_000_000) {
  console.log(`Already seeded (${rows[0].n} rows).`);
} else {
  console.time("seed");
  await pool.query(`
    INSERT INTO products (id, name, price, description)
    SELECT g, 'Product ' || g, round((random() * 1000)::numeric, 2), md5(g::text)
    FROM generate_series(1, 1000000) AS g
    ON CONFLICT (id) DO NOTHING`);
  console.timeEnd("seed");
}

const sample = await pool.query("SELECT id, name, price FROM products ORDER BY id LIMIT 3");
console.table(sample.rows);
await pool.end();
