import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { q, seedUser } from "./db.js";

const SECRET = process.env.JWT_SECRET || "change-me-in-env";
const COOKIE = "khata_session";
const MAX_AGE = 1000 * 60 * 60 * 24 * 30;

export function issue(res, user) {
  const token = jwt.sign({ uid: user.id, email: user.email }, SECRET, { expiresIn: "30d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
  });
}

export function clear(res) {
  res.clearCookie(COOKIE);
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Sign in again." });
  }
}

export async function signup(email, password, name) {
  const existing = await q("SELECT COUNT(*)::int AS n FROM users");
  const isFirst = existing.rows[0].n === 0;
  if (!isFirst && process.env.SIGNUP_ENABLED !== "true") {
    throw Object.assign(new Error("Sign-ups are closed on this instance."), { status: 403 });
  }
  if (!email || !password || password.length < 8) {
    throw Object.assign(new Error("Email and a password of at least 8 characters are required."), { status: 400 });
  }
  const dupe = await q("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
  if (dupe.rowCount) throw Object.assign(new Error("That email is already registered."), { status: 409 });

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await q(
    "INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id, email, name",
    [email.toLowerCase(), hash, name || null]
  );
  await seedUser(rows[0].id);
  return rows[0];
}

export async function login(email, password) {
  const { rows } = await q("SELECT * FROM users WHERE email=$1", [String(email || "").toLowerCase()]);
  if (!rows.length) throw Object.assign(new Error("No account with that email."), { status: 401 });
  const ok = await bcrypt.compare(password || "", rows[0].password_hash);
  if (!ok) throw Object.assign(new Error("Wrong password."), { status: 401 });
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name };
}
