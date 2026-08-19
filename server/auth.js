import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
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

/**
 * Bearer-token auth for the SMS listener running natively on Android, outside
 * the WebView and its cookie. A device token is a 256-bit random string shown
 * to the user once, at issue time, then never again — only its sha256 is kept.
 */
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");

export function generateDeviceToken() {
  const token = "kdt_" + crypto.randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export async function requireDeviceToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: "Missing device token." });
  const { rows } = await q("SELECT id, user_id FROM device_tokens WHERE token_hash=$1", [hashToken(token)]);
  if (!rows.length) return res.status(401).json({ error: "Unknown or revoked device token." });
  req.user = { uid: rows[0].user_id };
  q("UPDATE device_tokens SET last_used_at=now() WHERE id=$1", [rows[0].id]).catch(() => {});
  next();
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
