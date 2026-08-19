import React, { createContext, useContext } from "react";
import { mName } from "./api.js";

export const RefContext = createContext({ categories: [] });
export const useRef2 = () => useContext(RefContext);

export function useCats() {
  const ref = useRef2();
  const list = ref.categories || [];
  const byKey = Object.fromEntries(list.map(c => [c.key, c]));

  // A refund is an `in` row carrying an `out` category, so it subtracts from
  // that category rather than reading as income. Same the other way round for
  // a clawed-back salary.
  const sign = (t, c) => (t.dir === c.dir ? 1 : -1);

  // A home loan EMI is two payments in one envelope. The principal buys a slice
  // of the house and belongs with the investments; the interest is the price of
  // borrowing, is gone for good, and is spending like any other. Splitting them
  // is the only way both totals stay true — counting the whole EMI as an asset
  // overstates net worth by the interest, which early in a loan is most of it.
  //
  // With no split recorded the whole EMI counts as asset. That is the reading
  // the ledger was asked for, and it is the flattering one, so every place that
  // relies on it says so rather than quietly presenting it as fact.
  const investPart = t => {
    const c = byKey[t.cat];
    if (!c || c.group !== "Invested") return 0;
    const full = Number(t.amount || 0);
    const p = t.cat === "home_loan" && t.principal != null ? Number(t.principal) : full;
    return sign(t, c) * p;
  };

  const spendPart = t => {
    const c = byKey[t.cat];
    if (!c) return 0;
    if (c.dir === "out" && !c.both) return sign(t, c) * Number(t.amount || 0);
    // The interest half of an EMI, once the split is known. Nothing else that
    // carries `both` is spending in either direction.
    if (t.cat === "home_loan" && t.principal != null) {
      return sign(t, c) * (Number(t.amount || 0) - Number(t.principal));
    }
    return 0;
  };

  return {
    list,
    byKey,
    label: k => (byKey[k] ? byKey[k].label : "Uncategorised"),
    color: k => (byKey[k] ? byKey[k].color : "#96A099"),
    // Six hues is the most that stays separable on this surface, so hues repeat
    // past the sixth category and the dash pattern carries the difference.
    // Colour alone would leave the seventh line indistinguishable from the first.
    dash: k => (byKey[k] && byKey[k].dash) || "0",
    isSpend: k => byKey[k] && byKey[k].dir === "out" && !byKey[k].both,
    isIncome: k => byKey[k] && byKey[k].dir === "in" && !byKey[k].both,
    // Money that went into something you still own. `invest` and `home_loan`
    // both qualify; cc_pay and self are transfers and are neither.
    isInvest: k => byKey[k] && byKey[k].group === "Invested",
    investPart,
    spendPart,
    // Totals. Use these rather than filtering on isSpend and summing, or the
    // interest half of an EMI silently drops out of spending altogether.
    spent: rows => rows.reduce((a, t) => a + spendPart(t), 0),
    invested: rows => rows.reduce((a, t) => a + investPart(t), 0),
    /** Is any home loan EMI in here still missing its principal split? */
    emiUnsplit: rows => rows.some(t => t.cat === "home_loan" && t.principal == null),
    // invest, cc_pay and self are legal on a row going either way, so they have
    // to appear in the picker for both. Leaving them out was silently
    // reclassifying a broker payout the moment anyone opened the row to edit it.
    forDir: d => list.filter(c => c.dir === d || c.both),
    // Signed amount for totalling. A refund is an `in` row carrying an `out`
    // category, so it has to subtract from that category rather than read as
    // income. Same the other way for a clawed-back salary.
    net: t => {
      const c = byKey[t.cat];
      if (!c) return 0;
      return (t.dir === c.dir ? 1 : -1) * Number(t.amount || 0);
    },
    sum: rows => rows.reduce((a, t) => {
      const c = byKey[t.cat];
      if (!c) return a;
      return a + (t.dir === c.dir ? 1 : -1) * Number(t.amount || 0);
    }, 0),
  };
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 920 } : undefined} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-h">
          <h3 className="h3">{title}</h3>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, children }) => (
  <label className="f"><span>{label}</span>{children}</label>
);

export function Stat({ k, v, s, tone }) {
  const col = tone === "in" ? "var(--in)" : tone === "out" ? "var(--out)" : tone === "gold" ? "var(--gold)" : "var(--ink)";
  return (
    <div className="stat" style={{ borderLeftColor: col }}>
      <div className="k">{k}</div>
      <div className="v" style={{ color: col }}>{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

export const Empty = ({ title, children }) => (
  <div className="empty"><div className="h3">{title}</div><div>{children}</div></div>
);

export const tip = {
  contentStyle: { background: "#FBFCF8", border: "1px solid #14231A", borderRadius: 3, fontSize: 12, fontFamily: "IBM Plex Mono, monospace" },
  labelStyle: { fontFamily: "IBM Plex Sans Condensed, sans-serif", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 11 },
};

export const axis = { tick: { fontSize: 10, fontFamily: "IBM Plex Mono" }, stroke: "#8B9A90" };

export function ScopeChip({ scope }) {
  const map = { personal: ["#2F6480", "personal"], household: ["#7A5C3E", "house"], official: ["#B0851E", "official"] };
  const [c, l] = map[scope] || map.personal;
  return <span className="chip" style={{ borderColor: c, color: c }}>{l}</span>;
}

export function MonthBar({ month, setMonth, months, right }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="eyebrow">Period</span>
        <select className="in" style={{ width: "auto" }} value={month} onChange={e => setMonth(e.target.value)}>
          <option value="all">All time</option>
          {months.map(m => <option key={m} value={m}>{mName(m)}</option>)}
        </select>
      </div>
      {right}
    </div>
  );
}
