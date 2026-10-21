import pg from "pg";
import { createClient } from "redis";

export const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  user: "user",
  password: "pass",
  database: "mydb",
});

export async function connectRedis() {
  const redis = createClient({ url: "redis://localhost:6379" });
  redis.on("error", (err) => console.error("Redis Client Error", err));
  await redis.connect();
  return redis;
}
