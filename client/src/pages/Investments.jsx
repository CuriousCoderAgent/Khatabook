import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import {
  api, inr, inr2, compact, pct, dShort, today,
  holdQty, holdCost, holdAvg, lastPrice, holdValue, sortedPrices, qtyAsOf, costAsOf, priceAsOf,
  annualised, annualisedPortfolio, holdYears, saleProceeds, saleGain, saleGainPct,
  fdValue, fdMaturity, netWorth, N,
} from "../api.js";
import { Modal, Field, Stat, Empty, tip, axis } from "../ui.jsx";

const KINDS = { stock: "Share", mf: "Mutual fund", etf: "ETF", gold: "Gold", crypto: "Crypto", other: "Other" };

export default function Investments(props) {
  const [sub, setSub] = useState("equity");
  return (
    <>
      <span className="eyebrow">Savings</span>
      <h2 className="h2" style={{ margin: "4px 0 12px" }}>What you're holding</h2>
      <div className="row" style={{ marginBottom: 14 }}>
        {[["equity", "Shares & funds"], ["fd", "Fixed deposits"], ["other", "Other assets"]].map(([k, l]) => (
          <button key={k} className="btn" data-on={sub === k ? "1" : "0"} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      {sub === "equity" && <Equity {...props} />}
      {sub === "fd" && <FDs {...props} />}
      {sub === "other" && <Others {...props} />}
    </>
  );
}

/* ------------------------------- equity -------------------------------- */

function Equity({ refData, refresh, say }) {
  const all = refData.holdings || [];
  // A fully exited position keeps its row so the sale has somewhere to live, but
  // it owns nothing — it does not belong among the holdings or in best/weakest.
  const H = all.filter(h => holdQty(h) > 0);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);

  const invested = H.reduce((a, h) => a + holdCost(h), 0);
  const value = H.reduce((a, h) => a + holdValue(h), 0);
  const pl = value - invested;
  const annPort = annualisedPortfolio(H);

  const timeline = useMemo(() => {
    const dates = new Set();
    H.forEach(h => {
      (h.lots || []).forEach(l => dates.add(String(l.buy_date).slice(0, 10)));
      sortedPrices(h).forEach(p => dates.add(p.as_of));
    });
    dates.add(today());
    return Array.from(dates).sort().map(d => ({
      d: dShort(d),
      Value: H.reduce((a, h) => a + qtyAsOf(h, d) * priceAsOf(h, d), 0),
      Invested: H.reduce((a, h) => a + costAsOf(h, d), 0),
    }));
  }, [H]);

  const scored = H.map(h => ({ name: h.symbol, p: holdAvg(h) ? ((lastPrice(h) - holdAvg(h)) / holdAvg(h)) * 100 : 0 }))
    .sort((a, b) => b.p - a.p);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(158px,1fr))", marginBottom: 14 }}>
        <Stat k="Invested" v={inr(invested)} s={`${H.length} holdings`} />
        <Stat k="Value now" v={inr(value)} s="at your latest logged prices" />
        <Stat k="Unrealised" v={(pl >= 0 ? "+" : "−") + inr(Math.abs(pl))} s={invested ? pct((pl / invested) * 100) : ""} tone={pl >= 0 ? "in" : "out"} />
        {/* The plain return says nothing about how long the money was in for.
            Six months at +19% and two months at +7% are not comparable until
            both are put on a yearly footing. */}
        <Stat k="Annualised" v={annPort == null ? "—" : pct(annPort)}
          s={annPort == null ? "needs a month invested" : "per year at this rate"}
          tone={annPort == null ? undefined : annPort >= 0 ? "in" : "out"} />
        <Stat k="Best" v={scored[0] ? scored[0].name : "—"} s={scored[0] ? pct(scored[0].p) : ""} tone="in" />
        <Stat k="Weakest" v={scored.length ? scored[scored.length - 1].name : "—"} s={scored.length ? pct(scored[scored.length - 1].p) : ""} tone="out" />
      </div>

      {timeline.length > 1 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="h3">Portfolio, checkpoint by checkpoint</h3>
          <p className="faint" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Each step is a price you logged. The dashed line is what you actually paid.
          </p>
          <div style={{ height: 250, marginTop: 8 }}>
            <ResponsiveContainer>
              <LineChart data={timeline} margin={{ left: -4, right: 8 }}>
                <CartesianGrid stroke="#DCE6D8" vertical={false} />
                <XAxis dataKey="d" {...axis} />
                <YAxis tickFormatter={compact} width={58} {...axis} />
                <Tooltip formatter={v => inr(v)} {...tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="stepAfter" dataKey="Invested" stroke="#8B9A90" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                <Line type="monotone" dataKey="Value" stroke="#1C6A49" strokeWidth={2.2} dot={{ r: 2.5, fill: "#1C6A49" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
        <h3 className="h3">Holdings</h3>
        <button className="btn" data-v="primary" onClick={() => setAdding(true)}>Add a holding</button>
      </div>

      {!H.length && <div className="card"><Empty title="No holdings yet">
        Add a share with its quantity and buy price. Every price you log afterwards is kept, never replaced.
      </Empty></div>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))" }}>
        {H.map(h => <HoldingCard key={h.id} h={h} onOpen={() => setOpen(h.id)} />)}
      </div>

      <Exits H={all} refresh={refresh} say={say} />

      {adding && <AddHolding onClose={() => setAdding(false)} refresh={refresh} say={say} />}
      {open && <HoldingDetail h={H.find(x => x.id === open)} onClose={() => setOpen(null)} refresh={refresh} say={say} />}
    </>
  );
}

/**
 * What has been sold. A sale whose cost is not known shows its proceeds and
 * nothing else — the gain column stays empty rather than inventing a number,
 * and the cost can be filled in here once it is known.
 */
function Exits({ H, refresh, say }) {
  const [edit, setEdit] = useState({});
  const rows = H.flatMap(h => (h.sales || []).map(s => ({ ...s, symbol: h.symbol, holdingId: h.id })))
    .sort((a, b) => (a.sell_date < b.sell_date ? 1 : -1));
  if (!rows.length) return null;

  const proceeds = rows.reduce((a, s) => a + saleProceeds(s), 0);
  const known = rows.filter(s => saleGain(s) != null);
  const realised = known.reduce((a, s) => a + saleGain(s), 0);
  const unknown = rows.length - known.length;

  const save = async (s, v) => {
    try {
      await api.patch(`/holdings/${s.holdingId}/sales/${s.id}`, { cost_basis: v === "" ? null : Number(v) });
      setEdit(e => ({ ...e, [s.id]: undefined }));
      await refresh(); say("Saved");
    } catch (e) { say(e.message); }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="h3">Sold and exited</h3>
        <span className="faint num" style={{ fontSize: 12 }}>
          {inr(proceeds)} out{known.length ? ` · realised ${realised >= 0 ? "+" : "−"}${inr(Math.abs(realised))}` : ""}
        </span>
      </div>
      {unknown > 0 && (
        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
          {unknown === rows.length ? "None of these can" : `${unknown} of these cannot`} show a return
          yet: the shares were bought before the records begin, so what they cost is not known. Enter
          the buy price and the gain fills in.
        </p>
      )}
      <div className="scroll" style={{ marginTop: 8 }}>
        <table className="ledger">
          <thead><tr>
            <th>Sold</th><th>Share</th><th className="r">Qty</th><th className="r">Price</th>
            <th className="r">Proceeds</th><th className="r">Bought at</th><th className="r">Gain</th>
          </tr></thead>
          <tbody>
            {rows.map(s => {
              const g = saleGain(s), gp = saleGainPct(s);
              const draft = edit[s.id];
              return (
                <tr key={s.id}>
                  <td className="num faint">{dShort(s.sell_date)}</td>
                  <td>{s.symbol}</td>
                  <td className="r num">{N(s.qty)}</td>
                  <td className="r num">{inr2(s.price)}</td>
                  <td className="r num">{inr(saleProceeds(s))}</td>
                  <td className="r">
                    <input className="in num" style={{ width: 92, padding: "2px 5px", fontSize: 12, textAlign: "right" }}
                      placeholder="not known" inputMode="decimal"
                      value={draft !== undefined ? draft : (s.cost_basis == null ? "" : N(s.cost_basis))}
                      onChange={e => setEdit(x => ({ ...x, [s.id]: e.target.value }))}
                      onBlur={e => { if (draft !== undefined) save(s, e.target.value.trim()); }} />
                  </td>
                  <td className={"r num " + (g == null ? "faint" : g >= 0 ? "pos" : "neg")}>
                    {g == null ? "—" : `${g >= 0 ? "+" : "−"}${inr(Math.abs(g))}`}
                    {gp == null ? null : <div className="faint" style={{ fontSize: 11 }}>{pct(gp)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldingCard({ h, onOpen }) {
  const qty = holdQty(h), avg = holdAvg(h), now = lastPrice(h);
  const val = qty * now, pl = val - qty * avg;
  const ann = annualised(h);
  const months = Math.max(0, Math.round(holdYears(h) * 12));
  const log = sortedPrices(h);
  const shown = log.slice(-4);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="h3" style={{ fontSize: 15 }}>{h.symbol}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            {h.name || KINDS[h.kind] || "Share"} · {qty} @ {inr2(avg)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="num" style={{ fontSize: 17 }}>{inr(val)}</div>
          <div className={"num " + (pl >= 0 ? "pos" : "neg")} style={{ fontSize: 12 }}>
            {pl >= 0 ? "+" : "−"}{inr(Math.abs(pl))} · {pct(avg ? ((now - avg) / avg) * 100 : 0)}
          </div>
          <div className="faint num" style={{ fontSize: 11 }}>
            {ann == null ? `held ${months} mo` : `${pct(ann)} a year · ${months} mo`}
          </div>
        </div>
      </div>

      <div className="rail">
        <div className="rail-in">
          {shown.map((c, i) => {
            const prevIdx = log.length - shown.length + i - 1;
            const prev = prevIdx >= 0 ? log[prevIdx].price : null;
            const k = prev == null ? "flat" : c.price > prev ? "up" : c.price < prev ? "down" : "flat";
            const g = prev ? ((c.price - prev) / prev) * 100 : null;
            return (
              <div className="ck" key={c.id || i} data-k={k}>
                <div className="p">{inr2(c.price).replace(".00", "")}</div>
                <div className="n" />
                <div className="d">{dShort(c.as_of)}</div>
                <div className={"g " + (k === "up" ? "pos" : k === "down" ? "neg" : "faint")}>
                  {g == null ? "bought" : pct(g)}
                </div>
              </div>
            );
          })}
          {!shown.length && <div className="faint" style={{ fontSize: 12 }}>No price checkpoints yet.</div>}
        </div>
      </div>

      <button className="btn" style={{ marginTop: 8, width: "100%" }} onClick={onOpen}>
        {log.length} checkpoints · log a price
      </button>
    </div>
  );
}

function AddHolding({ onClose, refresh, say }) {
  const [v, setV] = useState({ symbol: "", name: "", kind: "stock", qty: "", price: "", date: today() });
  const set = p => setV(x => ({ ...x, ...p }));
  return (
    <Modal title="Add a holding" onClose={onClose}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Field label="Symbol"><input className="in" value={v.symbol} onChange={e => set({ symbol: e.target.value.toUpperCase() })} placeholder="INFY" /></Field>
        <Field label="Full name"><input className="in" value={v.name} onChange={e => set({ name: e.target.value })} placeholder="Infosys Ltd" /></Field>
        <Field label="Kind">
          <select className="in" value={v.kind} onChange={e => set({ kind: e.target.value })}>
            {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Quantity"><input className="in" type="number" step="any" value={v.qty} onChange={e => set({ qty: e.target.value })} /></Field>
        <Field label="Buy price per unit"><input className="in" type="number" step="any" value={v.price} onChange={e => set({ price: e.target.value })} placeholder="200" /></Field>
        <Field label="Buy date"><input className="in" type="date" value={v.date} onChange={e => set({ date: e.target.value })} /></Field>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        The buy price becomes the first checkpoint. Log later prices from the holding's page — nothing gets overwritten.
      </p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" data-v="primary" onClick={async () => {
          const qty = parseFloat(v.qty), price = parseFloat(v.price);
          if (!v.symbol.trim() || !(qty > 0) || !(price > 0)) return alert("Symbol, quantity and buy price are all needed.");
          try { await api.post("/holdings", { ...v, qty, price }); await refresh(); onClose(); }
          catch (e) { say(e.message); }
        }}>Add holding</button>
      </div>
    </Modal>
  );
}

function HoldingDetail({ h, onClose, refresh, say }) {
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today());
  const [lot, setLot] = useState({ qty: "", price: "", date: today() });
  const [showLot, setShowLot] = useState(false);
  if (!h) return null;

  const log = sortedPrices(h);
  const qty = holdQty(h), avg = holdAvg(h), now = lastPrice(h);
  const detAnn = annualised(h);
  const chart = log.map(p => ({ d: dShort(p.as_of), price: p.price }));

  const logPrice = async () => {
    const p = parseFloat(price);
    if (!(p > 0)) return alert("Enter a price above zero.");
    try {
      await api.post(`/holdings/${h.id}/prices`, { as_of: date, price: p });
      setPrice(""); await refresh();
    } catch (e) { say(e.message); }
  };

  return (
    <Modal title={`${h.symbol} — price log`} onClose={onClose} wide>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(126px,1fr))", marginBottom: 12 }}>
        <Stat k="Quantity" v={<span className="num">{qty}</span>} />
        <Stat k="Average cost" v={inr2(avg)} />
        <Stat k="Latest logged" v={inr2(now)} tone={now >= avg ? "in" : "out"} />
        <Stat k="Value" v={inr(qty * now)} />
        <Stat k="Unrealised" v={pct(avg ? ((now - avg) / avg) * 100 : 0)} tone={now >= avg ? "in" : "out"} />
        <Stat k="Annualised" v={detAnn == null ? "—" : pct(detAnn)}
          s={detAnn == null ? "held under a month" : `over ${(holdYears(h) * 12).toFixed(1)} months`}
          tone={detAnn == null ? undefined : detAnn >= 0 ? "in" : "out"} />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Price today">
            <input className="in" type="number" step="any" style={{ width: 130 }} value={price}
              onChange={e => setPrice(e.target.value)} onKeyDown={e => e.key === "Enter" && logPrice()} placeholder="250" />
          </Field>
          <Field label="As on"><input className="in" type="date" style={{ width: 160 }} value={date} onChange={e => setDate(e.target.value)} /></Field>
          <button className="btn" data-v="gold" onClick={logPrice}>Log this price</button>
          <span className="faint" style={{ fontSize: 12 }}>Adds to the record. Earlier prices stay exactly as entered.</span>
        </div>
      </div>

      {chart.length > 1 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ height: 210 }}>
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ left: -6, right: 8 }}>
                <CartesianGrid stroke="#DCE6D8" vertical={false} />
                <XAxis dataKey="d" {...axis} />
                <YAxis domain={["auto", "auto"]} tickFormatter={v => "₹" + v} width={56} {...axis} />
                <Tooltip formatter={v => inr2(v)} {...tip} />
                <ReferenceLine y={avg} stroke="#8B9A90" strokeDasharray="4 3"
                  label={{ value: "cost " + inr2(avg), position: "insideTopLeft", fontSize: 10, fill: "#53645A" }} />
                <Line type="monotone" dataKey="price" stroke={now >= avg ? "#1C6A49" : "#A6342A"} strokeWidth={2.2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="scroll" style={{ maxHeight: 240, overflowY: "auto" }}>
        <table className="ledger">
          <thead><tr><th>#</th><th>As on</th><th className="r">Price</th><th className="r">Change</th><th className="r">Value then</th><th></th></tr></thead>
          <tbody>
            {log.map((p, i) => {
              const g = i ? ((p.price - log[i - 1].price) / log[i - 1].price) * 100 : null;
              return (
                <tr key={p.id}>
                  <td className="num faint">{i + 1}</td>
                  <td className="num">{dShort(p.as_of)} <span className="faint">{p.as_of.slice(0, 4)}</span></td>
                  <td className="r num">{inr2(p.price)}</td>
                  <td className={"r num " + (g == null ? "faint" : g >= 0 ? "pos" : "neg")}>{g == null ? "purchase" : pct(g)}</td>
                  <td className="r num faint">{inr(qtyAsOf(h, p.as_of) * p.price)}</td>
                  <td className="r">
                    {log.length > 1 && (
                      <button className="btn sm" data-v="danger" title="Only to fix a typo"
                        onClick={async () => {
                          if (!confirm("Remove this checkpoint? Use this only to fix a mistyped price.")) return;
                          try { await api.del(`/holdings/${h.id}/prices/${p.id}`); await refresh(); }
                          catch (e) { say(e.message); }
                        }}>×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <hr className="hr" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn" onClick={() => setShowLot(!showLot)}>{showLot ? "Hide" : "Add another purchase"}</button>
        <button className="btn" data-v="danger" onClick={async () => {
          if (!confirm(`Delete ${h.symbol} and its whole price history?`)) return;
          try { await api.del(`/holdings/${h.id}`); await refresh(); onClose(); } catch (e) { say(e.message); }
        }}>Delete holding</button>
      </div>

      {showLot && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Quantity"><input className="in" type="number" step="any" style={{ width: 110 }} value={lot.qty} onChange={e => setLot({ ...lot, qty: e.target.value })} /></Field>
            <Field label="Price"><input className="in" type="number" step="any" style={{ width: 110 }} value={lot.price} onChange={e => setLot({ ...lot, price: e.target.value })} /></Field>
            <Field label="Date"><input className="in" type="date" style={{ width: 158 }} value={lot.date} onChange={e => setLot({ ...lot, date: e.target.value })} /></Field>
            <button className="btn" onClick={async () => {
              const q = parseFloat(lot.qty), p = parseFloat(lot.price);
              if (!(q > 0) || !(p > 0)) return alert("Quantity and price needed.");
              try {
                await api.post(`/holdings/${h.id}/lots`, { qty: q, price: p, buy_date: lot.date });
                setLot({ qty: "", price: "", date: today() }); setShowLot(false); await refresh();
              } catch (e) { say(e.message); }
            }}>Add purchase</button>
          </div>
          <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>Average cost recalculates across all purchases.</p>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn" data-v="primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

/* --------------------------- fixed deposits ---------------------------- */

function FDs({ refData, refresh, say }) {
  const F = refData.fds || [];
  const blank = { bank: "", principal: "", rate: "", start_date: today(), maturity_date: "", compounding: 4, note: "" };
  const [v, setV] = useState(blank);
  const [editId, setEditId] = useState(null);

  const totalP = F.reduce((a, f) => a + N(f.principal), 0);
  const totalNow = F.reduce((a, f) => a + fdValue(f), 0);
  const totalMat = F.reduce((a, f) => a + fdMaturity(f), 0);

  const submit = async () => {
    if (!v.bank.trim() || !(parseFloat(v.principal) > 0) || !v.maturity_date)
      return alert("Bank, principal, rate and maturity date are needed.");
    const body = { ...v, principal: parseFloat(v.principal), rate: parseFloat(v.rate), compounding: Number(v.compounding) };
    try {
      if (editId) await api.patch(`/fds/${editId}`, body);
      else await api.post("/fds", body);
      setV(blank); setEditId(null); await refresh();
    } catch (e) { say(e.message); }
  };

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(158px,1fr))", marginBottom: 14 }}>
        <Stat k="Deposited" v={inr(totalP)} s={`${F.length} deposits`} />
        <Stat k="Worth today" v={inr(totalNow)} s="accrued at your stated rate" tone="in" />
        <Stat k="At maturity" v={inr(totalMat)} s={`${inr(totalMat - totalP)} interest in all`} tone="gold" />
      </div>

      <div className="card scroll" style={{ marginBottom: 12, padding: "8px 10px" }}>
        <table className="ledger">
          <thead><tr><th>Bank</th><th className="r">Principal</th><th className="r">Rate</th><th>Opened</th><th>Matures</th>
            <th className="r">Today</th><th className="r">At maturity</th><th>Days left</th><th></th></tr></thead>
          <tbody>
            {F.map(f => {
              const days = Math.ceil((new Date(f.maturity_date) - new Date()) / 864e5);
              return (
                <tr key={f.id}>
                  <td>{f.bank}{f.note ? <div className="faint" style={{ fontSize: 11.5 }}>{f.note}</div> : null}</td>
                  <td className="r num">{inr(f.principal)}</td>
                  <td className="r num">{N(f.rate)}%</td>
                  <td className="num faint">{String(f.start_date).slice(0, 10)}</td>
                  <td className="num">{String(f.maturity_date).slice(0, 10)}</td>
                  <td className="r num pos">{inr(fdValue(f))}</td>
                  <td className="r num">{inr(fdMaturity(f))}</td>
                  <td className={"num " + (days < 30 ? "neg" : "faint")}>{days > 0 ? days : "matured"}</td>
                  <td className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <button className="btn sm" onClick={() => {
                      setV({
                        bank: f.bank, principal: String(f.principal), rate: String(f.rate),
                        start_date: String(f.start_date).slice(0, 10), maturity_date: String(f.maturity_date).slice(0, 10),
                        compounding: f.compounding, note: f.note || "",
                      });
                      setEditId(f.id);
                    }}>Edit</button>
                    <button className="btn sm" data-v="danger" onClick={async () => {
                      if (!confirm("Delete this deposit?")) return;
                      try { await api.del(`/fds/${f.id}`); await refresh(); } catch (e) { say(e.message); }
                    }}>×</button>
                  </td>
                </tr>
              );
            })}
            {!F.length && <tr><td colSpan={9}><Empty title="No deposits recorded">Add one below and it accrues on its own.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="h3">{editId ? "Edit deposit" : "Add a fixed deposit"}</h3>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", marginTop: 8 }}>
          <Field label="Bank"><input className="in" value={v.bank} onChange={e => setV({ ...v, bank: e.target.value })} placeholder="HDFC" /></Field>
          <Field label="Principal"><input className="in" type="number" value={v.principal} onChange={e => setV({ ...v, principal: e.target.value })} /></Field>
          <Field label="Rate % p.a."><input className="in" type="number" step="0.01" value={v.rate} onChange={e => setV({ ...v, rate: e.target.value })} /></Field>
          <Field label="Opened"><input className="in" type="date" value={v.start_date} onChange={e => setV({ ...v, start_date: e.target.value })} /></Field>
          <Field label="Matures"><input className="in" type="date" value={v.maturity_date} onChange={e => setV({ ...v, maturity_date: e.target.value })} /></Field>
          <Field label="Compounding">
            <select className="in" value={v.compounding} onChange={e => setV({ ...v, compounding: e.target.value })}>
              <option value={4}>Quarterly</option><option value={12}>Monthly</option>
              <option value={2}>Half-yearly</option><option value={1}>Yearly</option>
            </select>
          </Field>
          <Field label="Note"><input className="in" value={v.note} onChange={e => setV({ ...v, note: e.target.value })} placeholder="Tax saver, joint holding" /></Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" data-v="primary" onClick={submit}>{editId ? "Save deposit" : "Add deposit"}</button>
          {editId && <button className="btn" onClick={() => { setV(blank); setEditId(null); }}>Cancel</button>}
        </div>
      </div>
    </>
  );
}

/* ---------------------------- other assets ----------------------------- */

function Others({ refData, refresh, say }) {
  const A = refData.assets || [];
  const [v, setV] = useState({ name: "", value: "", kind: "Savings balance" });
  const nw = netWorth(refData);
  const total = A.reduce((a, x) => a + N(x.value), 0);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(158px,1fr))", marginBottom: 14 }}>
        <Stat k="Other assets" v={inr(total)} s={`${A.length} items`} />
        <Stat k="Shares & funds" v={inr(nw.equity)} />
        <Stat k="Deposits" v={inr(nw.fd)} />
        <Stat k="Net worth" v={inr(nw.total)} tone="in" />
      </div>

      <div className="card" style={{ marginBottom: 12, padding: "8px 10px" }}>
        <table className="ledger">
          <thead><tr><th>Asset</th><th>Kind</th><th className="r">Value</th><th className="r">Share</th><th></th></tr></thead>
          <tbody>
            {A.map(x => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td className="faint">{x.kind}</td>
                <td className="r">
                  <input className="in num" type="number" style={{ padding: "2px 5px", width: 130, textAlign: "right" }}
                    defaultValue={N(x.value)}
                    onBlur={async e => {
                      const val = parseFloat(e.target.value);
                      if (!isFinite(val) || val === N(x.value)) return;
                      try { await api.patch(`/assets/${x.id}`, { value: val }); await refresh(); } catch (er) { say(er.message); }
                    }} />
                </td>
                <td className="r num faint">{nw.total ? ((N(x.value) / nw.total) * 100).toFixed(1) + "%" : "—"}</td>
                <td className="r"><button className="btn sm" data-v="danger" onClick={async () => {
                  try { await api.del(`/assets/${x.id}`); await refresh(); } catch (e) { say(e.message); }
                }}>×</button></td>
              </tr>
            ))}
            {!A.length && <tr><td colSpan={5}><Empty title="Nothing else recorded">
              Bank balances, PPF, EPF, gold, property — anything you want counted in net worth.
            </Empty></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Name"><input className="in" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} placeholder="HDFC savings balance" /></Field>
          <Field label="Kind">
            <select className="in" style={{ width: 160 }} value={v.kind} onChange={e => setV({ ...v, kind: e.target.value })}>
              {["Savings balance", "Cash", "PPF", "EPF", "Gold", "Property", "Insurance corpus", "Other"].map(k => <option key={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Value"><input className="in" type="number" style={{ width: 150 }} value={v.value} onChange={e => setV({ ...v, value: e.target.value })} /></Field>
          <button className="btn" data-v="primary" onClick={async () => {
            const val = parseFloat(v.value);
            if (!v.name.trim() || !isFinite(val)) return alert("Name and value needed.");
            try {
              await api.post("/assets", { name: v.name.trim(), kind: v.kind, value: val, as_of: today() });
              setV({ name: "", value: "", kind: "Savings balance" }); await refresh();
            } catch (e) { say(e.message); }
          }}>Add asset</button>
        </div>
      </div>
    </>
  );
}
