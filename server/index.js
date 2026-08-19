import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { migrate, q } from "./db.js";
import { issue, clear, requireAuth, signup, login } from "./auth.js";
import api from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  try { await q("SELECT 1"); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* --------------------------------- auth -------------------------------- */

app.post("/api/auth/signup", async (req, res) => {
  try {
    const user = await signup(req.body.email, req.body.password, req.body.name);
    issue(res, user);
    res.json({ user });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await login(req.body.email, req.body.password);
    issue(res, user);
    res.json({ user });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post("/api/auth/logout", (_req, res) => { clear(res); res.json({ ok: true }); });

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const { rows } = await q("SELECT id, email, name FROM users WHERE id=$1", [req.user.uid]);
  res.json({ user: rows[0] || null });
});

app.get("/api/auth/status", async (_req, res) => {
  const { rows } = await q("SELECT COUNT(*)::int AS n FROM users");
  res.json({ needsFirstUser: rows[0].n === 0, signupEnabled: process.env.SIGNUP_ENABLED === "true" });
});

app.use("/api", api);

/* ------------------------------ static site ---------------------------- */

const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  app.get("/", (_req, res) =>
    res.status(503).send("Client not built yet. Run <code>npm run build</code>, or use <code>npm run dev</code> in development."));
}

app.use((req, res) => res.status(404).json({ error: "Not found: " + req.path }));

const port = process.env.PORT || 3000;
migrate()
  .then(() => app.listen(port, () => console.log(`Khata Book listening on :${port}`)))
  .catch(err => { console.error("Could not start:", err); process.exit(1); });
