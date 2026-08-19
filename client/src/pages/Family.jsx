import React, { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { api, inr, compact, dShort, mKey, mShort } from "../api.js";
import { Empty, useCats, tip, axis } from "../ui.jsx";

export default function Family({ tx, refData, patchTx, refresh, say }) {
  const C = useCats();
  const [name, setName] = useState("");
  const people = refData.people || [];
  const rows = tx.filter(t => ["gifts", "family"].includes(t.cat));
  const unassigned = rows.filter(t => !t.personId);

  const byPerson = people.map(p => {
    const r = rows.filter(t => t.personId === p.id);
    return {
      ...p, rows: r,
      gifts: r.filter(t => t.cat === "gifts").reduce((a, t) => a + t.amount, 0),
      transfers: r.filter(t => t.cat === "family").reduce((a, t) => a + t.amount, 0),
      total: r.reduce((a, t) => a + t.amount, 0),
    };
  }).sort((a, b) => b.total - a.total);

  const monthly = useMemo(() => {
    const months = Array.from(new Set(rows.map(t => mKey(t.date)))).sort();
    return months.map(m => {
      const row = { m: mShort(m) };
      people.forEach(p => {
        row[p.name] = rows.filter(t => mKey(t.date) === m && t.personId === p.id).reduce((a, t) => a + t.amount, 0);
      });
      return row;
    });
  }, [tx, people]);

  const palette = ["#B0851E", "#9A6A3A", "#2E8B7A", "#A8497A", "#2F6480", "#7A8B3A"];

  const addPerson = async () => {
    if (!name.trim()) return;
    try { await api.post("/people", { name: name.trim() }); setName(""); await refresh(); }
    catch (e) { say(e.message); }
  };

  return (
    <>
      <span className="eyebrow">People</span>
      <h2 className="h2" style={{ margin: "4px 0 12px" }}>Gifts given and money sent home</h2>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginBottom: 14 }}>
        {byPerson.map(p => (
          <div key={p.id} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <b className="h3" style={{ fontSize: 14 }}>{p.name}</b>
                {p.relation ? <div className="faint" style={{ fontSize: 11 }}>{p.relation}</div> : null}
              </div>
              <button className="btn sm" data-v="danger" title="Remove"
                onClick={async () => {
                  if (!confirm(`Remove ${p.name}? Their entries stay in the ledger.`)) return;
                  try { await api.del(`/people/${p.id}`); await refresh(); } catch (e) { say(e.message); }
                }}>×</button>
            </div>
            <div className="num" style={{ fontSize: 20, marginTop: 4 }}>{inr(p.total)}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {inr(p.gifts)} gifts · {inr(p.transfers)} transferred · {p.rows.length} entries
            </div>
          </div>
        ))}
        <div className="card">
          <span className="eyebrow">Add someone</span>
          <div className="row" style={{ marginTop: 6, flexWrap: "nowrap" }}>
            <input className="in" placeholder="Name" value={name}
              onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPerson()} />
            <button className="btn" onClick={addPerson}>Add</button>
          </div>
        </div>
      </div>

      {monthly.length > 1 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 className="h3">Month by month, by person</h3>
          <div style={{ height: 230, marginTop: 10 }}>
            <ResponsiveContainer>
              <BarChart data={monthly} margin={{ left: -6 }}>
                <CartesianGrid stroke="#DCE6D8" vertical={false} />
                <XAxis dataKey="m" {...axis} />
                <YAxis tickFormatter={compact} width={54} {...axis} />
                <Tooltip formatter={v => inr(v)} {...tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {people.map((p, i) => <Bar key={p.id} dataKey={p.name} stackId="a" fill={palette[i % palette.length]} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card scroll" style={{ padding: "8px 10px" }}>
        <div className="row" style={{ justifyContent: "space-between", padding: "4px 2px 8px" }}>
          <h3 className="h3">Gift and transfer entries</h3>
          {unassigned.length > 0 && (
            <span className="chip" style={{ borderColor: "var(--out)", color: "var(--out)" }}>
              {unassigned.length} not assigned to anyone
            </span>
          )}
        </div>
        <table className="ledger">
          <thead><tr><th>Date</th><th>Payee</th><th>Kind</th><th>For</th><th>Occasion</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.id}>
                <td className="num faint">{dShort(t.date)}</td>
                <td>{t.desc}</td>
                <td><span className="chip" style={{ borderColor: C.color(t.cat), color: C.color(t.cat) }}>{C.label(t.cat)}</span></td>
                <td>
                  <select className="in" style={{ padding: "2px 4px", fontSize: 12.5, width: 118, borderColor: t.personId ? "var(--rule)" : "var(--out)" }}
                    value={t.personId || ""} onChange={e => patchTx(t.id, { personId: Number(e.target.value) || null })}>
                    <option value="">Assign…</option>
                    {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td>
                  <input className="in" style={{ padding: "2px 5px", fontSize: 12.5, minWidth: 150 }}
                    placeholder="Birthday, Diwali…" defaultValue={t.note || ""}
                    onBlur={e => e.target.value !== (t.note || "") && patchTx(t.id, { note: e.target.value })} />
                </td>
                <td className="r num neg">{inr(t.amount)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6}><Empty title="No gifts recorded">
              Set any entry's category to Gifts or Family transfer and it appears here.
            </Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
