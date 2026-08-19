import { Router } from "express";
import multer from "multer";
import { q } from "../db.js";
import { requireAuth } from "../auth.js";
import { classifyRows, remember, aiEnabled } from "../lib/classify.js";
import { CATEGORIES, normaliseMerchant } from "../lib/taxonomy.js";
import { extractPdfTable } from "../lib/pdfImport.js";
import { extractTransactions, extractTotals, extractFromSms, reconcile, extractEnabled } from "../lib/statementExtract.js";
import { encrypt, decrypt } from "../lib/secret.js";
import { INSERT_TX, principalOf, fingerprint } from "../lib/transactions.js";

const r = Router();
r.use(requireAuth);
const uid = req => req.user.uid;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const shapeAccount = a => {
  const { pdf_password_enc, ...rest } = a;
  return { ...rest, hasPdfPassword: !!pdf_password_enc };
};

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something broke on the server." });
});

/* ------------------------------ bootstrap ------------------------------ */

r.get("/bootstrap", wrap(async (req, res) => {
  const u = uid(req);
  // Sequential on purpose: ten cheap indexed reads, and hosted Postgres plans
  // often cap concurrent connections well below a parallel fan-out.
  const accounts = await q("SELECT * FROM accounts WHERE user_id=$1 AND NOT archived ORDER BY id", [u]);
  const people   = await q("SELECT * FROM people WHERE user_id=$1 ORDER BY id", [u]);
  const holdings = await q("SELECT * FROM holdings WHERE user_id=$1 ORDER BY symbol", [u]);
  const lots     = await q("SELECT l.* FROM lots l JOIN holdings h ON h.id=l.holding_id WHERE h.user_id=$1 ORDER BY l.buy_date", [u]);
  const prices   = await q("SELECT p.* FROM price_points p JOIN holdings h ON h.id=p.holding_id WHERE h.user_id=$1 ORDER BY p.as_of", [u]);
  const sales    = await q("SELECT s.* FROM sales s JOIN holdings h ON h.id=s.holding_id WHERE h.user_id=$1 ORDER BY s.sell_date", [u]);
  const fds      = await q("SELECT * FROM fixed_deposits WHERE user_id=$1 ORDER BY maturity_date", [u]);
  const assets   = await q("SELECT * FROM assets WHERE user_id=$1 ORDER BY id", [u]);
  const budgets  = await q("SELECT * FROM budgets WHERE user_id=$1", [u]);
  const memory   = await q("SELECT * FROM merchant_memory WHERE user_id=$1 ORDER BY hits DESC LIMIT 300", [u]);
  const batches  = await q("SELECT * FROM import_batches WHERE user_id=$1 ORDER BY id DESC LIMIT 20", [u]);

  res.json({
    categories: CATEGORIES,
    aiEnabled: aiEnabled(),
    accounts: accounts.rows.map(shapeAccount),
    people: people.rows,
    holdings: holdings.rows.map(h => ({
      ...h,
      lots: lots.rows.filter(l => l.holding_id === h.id),
      prices: prices.rows.filter(p => p.holding_id === h.id),
      sales: sales.rows.filter(s => s.holding_id === h.id),
    })),
    fds: fds.rows,
    assets: assets.rows,
    budgets: Object.fromEntries(budgets.rows.map(b => [b.category, Number(b.amount)])),
    memory: memory.rows,
    batches: batches.rows,
  });
}));

/* ----------------------------- transactions ---------------------------- */

const txShape = t => ({
  id: t.id,
  date: t.txn_date instanceof Date ? t.txn_date.toISOString().slice(0, 10) : String(t.txn_date).slice(0, 10),
  desc: t.description,
  amount: Number(t.amount),
  dir: t.direction,
  cat: t.category,
  sub: t.subcategory,
  // NUMERIC arrives as a string, and null means "split not recorded" — which is
  // not the same as zero principal, so it must survive as null.
  principal: t.principal == null ? null : Number(t.principal),
  scope: t.scope,
  accountId: t.account_id,
  reimb: t.reimb,
  personId: t.person_id,
  note: t.note,
  source: t.source,
  confidence: t.ai_confidence,
  reason: t.ai_reason,
});

r.get("/transactions", wrap(async (req, res) => {
  const { from, to, category, q: search, limit } = req.query;
  const params = [uid(req)];
  let sql = "SELECT * FROM transactions WHERE user_id=$1";
  if (from) { params.push(from); sql += ` AND txn_date >= $${params.length}`; }
  if (to) { params.push(to); sql += ` AND txn_date <= $${params.length}`; }
  if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
  if (search) { params.push(`%${search}%`); sql += ` AND description ILIKE $${params.length}`; }
  sql += " ORDER BY txn_date DESC, id DESC";
  params.push(Math.min(Number(limit) || 5000, 20000));
  sql += ` LIMIT $${params.length}`;
  const { rows } = await q(sql, params);
  res.json(rows.map(txShape));
}));

r.post("/transactions", wrap(async (req, res) => {
  const t = req.body;
  const { rows } = await q(INSERT_TX, [
    uid(req), t.date, t.desc || "", Math.abs(Number(t.amount)), t.dir, t.cat || "misc",
    t.sub || null, t.scope || "personal", t.accountId || null, t.reimb || "none",
    t.personId || null, t.note || null, t.source || "manual", t.batchId || null,
    fingerprint(t), t.confidence || null, t.reason || null, principalOf(t),
  ]);
  res.json(txShape(rows[0]));
}));

r.post("/transactions/bulk", wrap(async (req, res) => {
  const list = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!list.length) return res.json({ inserted: 0 });
  const u = uid(req);
  const client = await (await import("../db.js")).pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    let batchId = null;
    if (req.body.batch) {
      const b = req.body.batch;
      const dates = list.map(t => t.date).sort();
      const br = await client.query(
        `INSERT INTO import_batches (user_id, account_id, filename, row_count, imported, period_from, period_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [u, b.accountId || null, b.filename || null, b.rowCount || list.length, list.length, dates[0], dates[dates.length - 1]]
      );
      batchId = br.rows[0].id;
    }
    for (const t of list) {
      await client.query(INSERT_TX, [
        u, t.date, t.desc || "", Math.abs(Number(t.amount)), t.dir, t.cat || "misc",
        t.sub || null, t.scope || "personal", t.accountId || null, t.reimb || "none",
        t.personId || null, t.note || null, t.source || "import", batchId,
        fingerprint(t), t.confidence || null, t.reason || null, principalOf(t),
      ]);
      inserted++;
    }
    await client.query("COMMIT");
    res.json({ inserted, batchId });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

r.patch("/transactions/:id", wrap(async (req, res) => {
  const allowed = {
    date: "txn_date", desc: "description", amount: "amount", dir: "direction",
    cat: "category", sub: "subcategory", scope: "scope", accountId: "account_id",
    reimb: "reimb", personId: "person_id", note: "note", principal: "principal",
  };
  const sets = [], params = [uid(req), req.params.id];
  for (const [k, col] of Object.entries(allowed)) {
    if (k in req.body) { params.push(req.body[k] === "" ? null : req.body[k]); sets.push(`${col}=$${params.length}`); }
  }
  // Principal describes a home loan EMI and nothing else. Recategorising a row
  // away from home_loan has to drop it, or a stale split sits on a grocery bill
  // and quietly subtracts itself from spending.
  if ("cat" in req.body && req.body.cat !== "home_loan" && !("principal" in req.body)) {
    sets.push("principal=NULL");
  }
  if (!sets.length) return res.json({ ok: true });
  sets.push("updated_at=now()");
  const { rows } = await q(
    `UPDATE transactions SET ${sets.join(", ")} WHERE user_id=$1 AND id=$2 RETURNING *`, params
  );
  if (!rows.length) return res.status(404).json({ error: "No such entry." });

  // Clamp after the fact rather than inside the SET above: the amount may be
  // changing in this same request, and a right-hand-side `amount` there still
  // reads the old value. A principal over the EMI would make the interest
  // negative, which would subtract from spending instead of adding to it.
  if (rows[0].principal != null) {
    const fixed = await q(
      `UPDATE transactions SET principal = LEAST(abs(principal), abs(amount))
        WHERE user_id=$1 AND id=$2 AND (principal < 0 OR principal > abs(amount))
        RETURNING *`, [uid(req), req.params.id]
    );
    if (fixed.rows.length) rows[0] = fixed.rows[0];
  }

  // A category change is a teaching moment.
  if (("cat" in req.body || "sub" in req.body || "scope" in req.body) && req.body.learn !== false) {
    await remember(uid(req), rows[0].description, {
      category: rows[0].category, subcategory: rows[0].subcategory,
      scope: rows[0].scope, reimb: rows[0].reimb,
    });
  }
  res.json(txShape(rows[0]));
}));

r.delete("/transactions/:id", wrap(async (req, res) => {
  await q("DELETE FROM transactions WHERE user_id=$1 AND id=$2", [uid(req), req.params.id]);
  res.json({ ok: true });
}));

r.post("/transactions/bulk-update", wrap(async (req, res) => {
  const { ids = [], patch = {} } = req.body;
  if (!ids.length) return res.json({ updated: 0 });
  const map = { cat: "category", sub: "subcategory", scope: "scope", reimb: "reimb", personId: "person_id" };
  const sets = [], params = [uid(req), ids];
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) { params.push(patch[k] === "" ? null : patch[k]); sets.push(`${col}=$${params.length}`); }
  }
  // Same reason as the single-row patch: a split belongs to a home loan EMI.
  if ("cat" in patch && patch.cat !== "home_loan") sets.push("principal=NULL");
  if (!sets.length) return res.json({ updated: 0 });
  const { rowCount } = await q(
    `UPDATE transactions SET ${sets.join(", ")} WHERE user_id=$1 AND id = ANY($2::int[])`, params
  );
  res.json({ updated: rowCount });
}));

/* -------------------------------- import ------------------------------- */

r.post("/import/classify", wrap(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 1200) : [];
  if (!rows.length) return res.json({ rows: [] });
  const verdicts = await classifyRows(uid(req), rows);

  const fps = rows.map(row => fingerprint({ date: row.date, amount: row.amount, desc: row.description }));
  const dupRes = await q(
    "SELECT fingerprint FROM transactions WHERE user_id=$1 AND fingerprint = ANY($2::text[])",
    [uid(req), fps]
  );
  const dupes = new Set(dupRes.rows.map(d => d.fingerprint));

  // Softer check on date and amount alone. The same purchase reaches the ledger
  // twice under two different names — "Swiggy" off an SMS alert, "WWW SWIGGY
  // COMGURGAON" off the statement a month later — and the fingerprint, which
  // leans on the description, never sees it. Two genuine ₹500 orders on one day
  // will flag each other, which is why this only unticks a row rather than
  // refusing it.
  const nearRes = await q(
    `SELECT to_char(txn_date,'YYYY-MM-DD') AS d, amount::float AS a, description, fingerprint
       FROM transactions
      WHERE user_id=$1 AND txn_date = ANY($2::date[]) AND amount = ANY($3::numeric[])`,
    [uid(req), rows.map(r => r.date), rows.map(r => Math.abs(Number(r.amount)))]
  );
  const near = new Map();
  for (const n of nearRes.rows) {
    const k = `${n.d}|${Math.round(n.a * 100)}`;
    if (!near.has(k)) near.set(k, []);
    near.get(k).push(n);
  }

  res.json({
    aiEnabled: aiEnabled(),
    rows: rows.map((row, i) => {
      const duplicate = dupes.has(fps[i]);
      const hits = near.get(`${row.date}|${Math.round(Math.abs(Number(row.amount)) * 100)}`) || [];
      const other = hits.find(h => h.fingerprint !== fps[i]);
      return {
        ...row,
        ...verdicts[i],
        cat: verdicts[i].category,
        sub: verdicts[i].subcategory,
        reimb: verdicts[i].reimbursable ? "pending" : "none",
        duplicate,
        maybeDuplicate: !duplicate && Boolean(other),
        maybeDuplicateOf: !duplicate && other ? String(other.description).slice(0, 60) : null,
      };
    }),
  });
}));

/**
 * Paste the alerts your bank sends when money moves. Same four fields out as a
 * statement, plus the account tail, so a day's spending can be filed from the
 * phone without waiting for the month to end.
 */
r.post("/import/sms", wrap(async (req, res) => {
  if (!extractEnabled()) {
    return res.status(400).json({ error: "Reading messages needs ANTHROPIC_API_KEY set on the server." });
  }
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Nothing pasted." });

  const today = new Date().toISOString().slice(0, 10);
  const rows = await extractFromSms(text, today);
  if (!rows.length) {
    return res.json({ rows: [], note: "No transaction could be read out of that. Alerts about OTPs, offers and due dates are ignored." });
  }

  // Match the tail the message quotes against the accounts that know theirs.
  const accts = await q("SELECT id, name, last4 FROM accounts WHERE user_id=$1 AND NOT archived", [uid(req)]);
  const byLast4 = new Map(accts.rows.filter(a => a.last4).map(a => [String(a.last4), a]));

  res.json({
    rows: rows.map(r => {
      const hit = r.last4 ? byLast4.get(r.last4) : null;
      return { ...r, accountId: hit ? hit.id : null, accountName: hit ? hit.name : null };
    }),
    unmatchedTails: [...new Set(rows.filter(r => r.last4 && !byLast4.has(r.last4)).map(r => r.last4))],
  });
}));

/* ------------------------------- analytics ----------------------------- */

r.get("/analytics/monthly", wrap(async (req, res) => {
  const u = uid(req);
  const from = req.query.from || "2026-01-01";
  const { rows } = await q(
    `SELECT to_char(txn_date,'YYYY-MM') AS month, category, subcategory, scope, direction,
            SUM(amount)::float AS total, COUNT(*)::int AS n
     FROM transactions
     WHERE user_id=$1 AND txn_date >= $2
     GROUP BY 1,2,3,4,5
     ORDER BY 1`,
    [u, from]
  );
  const owed = await q(
    `SELECT COALESCE(SUM(amount),0)::float AS total FROM transactions
     WHERE user_id=$1 AND direction='out' AND reimb IN ('pending','claimed')`, [u]
  );
  res.json({ rows, owed: owed.rows[0].total });
}));

r.get("/analytics/subcategories", wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT category, subcategory, COUNT(*)::int AS n, SUM(amount)::float AS total
     FROM transactions WHERE user_id=$1 AND subcategory IS NOT NULL
     GROUP BY 1,2 ORDER BY total DESC`, [uid(req)]
  );
  res.json(rows);
}));

/* --------------------------- reference records ------------------------- */

const crud = (name, table, cols, shape = x => x) => {
  r.get(`/${name}`, wrap(async (req, res) => {
    const { rows } = await q(`SELECT * FROM ${table} WHERE user_id=$1 ORDER BY id`, [uid(req)]);
    res.json(rows.map(shape));
  }));
  r.post(`/${name}`, wrap(async (req, res) => {
    const vals = cols.map(c => req.body[c] ?? null);
    const ph = cols.map((_, i) => `$${i + 2}`).join(",");
    const { rows } = await q(
      `INSERT INTO ${table} (user_id, ${cols.join(",")}) VALUES ($1, ${ph}) RETURNING *`,
      [uid(req), ...vals]
    );
    res.json(shape(rows[0]));
  }));
  r.patch(`/${name}/:id`, wrap(async (req, res) => {
    const sets = [], params = [uid(req), req.params.id];
    for (const c of cols) if (c in req.body) { params.push(req.body[c]); sets.push(`${c}=$${params.length}`); }
    if (!sets.length) return res.json({ ok: true });
    const { rows } = await q(
      `UPDATE ${table} SET ${sets.join(",")} WHERE user_id=$1 AND id=$2 RETURNING *`, params
    );
    res.json(shape(rows[0]));
  }));
  r.delete(`/${name}/:id`, wrap(async (req, res) => {
    await q(`DELETE FROM ${table} WHERE user_id=$1 AND id=$2`, [uid(req), req.params.id]);
    res.json({ ok: true });
  }));
};

crud("accounts", "accounts", ["name", "kind", "last4", "archived"], shapeAccount);
crud("people", "people", ["name", "relation"]);
crud("assets", "assets", ["name", "kind", "value", "as_of"]);
crud("fds", "fixed_deposits", ["bank", "principal", "rate", "start_date", "maturity_date", "compounding", "note"]);

r.patch("/accounts/:id/pdf-password", wrap(async (req, res) => {
  const enc = req.body.password ? encrypt(req.body.password) : null;
  const { rowCount } = await q(
    "UPDATE accounts SET pdf_password_enc=$3 WHERE user_id=$1 AND id=$2", [uid(req), req.params.id, enc]
  );
  if (!rowCount) return res.status(404).json({ error: "No such account." });
  res.json({ ok: true, hasPdfPassword: !!enc });
}));

/* ---------------------------- statement import -------------------------- */

/**
 * Takes a statement as PDF, CSV or TXT and hands the text to Claude, which
 * returns the transaction rows. Real statements open with half a page of
 * letterhead, address and account detail before the table starts, which is
 * what the older column-mapping heuristic kept latching onto.
 *
 * Falls back to returning the raw grid so the client can offer manual column
 * mapping when there is no API key, or when extraction comes back empty.
 */
r.post("/import/statement", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  const accountId = req.body.accountId;
  const isPdf = req.file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";

  let password = req.body.password || null;
  if (isPdf && !password && accountId) {
    const { rows } = await q("SELECT pdf_password_enc FROM accounts WHERE id=$1 AND user_id=$2", [accountId, uid(req)]);
    if (rows[0]?.pdf_password_enc) password = decrypt(rows[0].pdf_password_enc);
  }

  let lines, matrix = null;
  if (isPdf) {
    try {
      matrix = await extractPdfTable(req.file.buffer, password);
    } catch (e) {
      if (e.name === "PasswordException") {
        return res.status(401).json({
          error: e.code === 1 ? "This PDF needs a password." : "That password didn't work.",
          needsPassword: true,
        });
      }
      throw e;
    }
    lines = matrix.map(cells => cells.join(" | ").replace(/(\s*\|\s*)+$/, "").trim()).filter(Boolean);
    if (req.body.savePassword === "true" && password && accountId) {
      await q("UPDATE accounts SET pdf_password_enc=$3 WHERE user_id=$1 AND id=$2", [uid(req), accountId, encrypt(password)]);
    }
  } else {
    lines = req.file.buffer.toString("utf8").split(/\r?\n/);
  }

  if (!extractEnabled()) {
    return res.json({ via: "raw", matrix, text: isPdf ? null : req.file.buffer.toString("utf8") });
  }

  let acctName = "";
  if (accountId) {
    const { rows } = await q("SELECT name, kind FROM accounts WHERE id=$1 AND user_id=$2", [accountId, uid(req)]);
    if (rows[0]) acctName = `${rows[0].name} (${rows[0].kind})`;
  }

  try {
    const rows = await extractTransactions(lines, acctName);
    if (rows.length) {
      const totals = await extractTotals(lines);
      return res.json({ via: "ai", rows, totals, check: reconcile(rows, totals) });
    }
    return res.json({ via: "raw", matrix, text: isPdf ? null : req.file.buffer.toString("utf8"),
      note: "Claude found no transactions in that file — map the columns by hand." });
  } catch (e) {
    console.error("statement extraction failed:", e.message);
    return res.json({ via: "raw", matrix, text: isPdf ? null : req.file.buffer.toString("utf8"),
      note: "Reading it with Claude failed — map the columns by hand." });
  }
}));

/* -------------------------------- holdings ----------------------------- */

r.post("/holdings", wrap(async (req, res) => {
  const { symbol, name, kind, qty, price, date } = req.body;
  const h = await q(
    "INSERT INTO holdings (user_id, symbol, name, kind) VALUES ($1,$2,$3,$4) RETURNING *",
    [uid(req), String(symbol).toUpperCase(), name || null, kind || "stock"]
  );
  const id = h.rows[0].id;
  await q("INSERT INTO lots (holding_id, qty, price, buy_date) VALUES ($1,$2,$3,$4)", [id, qty, price, date]);
  await q("INSERT INTO price_points (holding_id, as_of, price, note) VALUES ($1,$2,$3,'purchase')", [id, date, price]);
  res.json({ ...h.rows[0], lots: [], prices: [] });
}));

r.delete("/holdings/:id", wrap(async (req, res) => {
  await q("DELETE FROM holdings WHERE user_id=$1 AND id=$2", [uid(req), req.params.id]);
  res.json({ ok: true });
}));

const ownsHolding = async (req) => {
  const { rowCount } = await q("SELECT 1 FROM holdings WHERE id=$1 AND user_id=$2", [req.params.id, uid(req)]);
  if (!rowCount) throw Object.assign(new Error("No such holding."), { status: 404 });
};

r.post("/holdings/:id/prices", wrap(async (req, res) => {
  await ownsHolding(req);
  const { rows } = await q(
    "INSERT INTO price_points (holding_id, as_of, price, note) VALUES ($1,$2,$3,$4) RETURNING *",
    [req.params.id, req.body.as_of, req.body.price, req.body.note || null]
  );
  res.json(rows[0]);
}));

r.delete("/holdings/:id/prices/:pid", wrap(async (req, res) => {
  await ownsHolding(req);
  const count = await q("SELECT COUNT(*)::int n FROM price_points WHERE holding_id=$1", [req.params.id]);
  if (count.rows[0].n <= 1) return res.status(400).json({ error: "A holding must keep at least one price." });
  await q("DELETE FROM price_points WHERE holding_id=$1 AND id=$2", [req.params.id, req.params.pid]);
  res.json({ ok: true });
}));

r.get("/holdings/:id/sales", wrap(async (req, res) => {
  await ownsHolding(req);
  const { rows } = await q("SELECT * FROM sales WHERE holding_id=$1 ORDER BY sell_date", [req.params.id]);
  res.json(rows);
}));

r.post("/holdings/:id/sales", wrap(async (req, res) => {
  await ownsHolding(req);
  const { qty, price, sell_date, cost_basis, note } = req.body;
  const { rows } = await q(
    `INSERT INTO sales (holding_id, qty, price, sell_date, cost_basis, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, qty, price, sell_date,
     cost_basis === "" || cost_basis == null ? null : cost_basis, note || null]
  );
  res.json(rows[0]);
}));

r.patch("/holdings/:id/sales/:sid", wrap(async (req, res) => {
  await ownsHolding(req);
  const cb = req.body.cost_basis === "" || req.body.cost_basis == null ? null : req.body.cost_basis;
  const { rows } = await q(
    "UPDATE sales SET cost_basis=$3 WHERE holding_id=$1 AND id=$2 RETURNING *",
    [req.params.id, req.params.sid, cb]
  );
  if (!rows.length) return res.status(404).json({ error: "No such sale." });
  res.json(rows[0]);
}));

r.delete("/holdings/:id/sales/:sid", wrap(async (req, res) => {
  await ownsHolding(req);
  await q("DELETE FROM sales WHERE holding_id=$1 AND id=$2", [req.params.id, req.params.sid]);
  res.json({ ok: true });
}));

r.post("/holdings/:id/lots", wrap(async (req, res) => {
  await ownsHolding(req);
  const { qty, price, buy_date } = req.body;
  const { rows } = await q(
    "INSERT INTO lots (holding_id, qty, price, buy_date) VALUES ($1,$2,$3,$4) RETURNING *",
    [req.params.id, qty, price, buy_date]
  );
  await q("INSERT INTO price_points (holding_id, as_of, price, note) VALUES ($1,$2,$3,'purchase')",
    [req.params.id, buy_date, price]);
  res.json(rows[0]);
}));

/* -------------------------------- budgets ------------------------------ */

r.put("/budgets", wrap(async (req, res) => {
  const { category, amount } = req.body;
  if (!amount) await q("DELETE FROM budgets WHERE user_id=$1 AND category=$2", [uid(req), category]);
  else await q(
    `INSERT INTO budgets (user_id, category, amount) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, category) DO UPDATE SET amount=$3`,
    [uid(req), category, amount]
  );
  res.json({ ok: true });
}));

/* ------------------------------- memory -------------------------------- */

r.get("/memory", wrap(async (req, res) => {
  const { rows } = await q("SELECT * FROM merchant_memory WHERE user_id=$1 ORDER BY hits DESC", [uid(req)]);
  res.json(rows);
}));

r.post("/memory", wrap(async (req, res) => {
  const { pattern, category, subcategory, scope } = req.body;
  await q(
    `INSERT INTO merchant_memory (user_id, pattern, category, subcategory, scope, origin)
     VALUES ($1,$2,$3,$4,$5,'manual')
     ON CONFLICT (user_id, pattern) DO UPDATE SET category=$3, subcategory=$4, scope=$5, updated_at=now()`,
    [uid(req), normaliseMerchant(pattern) || pattern, category, subcategory || null, scope || "personal"]
  );
  res.json({ ok: true });
}));

r.delete("/memory/:id", wrap(async (req, res) => {
  await q("DELETE FROM merchant_memory WHERE user_id=$1 AND id=$2", [uid(req), req.params.id]);
  res.json({ ok: true });
}));

/* ------------------------------- export -------------------------------- */

r.get("/export", wrap(async (req, res) => {
  const u = uid(req);
  const tables = ["transactions", "accounts", "people", "holdings", "fixed_deposits", "assets", "budgets", "merchant_memory"];
  const dump = {};
  for (const t of tables) dump[t] = (await q(`SELECT * FROM ${t} WHERE user_id=$1`, [u])).rows;
  dump.lots = (await q("SELECT l.* FROM lots l JOIN holdings h ON h.id=l.holding_id WHERE h.user_id=$1", [u])).rows;
  dump.price_points = (await q("SELECT p.* FROM price_points p JOIN holdings h ON h.id=p.holding_id WHERE h.user_id=$1", [u])).rows;
  res.setHeader("Content-Disposition", `attachment; filename="khata-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(dump);
}));

export default r;
