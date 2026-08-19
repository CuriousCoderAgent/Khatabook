import React, { useState } from "react";
import { api, inr } from "../api.js";
import { Field, useCats } from "../ui.jsx";

export default function Settings({ tx, refData, refresh, say, user }) {
  const C = useCats();
  const [acct, setAcct] = useState({ name: "", kind: "bank" });
  const [pwEdit, setPwEdit] = useState({}); // { [accountId]: draft password }
  const [mem, setMem] = useState({ pattern: "", category: "misc", subcategory: "", scope: "personal" });

  const exportCsv = () => {
    const head = "date,description,category,subcategory,scope,direction,amount,account,reimbursement,note\n";
    const acctName = id => (refData.accounts.find(a => a.id === id) || {}).name || "";
    const body = tx.map(t => [
      t.date, `"${(t.desc || "").replace(/"/g, "'")}"`, t.cat, t.sub || "", t.scope,
      t.dir, t.amount, acctName(t.accountId), t.reimb, `"${(t.note || "").replace(/"/g, "'")}"`,
    ].join(",")).join("\n");
    const blob = new Blob([head + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `khata-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <span className="eyebrow">Settings</span>
      <h2 className="h2" style={{ margin: "4px 0 12px" }}>How the ledger behaves</h2>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        <div className="card">
          <h3 className="h3">Accounts</h3>
          <p className="muted" style={{ fontSize: 13 }}>The channels your money moves through.</p>
          {refData.accounts.map(a => (
            <div key={a.id} style={{ padding: "4px 0", borderBottom: "1px solid var(--rule2)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  {a.name} <span className="chip">{a.kind}</span>
                  {a.last4 ? <span className="chip" style={{ marginLeft: 4 }}>··{a.last4}</span> : null}
                </span>
                <button className="btn sm" data-v="danger" onClick={async () => {
                  if (!confirm(`Remove ${a.name}? Entries keep their history.`)) return;
                  try { await api.del(`/accounts/${a.id}`); await refresh(); } catch (e) { say(e.message); }
                }}>×</button>
              </div>
              <div className="row" style={{ marginTop: 4, flexWrap: "nowrap" }}>
                <input className="in" inputMode="numeric" maxLength={4} style={{ fontSize: 12, maxWidth: 150 }}
                  placeholder="Last 4 digits" defaultValue={a.last4 || ""}
                  onBlur={async e => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                    if (v === (a.last4 || "")) return;
                    try { await api.patch(`/accounts/${a.id}`, { last4: v || null }); await refresh(); say(v ? "Saved" : "Cleared"); }
                    catch (er) { say(er.message); }
                  }} />
                <span className="faint" style={{ fontSize: 11.5 }}>
                  so pasted alerts file themselves here
                </span>
              </div>
              <div className="row" style={{ marginTop: 4, flexWrap: "nowrap" }}>
                <input className="in" type="password" style={{ fontSize: 12 }}
                  placeholder={a.hasPdfPassword ? "•••• saved — enter to change" : "PDF statement password"}
                  value={pwEdit[a.id] || ""} onChange={e => setPwEdit({ ...pwEdit, [a.id]: e.target.value })} />
                <button className="btn sm" disabled={!pwEdit[a.id]} onClick={async () => {
                  try {
                    await api.patch(`/accounts/${a.id}/pdf-password`, { password: pwEdit[a.id] });
                    setPwEdit({ ...pwEdit, [a.id]: "" }); await refresh(); say("Password saved");
                  } catch (e) { say(e.message); }
                }}>Save</button>
                {a.hasPdfPassword && <button className="btn sm" data-v="danger" onClick={async () => {
                  try { await api.patch(`/accounts/${a.id}/pdf-password`, { password: "" }); await refresh(); say("Password cleared"); }
                  catch (e) { say(e.message); }
                }}>Clear</button>}
              </div>
            </div>
          ))}
          <div className="row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
            <input className="in" placeholder="Account name" value={acct.name} onChange={e => setAcct({ ...acct, name: e.target.value })} />
            <select className="in" style={{ width: 110 }} value={acct.kind} onChange={e => setAcct({ ...acct, kind: e.target.value })}>
              <option value="bank">Bank</option><option value="card">Card</option>
              <option value="cash">Cash</option><option value="wallet">Wallet</option>
            </select>
            <button className="btn" onClick={async () => {
              if (!acct.name.trim()) return;
              try { await api.post("/accounts", acct); setAcct({ name: "", kind: "bank" }); await refresh(); }
              catch (e) { say(e.message); }
            }}>Add</button>
          </div>

          <hr className="hr" />
          <h3 className="h3">People</h3>
          {refData.people.map(p => (
            <div key={p.id} className="row" style={{ padding: "3px 0", flexWrap: "nowrap" }}>
              <input className="in" defaultValue={p.name}
                onBlur={async e => {
                  if (e.target.value && e.target.value !== p.name) {
                    try { await api.patch(`/people/${p.id}`, { name: e.target.value }); await refresh(); }
                    catch (er) { say(er.message); }
                  }
                }} />
              <span className="faint" style={{ fontSize: 12, minWidth: 60 }}>{p.relation || ""}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 className="h3">What the classifier has learned</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Every time you change a category, the payee is remembered. Next time it's matched instantly,
            without asking Claude. {refData.aiEnabled ? "" : "AI sorting is off — no ANTHROPIC_API_KEY set."}
          </p>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {(refData.memory || []).map(m => (
              <div key={m.id} className="row" style={{ justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--rule2)" }}>
                <span className="num" style={{ fontSize: 12.5 }}>{m.pattern}</span>
                <div className="row" style={{ gap: 5 }}>
                  <span className="chip" style={{ borderColor: C.color(m.category), color: C.color(m.category) }}>
                    {C.label(m.category)}{m.subcategory ? ` · ${m.subcategory}` : ""}
                  </span>
                  <span className="faint num" style={{ fontSize: 11 }}>{m.hits}×</span>
                  <button className="btn sm" data-v="danger" onClick={async () => {
                    try { await api.del(`/memory/${m.id}`); await refresh(); } catch (e) { say(e.message); }
                  }}>×</button>
                </div>
              </div>
            ))}
            {!(refData.memory || []).length && <span className="faint" style={{ fontSize: 12.5 }}>Nothing learned yet.</span>}
          </div>
          <hr className="hr" />
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Field label="Payee text"><input className="in" value={mem.pattern} onChange={e => setMem({ ...mem, pattern: e.target.value })} placeholder="blue tokai" /></Field>
            <Field label="Category">
              <select className="in" value={mem.category} onChange={e => setMem({ ...mem, category: e.target.value })}>
                {C.list.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Subcategory"><input className="in" value={mem.subcategory} onChange={e => setMem({ ...mem, subcategory: e.target.value })} placeholder="Coffee" /></Field>
            <Field label="Scope">
              <select className="in" value={mem.scope} onChange={e => setMem({ ...mem, scope: e.target.value })}>
                {["personal", "household", "official"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <button className="btn" style={{ marginTop: 10 }} onClick={async () => {
            if (!mem.pattern.trim()) return;
            try { await api.post("/memory", mem); setMem({ ...mem, pattern: "", subcategory: "" }); await refresh(); say("Rule saved"); }
            catch (e) { say(e.message); }
          }}>Teach this rule</button>
        </div>

        <div className="card">
          <h3 className="h3">Your data</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Everything lives in your own Postgres database. Take a backup before you experiment.
          </p>
          <div className="row">
            <a className="btn" href="/api/export" style={{ textDecoration: "none" }}>Download full backup</a>
            <button className="btn" onClick={exportCsv}>Export ledger as CSV</button>
          </div>
          <hr className="hr" />
          <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
            Signed in as {user.email}<br />
            {tx.length} entries · {(refData.holdings || []).length} holdings · {(refData.fds || []).length} deposits ·
            {" "}{(refData.memory || []).length} learned rules<br />
            Classifier: {refData.aiEnabled ? "Claude connected" : "keyword rules only"}
          </p>
          {/* The sidebar carries a sign-out too, but the sidebar collapses to a
              row of tabs under 900px and takes its footer with it, so on a phone
              this is the only way out. */}
          <button className="btn" style={{ marginTop: 10 }} onClick={async () => {
            try { await api.post("/auth/logout"); } catch { /* clear the cookie regardless */ }
            location.reload();
          }}>Sign out</button>
        </div>
      </div>
    </>
  );
}
