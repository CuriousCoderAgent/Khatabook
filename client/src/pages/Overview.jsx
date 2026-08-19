import React, { useMemo } from "react";
import {
  ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { inr, compact, mKey, mName, dShort, netWorth } from "../api.js";
import { Stat, Empty, MonthBar, useCats, tip, axis } from "../ui.jsx";

export default function Overview({ tx, refData, month, setMonth, months, owed, setTab }) {
  const C = useCats();
  const rows = tx.filter(t => month === "all" || mKey(t.date) === month);

  const salary = C.sum(rows.filter(t => t.cat === "salary"));
  const reimbIn = C.sum(rows.filter(t => t.cat === "reimb_in"));
  const otherIn = C.sum(rows.filter(t => C.isIncome(t.cat) && !["salary", "reimb_in"].includes(t.cat)));
  const income = salary + reimbIn + otherIn;
  // Every row that costs something, which now includes the interest half of a
  // home loan EMI even though the EMI itself files under investments.
  const spendRows = rows.filter(t => C.spendPart(t) !== 0);
  const spent = C.spent(rows);
  const invested = C.invested(rows);
  const emiUnsplit = C.emiUnsplit(rows);
  const net = income - spent - invested;
  const rate = income > 0 ? ((income - spent) / income) * 100 : 0;
  const claimable = C.sum(spendRows.filter(t => ["pending", "claimed"].includes(t.reimb)));

  const byCat = useMemo(() => {
    const m = {};
    spendRows.forEach(t => { m[t.cat] = (m[t.cat] || 0) + C.spendPart(t); });
    return Object.entries(m).map(([id, v]) => ({ id, name: C.label(id), value: v, c: C.color(id) }))
      .sort((a, b) => b.value - a.value);
  }, [tx, month, refData]);

  // Past about seven classes adjacent colours blur, so the tail folds into one
  // neutral row rather than growing the palette.
  const topCats = useMemo(() => {
    const head = byCat.slice(0, 7);
    const tail = byCat.slice(7);
    if (!tail.length) return head;
    const rest = tail.reduce((a, d) => a + d.value, 0);
    return rest > 0
      ? [...head, { id: "__other", name: `Everything else (${tail.length})`, value: rest, c: "var(--ink3)" }]
      : head;
  }, [byCat]);
  const barMax = topCats.length ? Math.max(...topCats.map(d => d.value)) : 0;

  // The same breakdown as spending, for the other half of where money goes.
  // Grouped by subcategory rather than category, because `invest` is one key
  // covering the broker, the SIP and the gold — the subcategory is the answer.
  const byInvest = useMemo(() => {
    const m = {};
    rows.forEach(t => {
      const v = C.investPart(t);
      if (!v) return;
      const k = t.cat === "home_loan" ? C.label("home_loan") : (t.sub || C.label(t.cat));
      m[k] = (m[k] || 0) + v;
    });
    return Object.entries(m).map(([name, value]) => ({ name, value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [tx, month, refData]);
  // Sized on magnitude, so a large payout gets a full bar like a large buy.
  const investMax = byInvest.length ? Math.max(...byInvest.map(d => Math.abs(d.value))) : 0;

  const byScope = useMemo(() => {
    const m = { personal: 0, household: 0, official: 0 };
    spendRows.forEach(t => { m[t.scope || "personal"] += C.spendPart(t); });
    return m;
  }, [tx, month]);

  const trend = useMemo(() => {
    const keys = Array.from(new Set(tx.map(t => mKey(t.date)))).sort().slice(-8);
    return keys.map(k => {
      const r = tx.filter(t => mKey(t.date) === k);
      return {
        m: mName(k).replace(" 20", " '"),
        In: C.sum(r.filter(t => C.isIncome(t.cat))),
        Out: C.spent(r),
        Invested: C.invested(r),
      };
    });
  }, [tx, refData]);

  const nw = netWorth(refData);
  const topPayee = useMemo(() => {
    const m = {};
    spendRows.forEach(t => { const k = (t.desc || "").slice(0, 26); m[k] = (m[k] || 0) + C.spendPart(t); });
    const e = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    return e ? { name: e[0], v: e[1] } : null;
  }, [tx, month]);

  if (!tx.length) return <FirstRun setTab={setTab} aiEnabled={refData.aiEnabled} />;

  return (
    <>
      <MonthBar month={month} setMonth={setMonth} months={months} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(158px,1fr))", marginBottom: 14 }}>
        <Stat k="Money in" v={compact(income)} s={`Salary ${compact(salary)} · Claims ${compact(reimbIn)}`} tone="in" />
        <Stat k="Spent" v={compact(spent)} s={`${spendRows.length} entries`} tone="out" />
        {/* Net of payouts: a broker sending money back is an `in` row on the
            same category, so this reads negative in a period you withdrew more
            than you put in. */}
        {/* An unsplit EMI is counted here in full, interest and all, so say so
            rather than let the figure pass as money that bought something. */}
        <Stat k="Invested" v={compact(invested)}
          s={emiUnsplit ? "includes home loan interest"
            : invested < 0 ? "net of payouts back out" : "moved into assets"} tone="gold" />
        {/* Left over is cash flow: what the balance did, not what was earned and
            kept. A month you sold shares in has the proceeds land here, and
            subtracting a negative `invested` makes it read like surplus — so say
            where it came from rather than let your own money pass as savings. */}
        <Stat k="Left over" v={compact(net)}
          s={invested < 0 ? `${compact(-invested)} came back from investments`
            : income > 0 ? `Savings rate ${rate.toFixed(0)}%` : "no income recorded"}
          tone={net >= 0 ? "in" : "out"} />
        <Stat k="Owed to you" v={compact(owed)} s="unclaimed or unpaid" tone={owed > 0 ? "gold" : undefined} />
        <Stat k="Net worth" v={compact(nw.total)} s={`Equity ${compact(nw.equity)} · FD ${compact(nw.fd)}`} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))" }}>
        <div className="card">
          <h3 className="h3">Where it went</h3>
          {byCat.length ? (
            <>
              {/* Ranked bars, not a donut. Twenty-odd categories with several
                  near-identical values is the case a pie reads worst, and bars
                  need no colour to carry identity — the row label does it, so
                  nothing rests on telling two hues apart. */}
              <div style={{ marginTop: 10 }}>
                {topCats.map(d => (
                  <div key={d.id} style={{ padding: "5px 0" }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "nowrap" }}>
                      <span className="row" style={{ gap: 7, minWidth: 0 }}>
                        {/* The bar is one hue because length already carries the
                            magnitude; the dot is what ties the row to the same
                            category on Trends. Colouring the bars themselves
                            would repeat a hue as soon as a seventh row appears. */}
                        <span className="dot" style={{ background: d.c }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                      </span>
                      <span className="num" style={{ whiteSpace: "nowrap" }}>{inr(d.value)}{" "}
                        <span className="faint">{spent > 0 ? ((d.value / spent) * 100).toFixed(0) : 0}%</span>
                      </span>
                    </div>
                    <div className="bar-track" style={{ marginTop: 3 }}>
                      <div className="bar-fill" style={{
                        width: (barMax > 0 ? Math.max(0, d.value) / barMax * 100 : 0) + "%",
                        background: d.id === "__other" ? "var(--ink3)" : "var(--blue)",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty title="Nothing spent yet">Import a statement to fill this in.</Empty>}
        </div>

        <div className="card">
          <h3 className="h3">What went into assets</h3>
          {byInvest.length ? (
            <>
              <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                Money moved into things you still own. A broker paying out reads as a negative —
                that is your own money coming back, not income.
              </p>
              <div style={{ marginTop: 6 }}>
                {byInvest.map(d => (
                  <div key={d.name} style={{ padding: "5px 0" }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "nowrap" }}>
                      <span className="row" style={{ gap: 7, minWidth: 0 }}>
                        <span className="dot" style={{ background: d.value < 0 ? "var(--ink3)" : "var(--gold)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                      </span>
                      <span className="num" style={{ whiteSpace: "nowrap" }}>
                        {inr(Math.abs(d.value))}
                        {d.value < 0 && <span className="faint"> back out</span>}
                      </span>
                    </div>
                    <div className="bar-track" style={{ marginTop: 3 }}>
                      <div className="bar-fill" style={{
                        width: (investMax > 0 ? Math.abs(d.value) / investMax * 100 : 0) + "%",
                        background: d.value < 0 ? "var(--ink3)" : "var(--gold)",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
              <hr className="hr" />
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{invested < 0 ? "Net back out" : "Net into assets"}</b>
                <span className="num"><b>{inr(Math.abs(invested))}</b></span>
              </div>
              {emiUnsplit && (
                <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                  Home loan EMIs count in full, interest included.
                </p>
              )}
            </>
          ) : <Empty title="Nothing invested this period">Tag a transfer to a broker or fund as Investment out and it lands here.</Empty>}
        </div>

        {/* Spanning the row: spending and investing are the pair that read side
            by side, and the chart underneath is the same story over time. */}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3 className="h3">In, out, invested</h3>
          <div style={{ height: 250, marginTop: 10 }}>
            {trend.length ? (
              <ResponsiveContainer>
                <BarChart data={trend} margin={{ left: -6, right: 4 }}>
                  <CartesianGrid stroke="#DCE6D8" vertical={false} />
                  <XAxis dataKey="m" {...axis} />
                  <YAxis tickFormatter={compact} width={54} {...axis} />
                  <Tooltip formatter={v => inr(v)} {...tip} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: "IBM Plex Sans Condensed" }} />
                  <Bar dataKey="In" fill="#1C6A49" />
                  <Bar dataKey="Out" fill="#A6342A" />
                  <Bar dataKey="Invested" fill="#B0851E" />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty title="No history yet">Two months of statements and this fills in.</Empty>}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", marginTop: 12 }}>
        <div className="card">
          <h3 className="h3">Whose spending is it</h3>
          <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            Every entry gets tagged personal, household or official when it's classified.
          </p>
          {["household", "personal", "official"].map(s => {
            const v = byScope[s], p = spent ? (v / spent) * 100 : 0;
            const col = s === "household" ? "#7A5C3E" : s === "personal" ? "#2F6480" : "#B0851E";
            return (
              <div key={s} style={{ marginTop: 8 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span style={{ textTransform: "capitalize" }}>{s}</span>
                  <span className="num">{inr(v)} <span className="faint">{p.toFixed(0)}%</span></span>
                </div>
                <div className="bar-track" style={{ marginTop: 3 }}>
                  <div className="bar-fill" style={{ width: p + "%", background: col }} />
                </div>
              </div>
            );
          })}
          <hr className="hr" />
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {claimable > 0 && <li>{inr(claimable)} in this period is reimbursable and not yet settled.</li>}
            {topPayee && <li>Biggest payee: <b>{topPayee.name}</b> at {inr(topPayee.v)}.</li>}
            {byCat[0] && <li>{byCat[0].name} took {((byCat[0].value / spent) * 100).toFixed(0)}% of spending.</li>}
            {income > 0 && <li className={rate < 20 ? "neg" : "pos"}>Savings rate {rate.toFixed(0)}%.</li>}
          </ul>
        </div>

        <div className="card">
          <h3 className="h3">Latest entries</h3>
          <div className="scroll" style={{ marginTop: 8 }}>
            <table className="ledger">
              <tbody>
                {rows.slice(0, 9).map(t => (
                  <tr key={t.id}>
                    <td className="num faint" style={{ whiteSpace: "nowrap" }}>{dShort(t.date)}</td>
                    <td>{t.desc}{t.sub ? <div className="faint" style={{ fontSize: 11 }}>{t.sub}</div> : null}</td>
                    <td><span className="chip" style={{ borderColor: C.color(t.cat), color: C.color(t.cat) }}>{C.label(t.cat)}</span></td>
                    <td className={"r num " + (t.dir === "in" ? "pos" : "neg")}>{t.dir === "in" ? "" : "−"}{inr(t.amount)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td className="muted">No entries in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function FirstRun({ setTab, aiEnabled }) {
  return (
    <div style={{ maxWidth: 620 }}>
      <span className="eyebrow">First page</span>
      <h2 className="h2" style={{ margin: "4px 0 10px" }}>The ledger is empty.</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Start with January. Export a CSV from HDFC, Axis or your Diners statement, upload it, and
        every row gets read, sorted and filed. Repeat for each month and the trends build themselves.
      </p>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" data-v="primary" onClick={() => setTab("import")}>Import a statement</button>
        <button className="btn" onClick={() => setTab("ledger")}>Add an entry by hand</button>
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
        {aiEnabled
          ? "Claude is connected — it will sort the rows and suggest subcategories."
          : "No ANTHROPIC_API_KEY set, so sorting falls back to keyword rules. Add the key in your environment for the smarter classifier."}
      </p>
    </div>
  );
}
