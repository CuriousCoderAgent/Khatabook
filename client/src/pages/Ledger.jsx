import React, { useMemo, useState } from "react";
import { inr, dShort, mKey, today } from "../api.js";
import { Modal, Field, Empty, MonthBar, ScopeChip, useCats } from "../ui.jsx";

const SCOPES = ["personal", "household", "official"];

export default function Ledger({ tx, refData, month, setMonth, months, patchTx, bulkPatch, removeTx, addTx, say }) {
  const C = useCats();
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("all");
  const [fAcct, setFAcct] = useState("all");
  const [fDir, setFDir] = useState("all");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState([]);

  const rows = useMemo(() => tx.filter(t =>
    (month === "all" || mKey(t.date) === month) &&
    (fCat === "all" || t.cat === fCat) &&
    (fAcct === "all" || String(t.accountId) === fAcct) &&
    (fDir === "all" || t.dir === fDir) &&
    (!q || (t.desc || "").toLowerCase().includes(q.toLowerCase()) ||
      (t.sub || "").toLowerCase().includes(q.toLowerCase()) || String(t.amount).includes(q))
  ), [tx, month, fCat, fAcct, fDir, q]);

  const totalIn = rows.filter(t => t.dir === "in").reduce((a, t) => a + t.amount, 0);
  const totalOut = rows.filter(t => t.dir === "out").reduce((a, t) => a + t.amount, 0);
  const acctName = id => (refData.accounts.find(a => a.id === id) || {}).name || "—";

  return (
    <>
      <MonthBar month={month} setMonth={setMonth} months={months}
        right={<button className="btn" data-v="primary" onClick={() => setAdding(true)}>Add entry</button>} />

      <div className="row" style={{ marginBottom: 10 }}>
        <input className="in" style={{ maxWidth: 220 }} placeholder="Search payee, subcategory, amount"
          value={q} onChange={e => setQ(e.target.value)} />
        <select className="in" style={{ width: "auto" }} value={fCat} onChange={e => setFCat(e.target.value)}>
          <option value="all">All categories</option>
          {C.list.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select className="in" style={{ width: "auto" }} value={fAcct} onChange={e => setFAcct(e.target.value)}>
          <option value="all">All accounts</option>
          {refData.accounts.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
        </select>
        <select className="in" style={{ width: "auto" }} value={fDir} onChange={e => setFDir(e.target.value)}>
          <option value="all">In and out</option><option value="in">Money in</option><option value="out">Money out</option>
        </select>
        <span className="muted num" style={{ fontSize: 12.5 }}>
          {rows.length} entries · <span className="pos">{inr(totalIn)}</span> in · <span className="neg">{inr(totalOut)}</span> out
        </span>
      </div>

      {sel.length > 0 && (
        <div className="card" style={{ marginBottom: 10, padding: "8px 12px" }}>
          <div className="row">
            <b className="num">{sel.length} selected</b>
            <select className="in" style={{ width: "auto" }} defaultValue=""
              onChange={e => { if (e.target.value) { bulkPatch(sel, { cat: e.target.value }); setSel([]); } }}>
              <option value="">Set category…</option>
              {C.list.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select className="in" style={{ width: "auto" }} defaultValue=""
              onChange={e => { if (e.target.value) { bulkPatch(sel, { scope: e.target.value }); setSel([]); } }}>
              <option value="">Set scope…</option>
              {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn sm" onClick={() => { bulkPatch(sel, { reimb: "pending" }); setSel([]); }}>Mark reimbursable</button>
            <button className="btn sm" data-v="danger" onClick={() => {
              if (confirm(`Delete ${sel.length} entries?`)) { sel.forEach(removeTx); setSel([]); }
            }}>Delete</button>
            <button className="btn sm" onClick={() => setSel([])}>Clear</button>
          </div>
        </div>
      )}

      <div className="card scroll" style={{ padding: "8px 10px" }}>
        <table className="ledger">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>Date</th><th>Payee / narration</th><th>Category</th><th>Subcategory</th>
              <th>Scope</th><th>Account</th><th>Claim</th>
              <th className="r">Out</th><th className="r">In</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.id}>
                <td>
                  <input type="checkbox" checked={sel.includes(t.id)}
                    onChange={e => setSel(p => e.target.checked ? [...p, t.id] : p.filter(x => x !== t.id))} />
                </td>
                <td className="num faint" style={{ whiteSpace: "nowrap" }}>{dShort(t.date)}</td>
                <td>
                  <div style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{t.desc}</div>
                  {t.note ? <div className="faint" style={{ fontSize: 11.5 }}>{t.note}</div> : null}
                  {t.confidence != null && t.confidence < 0.5
                    ? <span className="chip" style={{ borderColor: "var(--gold)", color: "var(--gold)" }}>check this</span> : null}
                </td>
                <td>
                  <select className="in" style={{ padding: "2px 4px", fontSize: 12.5, width: 145, borderColor: C.color(t.cat) }}
                    value={t.cat} onChange={e => patchTx(t.id, { cat: e.target.value })}>
                    {C.forDir(t.dir).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </td>
                <td>
                  <input className="in" style={{ padding: "2px 5px", fontSize: 12.5, width: 120 }}
                    placeholder="—" defaultValue={t.sub || ""}
                    onBlur={e => e.target.value !== (t.sub || "") && patchTx(t.id, { sub: e.target.value })} />
                </td>
                <td>
                  <select className="in" style={{ padding: "2px 4px", fontSize: 12, width: 96 }}
                    value={t.scope || "personal"} onChange={e => patchTx(t.id, { scope: e.target.value })}>
                    {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="faint" style={{ fontSize: 12 }}>{acctName(t.accountId)}</td>
                <td>
                  {t.dir === "out" ? (
                    <button className="btn sm" data-on={t.reimb !== "none" ? "1" : "0"}
                      onClick={() => patchTx(t.id, { reimb: t.reimb !== "none" ? "none" : "pending" })}>
                      {t.reimb === "received" ? "paid" : t.reimb === "claimed" ? "filed" : t.reimb === "pending" ? "claim"
                        : ["dining", "delivery", "cabs", "travel"].includes(t.cat) ? "team?" : "—"}
                    </button>
                  ) : null}
                </td>
                <td className="r num neg">{t.dir === "out" ? inr(t.amount) : ""}</td>
                <td className="r num pos">{t.dir === "in" ? inr(t.amount) : ""}</td>
                <td><button className="btn sm" onClick={() => setEditing(t)}>Edit</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11}><Empty title="Nothing here">Change the filters, or add an entry.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      {(editing || adding) && (
        <TxForm
          ref2={refData} tx={editing}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={async v => {
            if (editing) patchTx(editing.id, v);
            else { try { await addTx({ ...v, source: "manual" }); } catch (e) { say(e.message); } }
            setEditing(null); setAdding(false);
          }}
          onDelete={editing ? () => { removeTx(editing.id); setEditing(null); } : null}
        />
      )}
    </>
  );
}

export function TxForm({ tx, ref2, onClose, onSave, onDelete }) {
  const C = useCats();
  const [v, setV] = useState(tx || {
    date: today(), desc: "", amount: "", dir: "out", cat: "misc", sub: "", scope: "personal",
    accountId: ref2.accounts[0] ? ref2.accounts[0].id : null, reimb: "none", personId: null, note: "",
  });
  const set = p => setV(x => ({ ...x, ...p }));

  return (
    <Modal title={tx ? "Edit entry" : "Add entry"} onClose={onClose}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Field label="Date"><input className="in" type="date" value={v.date} onChange={e => set({ date: e.target.value })} /></Field>
        <Field label="Amount"><input className="in" type="number" step="0.01" value={v.amount} onChange={e => set({ amount: e.target.value })} /></Field>
        <Field label="Direction">
          <select className="in" value={v.dir} onChange={e => {
            const dir = e.target.value;
            const keep = C.byKey[v.cat] && C.byKey[v.cat].dir === dir;
            set({ dir, cat: keep ? v.cat : dir === "in" ? "other_in" : "misc" });
          }}>
            <option value="out">Money out</option><option value="in">Money in</option>
          </select>
        </Field>
        <Field label="Category">
          <select className="in" value={v.cat} onChange={e => set({ cat: e.target.value })}>
            {C.forDir(v.dir).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Payee / narration">
          <input className="in" value={v.desc} onChange={e => set({ desc: e.target.value })} placeholder="Swiggy, Uber, Mr Sharma…" />
        </Field>
        <Field label="Subcategory">
          <input className="in" value={v.sub || ""} onChange={e => set({ sub: e.target.value })} placeholder="Instamart, fuel, school fees" />
        </Field>
        <Field label="Account">
          <select className="in" value={v.accountId || ""} onChange={e => set({ accountId: Number(e.target.value) || null })}>
            <option value="">—</option>
            {ref2.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Scope">
          <select className="in" value={v.scope} onChange={e => set({ scope: e.target.value })}>
            {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {v.dir === "out" && (
          <Field label="Reimbursement">
            <select className="in" value={v.reimb || "none"} onChange={e => set({ reimb: e.target.value })}>
              <option value="none">Mine to bear</option>
              <option value="pending">Reimbursable — not claimed</option>
              <option value="claimed">Claim filed</option>
              <option value="received">Reimbursed</option>
            </select>
          </Field>
        )}
        {["gifts", "family"].includes(v.cat) && (
          <Field label={v.cat === "gifts" ? "Gift for" : "Transferred to"}>
            <select className="in" value={v.personId || ""} onChange={e => set({ personId: Number(e.target.value) || null })}>
              <option value="">Not set</option>
              {ref2.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        {v.cat === "home_loan" && (
          <Field label="Of which principal">
            <input className="in" type="number" step="0.01" value={v.principal ?? ""}
              onChange={e => set({ principal: e.target.value })}
              placeholder="from the amortisation schedule" />
          </Field>
        )}
      </div>
      {v.cat === "home_loan" && (
        <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
          {v.principal !== "" && v.principal != null && isFinite(parseFloat(v.principal))
            ? <>{inr(parseFloat(v.principal))} of this pays the loan down and counts as investment;{" "}
              {inr(Math.max(0, (parseFloat(v.amount) || 0) - parseFloat(v.principal)))} is interest and counts as spending.</>
            : <>Leave this blank and the whole EMI counts as investment. Early in a loan most of an
              EMI is interest, so that reads higher than what you actually own — your bank's
              amortisation schedule has the month's split.</>}
        </p>
      )}
      <div style={{ marginTop: 10 }}>
        <Field label="Note">
          <input className="in" value={v.note || ""} onChange={e => set({ note: e.target.value })}
            placeholder="Team dinner — 6 people, Q2 close" />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 16, justifyContent: "space-between" }}>
        <div>{onDelete && <button className="btn" data-v="danger" onClick={() => confirm("Delete this entry?") && onDelete()}>Delete</button>}</div>
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" data-v="primary" onClick={() => {
            const amt = parseFloat(v.amount);
            if (!v.date || !isFinite(amt) || amt <= 0) return alert("A date and an amount above zero are needed.");
            onSave({ ...v, amount: Math.abs(amt), desc: v.desc || "(no narration)" });
          }}>{tx ? "Save changes" : "Add to ledger"}</button>
        </div>
      </div>
    </Modal>
  );
}
