import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. On Railway, add a Postgres service and reference ${{Postgres.DATABASE_URL}}.");
  process.exit(1);
}

const needsSSL = /railway|render|neon|supabase|amazonaws/.test(process.env.DATABASE_URL) &&
  !/sslmode=disable/.test(process.env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX) || 8,
});

export const q = (text, params) => pool.query(text, params);

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("schema ready");
}

/**
 * Rows a new account starts with.
 *
 * One generic account so the first import has somewhere to land, and no people
 * at all — a name is the most personal thing this app stores, and guessing at
 * someone's family is worse than an empty list they fill in themselves. The
 * single-user version of this app shipped its owner's banks and children here,
 * which is exactly the kind of thing that must not survive into a product.
 */
export async function seedUser(userId) {
  await q("INSERT INTO accounts (user_id, name, kind) VALUES ($1,$2,$3)", [userId, "Bank account", "bank"]);
}
