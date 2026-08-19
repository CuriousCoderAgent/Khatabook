import React from "react";
import { api, inr, mKey, mName, today, N } from "../api.js";
import { Stat, MonthBar, useCats } from "../ui.jsx";

export default function Budgets({ tx, refData, month, setMonth, months, refresh, say }) {
  const C = useCats();
  const m = month === "all" ? (months[0] || mKey(today())) : month;
  const rows = tx.filter(t => mKey(t.date) === m && C.isSpend(t.cat));

  const spentBy = {};
  rows.forEach(t => { spentBy[t.cat] = (spentBy[t.cat] || 0) + C.net(t); });

  const cats = C.list.filter(c => C.isSpend(c.key));
  const budgets = refData.budgets || {};
  const totalBudget = cats.reduce((a, c) => a + N(budgets[c.key]), 0);
  const totalSpent = Object.values(spentBy).reduce((a, b) => a + b, 0);

  const avg3 = key => {
    const keys = months.filter(k => k <= m).slice(0, 3);
    if (!keys.length) return 0;
    return C.sum(tx.filter(t => keys.includes(mKey(t.date)) && t.cat === key)) / keys.length;
  };

  const save = async (category, amount) => {
    try { await api.put("/budgets", { category, amount }); await refresh(); }
    catch (e) { say(e.message); }
  };

  return (
    <>
      <MonthBar month={month} setMonth={setMonth} months={months}
        right={<button className="btn" onClick={async () => {
          for (const c of cats) {
            const a = avg3(c.key);
            if (a > 0) await api.put("/budgets", { category: c.key, amount: Math.ceil(a / 500) * 500 });
          }
          await refresh(); say("Budgets set from your 3-month averages");
        }}>Set from 3-month average</button>} />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginBottom: 14 }}>
        <Stat k="Budgeted" v={inr(totalBudget)} s={mName(m)} />
        <Stat k="Spent" v={inr(totalSpent)} tone={totalBudget && totalSpent > totalBudget ? "out" : "in"} />
        <Stat k="Room left" v={inr(Math.max(0, totalBudget - totalSpent))}
          s={totalBudget ? `${((totalSpent / totalBudget) * 100).toFixed(0)}% used` : "no budgets set"} tone="gold" />
      </div>

      <div className="card scroll" style={{ padding: "8px 10px" }}>
        <table className="ledger">
          <thead><tr><th>Category</th><th style={{ width: 130 }}>Monthly budget</th><th className="r">Spent</th>
            <th style={{ minWidth: 150 }}>Progress</th><th className="r">Left</th><th className="r">3-mo avg</th></tr></thead>
          <tbody>
            {cats.map(c => {
              const b = N(budgets[c.key]), s = N(spentBy[c.key]);
              const p = b ? Math.min(100, (s / b) * 100) : 0;
              const over = b && s > b;
              return (
                <tr key={c.key}>
                  <td><span className="dot" style={{ background: c.color, marginRight: 7 }} />{c.label}</td>
                  <td>
                    <input className="in num" type="number" placeholder="—" style={{ padding: "2px 5px", width: 112 }}
                      defaultValue={budgets[c.key] || ""}
                      onBlur={e => {
                        const v = parseFloat(e.target.value) || 0;
                        if (v !== N(budgets[c.key])) save(c.key, v);
                      }} />
                  </td>
                  <td className="r num">{s ? inr(s) : <span className="faint">—</span>}</td>
                  <td>
                    {b ? <div className="bar-track"><div className="bar-fill" style={{ width: p + "%", background: over ? "var(--out)" : c.color }} /></div>
                      : <span className="faint" style={{ fontSize: 12 }}>no budget</span>}
                  </td>
                  <td className={"r num " + (over ? "neg" : "")}>{b ? (over ? "over " + inr(s - b) : inr(b - s)) : ""}</td>
                  <td className="r num faint">{avg3(c.key) ? inr(avg3(c.key)) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
