import { pool } from "../db.js";

/** Shared with server/routes/api.js and server/routes/devices.js — one insert
 *  shape for a ledger row, whether it came from a manual add, a statement
 *  import, or the device SMS listener. */
export const INSERT_TX = `
  INSERT INTO transactions
    (user_id, txn_date, description, amount, direction, category, subcategory, scope,
     account_id, reimb, person_id, note, source, batch_id, fingerprint, ai_confidence, ai_reason,
     principal)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
  RETURNING *`;

/** Principal is only meaningful on a home loan EMI, and only up to the EMI. */
export const principalOf = t => {
  if (t.cat !== "home_loan" || t.principal == null || t.principal === "") return null;
  const p = Math.abs(Number(t.principal));
  return isFinite(p) ? Math.min(p, Math.abs(Number(t.amount))) : null;
};

export const fingerprint = t =>
  `${t.date}|${Math.round(Number(t.amount) * 100)}|${String(t.desc || "").toLowerCase().replace(/\s+/g, "").slice(0, 24)}`;

/**
 * Insert a batch of already-classified rows inside one transaction, recording
 * an import_batches row so the source is auditable and undoable like any
 * other import. Skips rows whose fingerprint already exists for this user —
 * callers that need the user to choose (the review screen) check fingerprints
 * themselves beforehand and never hit that path; callers with no human in the
 * loop (the device SMS listener) rely on it so a message a bank likes to
 * repeat can't double-file itself.
 */
export async function insertBatch(userId, rows, batchMeta) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let batchId = null;
    if (batchMeta) {
      const dates = rows.map(t => t.date).sort();
      const br = await client.query(
        `INSERT INTO import_batches (user_id, account_id, filename, row_count, imported, period_from, period_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [userId, batchMeta.accountId || null, batchMeta.filename || null,
         batchMeta.rowCount || rows.length, rows.length, dates[0], dates[dates.length - 1]]
      );
      batchId = br.rows[0].id;
    }
    let inserted = 0, skipped = 0;
    for (const t of rows) {
      const fp = fingerprint(t);
      const dupe = await client.query(
        "SELECT id FROM transactions WHERE user_id=$1 AND fingerprint=$2", [userId, fp]
      );
      if (dupe.rowCount) { skipped++; continue; }
      await client.query(INSERT_TX, [
        userId, t.date, t.desc || "", Math.abs(Number(t.amount)), t.dir, t.cat || "misc",
        t.sub || null, t.scope || "personal", t.accountId || null, t.reimb || "none",
        t.personId || null, t.note || null, t.source || "import", batchId,
        fp, t.confidence || null, t.reason || null, principalOf(t),
      ]);
      inserted++;
    }
    await client.query("COMMIT");
    return { inserted, skipped, batchId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
