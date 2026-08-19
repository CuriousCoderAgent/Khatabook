import { Router } from "express";
import { q } from "../db.js";
import { requireAuth, requireDeviceToken, generateDeviceToken } from "../auth.js";
import { classifyRows } from "../lib/classify.js";
import { extractFromSms, extractEnabled } from "../lib/statementExtract.js";
import { insertBatch } from "../lib/transactions.js";

const r = Router();
const uid = req => req.user.uid;
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something broke on the server." });
});

/* --------------------------- device management -------------------------- */
/* Cookie-authed, same as the rest of the app — this is the phone's owner   */
/* managing their own devices from Settings, in a normal signed-in session. */

r.get("/device-tokens", requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    "SELECT id, label, platform, last_used_at, created_at FROM device_tokens WHERE user_id=$1 ORDER BY id DESC",
    [uid(req)]
  );
  res.json(rows.map(d => ({
    id: d.id, label: d.label, platform: d.platform,
    lastUsedAt: d.last_used_at, createdAt: d.created_at,
  })));
}));

r.post("/device-tokens", requireAuth, wrap(async (req, res) => {
  const label = String(req.body.label || "").slice(0, 80) || null;
  const platform = req.body.platform === "ios" ? "ios" : "android";
  const { token, hash } = generateDeviceToken();
  const { rows } = await q(
    "INSERT INTO device_tokens (user_id, token_hash, label, platform) VALUES ($1,$2,$3,$4) RETURNING id, created_at",
    [uid(req), hash, label, platform]
  );
  // The only moment this token is ever readable — the client must store it on
  // the device now (Android Keystore-backed prefs) or it's gone for good, same
  // as any other API key.
  res.json({ id: rows[0].id, token, label, platform, createdAt: rows[0].created_at });
}));

r.delete("/device-tokens/:id", requireAuth, wrap(async (req, res) => {
  await q("DELETE FROM device_tokens WHERE user_id=$1 AND id=$2", [uid(req), req.params.id]);
  res.json({ ok: true });
}));

/* ------------------------------ device ingest ---------------------------- */
/* Bearer-authed — this is the Android background listener, forwarding a bank */
/* alert with no human at the keyboard to review it first. Runs the exact    */
/* same read-then-sort pipeline as pasting the message by hand (see          */
/* /import/sms in routes/api.js) and then files it straight into the ledger, */
/* skipping anything whose fingerprint is already there so a bank that likes */
/* to re-send an alert can't double-file it. */

r.post("/import/sms/device", requireDeviceToken, wrap(async (req, res) => {
  if (!extractEnabled()) {
    return res.status(400).json({ error: "Reading messages needs ANTHROPIC_API_KEY set on the server." });
  }
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(0, 20) : [];
  const text = messages.map(m => String(m.body || "").trim()).filter(Boolean).join("\n\n");
  if (!text) return res.json({ imported: 0, skipped: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const extracted = await extractFromSms(text, today);
  if (!extracted.length) return res.json({ imported: 0, skipped: 0 });

  const u = uid(req);
  const accts = await q("SELECT id, name, last4 FROM accounts WHERE user_id=$1 AND NOT archived", [u]);
  const byLast4 = new Map(accts.rows.filter(a => a.last4).map(a => [String(a.last4), a]));
  const withAccount = extracted.map(row => {
    const hit = row.last4 ? byLast4.get(row.last4) : null;
    return { ...row, accountId: hit ? hit.id : null };
  });

  const verdicts = await classifyRows(u, withAccount);
  const rows = withAccount.map((row, i) => ({
    date: row.date, desc: row.description, amount: row.amount, dir: row.direction,
    cat: verdicts[i].category, sub: verdicts[i].subcategory, scope: verdicts[i].scope,
    accountId: row.accountId, reimb: verdicts[i].reimbursable ? "pending" : "none",
    source: "sms-auto", confidence: verdicts[i].confidence, reason: verdicts[i].reason,
  }));

  const { inserted, skipped } = await insertBatch(u, rows, {
    filename: "SMS auto-capture", rowCount: rows.length,
  });
  res.json({ imported: inserted, skipped });
}));

export default r;
