import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area,
} from "recharts";
import { inr, compact, mKey, mShort, monthRange, today, pct } from "../api.js";
import { Stat, Empty, useCats, tip, axis } from "../ui.jsx";

export default function Trends({ tx }) {
  const C = useCats();
  const [from, setFrom] = useState("2026-01");
  const [view, setView] = useState("categories");
  // Spending and investing both leave the account and neither is the other, so
  // they get the same month-by-month treatment rather than one being buried.
  const [lens, setLens] = useState("spend");
  const [picked, setPicked] = useState([]);

  const months = useMemo(() => {
    const last = tx.length ? tx.map(t => mKey(t.date)).sort().slice(-1)[0] : mKey(today());
    const end = last < mKey(today()) ? mKey(today()) : last;
    return from <= end ? monthRange(from, end) : [];
  }, [tx, from]);

  const grid = useMemo(() => {
    const g = {};
    tx.forEach(t => {
      const m = mKey(t.date);
      if (!months.includes(m)) return;
      const key = view === "subcategories" ? `${t.cat}::${t.sub || "unlabelled"}` : t.cat;
      // A split home loan EMI contributes to both lenses — principal to
      // investing, interest to spending — so the row is filtered on what it
      // actually contributes rather than on its category.
      const v = lens === "invest" ? C.investPart(t) : C.spendPart(t);
      if (!v) return;
      g[key] = g[key] || {};
      g[key][m] = (g[key][m] || 0) + v;
    });
    return Object.entries(g)
      .map(([key, byMonth]) => {
        const total = Object.values(byMonth).reduce((a, b) => a + b, 0);
        const cat = key.split("::")[0];
        const label = view === "subcategories" ? `${C.label(cat)} · ${key.split("::")[1]}` : C.label(cat);
        return { key, cat, label, byMonth, total, avg: total / Math.max(1, months.length) };
      })
      .sort((a, b) => b.total - a.total);
  }, [tx, months, view, lens]);

  const summary = useMemo(() => months.map(m => {
    const r = tx.filter(t => mKey(t.date) === m);
    const income = C.sum(r.filter(t => C.isIncome(t.cat)));
    const spent = C.spent(r);
    const invested = C.invested(r);
    return { m: mShort(m), key: m, Income: income, Spent: spent, Invested: invested, Saved: income - spent - invested };
  }), [tx, months]);

  const lineData = useMemo(() => months.map(m => {
    const row = { m: mShort(m) };
    (picked.length ? picked : grid.slice(0, 5).map(g => g.key)).forEach(k => {
      const g = grid.find(x => x.key === k);
      if (g) row[g.label] = g.byMonth[m] || 0;
    });
    return row;
  }), [months, grid, picked]);

  const lineKeys = (picked.length ? picked : grid.slice(0, 5).map(g => g.key))
    .map(k => grid.find(x => x.key === k)).filter(Boolean);

  const emiUnsplit = useMemo(
    () => C.emiUnsplit(tx.filter(t => months.includes(mKey(t.date)))), [tx, months]);
  const totalSpent = summary.reduce((a, s) => a + s.Spent, 0);
  const totalIncome = summary.reduce((a, s) => a + s.Income, 0);
  const avgSpend = summary.length ? totalSpent / summary.length : 0;
  const totalInvested = summary.reduce((a, s) => a + s.Invested, 0);
  const lensTotal = lens === "invest" ? totalInvested : totalSpent;
  const lensAvg = summary.length ? lensTotal / summary.length : 0;
  const last = summary[summary.length - 1];
  const prev = summary[summary.length - 2];
  const mom = prev && prev.Spent ? ((last.Spent - prev.Spent) / prev.Spent) * 100 : 0;

  if (!tx.length) return <Empty title="Nothing to trend yet">Import a few months and this page becomes the point of the whole app.</Empty>;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <span className="eyebrow">Month on month</span>
          <h2 className="h2" style={{ margin: "2px 0 0" }}>{months.length} months, side by side</h2>
        </div>
        <div className="row">
          <label className="f" style={{ margin: 0 }}>
            <span>Start from</span>
            <input className="in" type="month" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 150 }} />
          </label>
          <button className="btn" data-on={view === "categories" ? "1" : "0"} onClick={() => { setView("categories"); setPicked([]); }}>Categories</button>
          <button className="btn" data-on={view === "subcategories" ? "1" : "0"} onClick={() => { setView("subcategories"); setPicked([]); }}>Subcategories</button>
          <span style={{ width: 10 }} />
          <button className="btn" data-on={lens === "spend" ? "1" : "0"} onClick={() => { setLens("spend"); setPicked([]); }}>Spending</button>
          <button className="btn" data-on={lens === "invest" ? "1" : "0"} onClick={() => { setLens("invest"); setPicked([]); }}>Investing</button>
        </div>
        <div className="row">
          {lens === "invest" && (
            <span className="faint" style={{ fontSize: 12 }}>
              Money into brokers, funds and the house, net of anything paid back out. Switch to
              subcategories to split equity from SIPs and PPF.
              {emiUnsplit && " Home loan EMIs count in full, interest and all. Put a principal on"
                + " a row if you ever want its interest counted as spending instead."}
            </span>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginBottom: 14 }}>
        <Stat k="Total in" v={compact(totalIncome)} s={`over ${months.length} months`} tone="in" />
        {/* Net, because a broker payout is an `invest` row going the other way.
            A month where more came back out than went in reads negative, which
            is the truth about that month and not an error. */}
        <Stat k={lens === "invest" ? "Net invested" : "Total spent"} v={compact(lensTotal)}
          s={lens === "invest"
            ? (lensTotal < 0 ? "payouts exceeded what went in" : `${compact(lensAvg)} a month on average`)
            : `${compact(lensAvg)} a month on average`}
          tone={lens === "invest" ? "gold" : "out"} />
        <Stat k="Latest month" v={compact(last ? (lens === "invest" ? last.Invested : last.Spent) : 0)}
          s={prev ? `${pct(mom)} vs previous month` : "no comparison yet"}
          tone={lens === "invest" ? "gold" : mom > 0 ? "out" : "in"} />
        <Stat k="Kept" v={compact(totalIncome - totalSpent)} s={totalIncome ? `${(((totalIncome - totalSpent) / totalIncome) * 100).toFixed(0)}% of income` : ""} tone="gold" />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 className="h3">Income against spending</h3>
        <div style={{ height: 250, marginTop: 10 }}>
          <ResponsiveContainer>
            <AreaChart data={summary} margin={{ left: -6, right: 6 }}>
              <CartesianGrid stroke="#DCE6D8" vertical={false} />
              <XAxis dataKey="m" {...axis} />
              <YAxis tickFormatter={compact} width={54} {...axis} />
              <Tooltip formatter={v => inr(v)} {...tip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Income" stroke="#1C6A49" fill="#1C6A49" fillOpacity={0.12} strokeWidth={2} />
              <Area type="monotone" dataKey="Spent" stroke="#A6342A" fill="#A6342A" fillOpacity={0.12} strokeWidth={2} />
              <Line type="monotone" dataKey="Saved" stroke="#B0851E" strokeWidth={1.6} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {lineKeys.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 className="h3">Selected lines</h3>
            <span className="faint" style={{ fontSize: 12 }}>
              {picked.length >= 6 ? "Six at a time — untick one to swap it out" : "Tick rows in the table below to compare them here"}
            </span>
          </div>
          <div style={{ height: 240, marginTop: 8 }}>
            <ResponsiveContainer>
              <LineChart data={lineData} margin={{ left: -6, right: 6 }}>
                <CartesianGrid stroke="#DCE6D8" vertical={false} />
                <XAxis dataKey="m" {...axis} />
                <YAxis tickFormatter={compact} width={54} {...axis} />
                <Tooltip formatter={v => inr(v)} {...tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {/* Colour repeats past the sixth category, so the dash pattern
                    is what keeps two lines of the same hue apart. It also covers
                    the colour-blind case, where hue alone measures too close. */}
                {lineKeys.map(g => (
                  <Line key={g.key} type="monotone" dataKey={g.label} stroke={C.color(g.cat)}
                    strokeWidth={2} strokeDasharray={C.dash(g.cat)} dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card scroll" style={{ padding: "8px 10px" }}>
        <table className="ledger heat">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>{view === "subcategories" ? "Category · subcategory" : "Category"}</th>
              {months.map(m => <th key={m} className="r">{mShort(m)}</th>)}
              <th className="r">Total</th>
              <th className="r">Avg</th>
            </tr>
          </thead>
          <tbody>
            {grid.map(g => {
              const max = Math.max(...months.map(m => g.byMonth[m] || 0), 1);
              return (
                <tr key={g.key}>
                  <td>
                    <input type="checkbox" checked={picked.includes(g.key)}
                      onChange={e => setPicked(p => e.target.checked ? [...p, g.key].slice(0, 6) : p.filter(x => x !== g.key))} />
                  </td>
                  <td>
                    {/* Swatch shows the line's dash as well as its colour, so the
                        table reads the same way the chart does. */}
                    <svg width="18" height="8" style={{ marginRight: 7, verticalAlign: "middle" }} aria-hidden="true">
                      <line x1="0" y1="4" x2="18" y2="4" stroke={C.color(g.cat)}
                        strokeWidth="2.5" strokeDasharray={C.dash(g.cat)} />
                    </svg>
                    {g.label}
                  </td>
                  {months.map(m => {
                    const v = g.byMonth[m] || 0;
                    const alpha = v ? 0.08 + 0.5 * (v / max) : 0;
                    return (
                      <td key={m} className="cell r" style={{ background: v ? `rgba(166,52,42,${alpha})` : undefined }}>
                        {v ? compact(v) : <span className="faint">·</span>}
                      </td>
                    );
                  })}
                  <td className="r num"><b>{compact(g.total)}</b></td>
                  <td className="r num faint">{compact(g.avg)}</td>
                </tr>
              );
            })}
            <tr>
              {/* Totals follow whichever lens the table is showing, or the row
                  would sum spending under a list of investments. */}
              <td></td><td><b>{lens === "invest" ? "All investing" : "All spending"}</b></td>
              {months.map(m => {
                const s = summary.find(x => x.key === m);
                const v = s ? (lens === "invest" ? s.Invested : s.Spent) : 0;
                return <td key={m} className="cell r"><b>{v ? compact(v) : "·"}</b></td>;
              })}
              <td className="r num"><b>{compact(lensTotal)}</b></td>
              <td className="r num faint">{compact(lensAvg)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
