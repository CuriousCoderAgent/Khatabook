import React, { useState } from "react";
import { inr, dShort } from "../api.js";
import { Stat, Empty, useCats } from "../ui.jsx";

export default function Claims({ tx, patchTx, bulkPatch }) {
  const C = useCats();
  const [stage, setStage] = useState("open");

  const all = tx.filter(t => t.dir === "out" && t.reimb && t.reimb !== "none");
  const pending = all.filter(t => t.reimb === "pending");
  const claimed = all.filter(t => t.reimb === "claimed");
  const received = all.filter(t => t.reimb === "received");
  const sum = a => a.reduce((x, t) => x + t.amount, 0);
  const list = stage === "open" ? [...pending, ...claimed]
    : stage === "pending" ? pending : stage === "claimed" ? claimed : received;
  const banked = tx.filter(t => t.cat === "reimb_in").reduce((a, t) => a + t.amount, 0);
  const gap = sum(received) - banked;

  return (
    <>
      <span className="eyebrow">Reimbursements</span>
      <h2 className="h2" style={{ margin: "4px 0 12px" }}>What the company still owes you</h2>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(158px,1fr))", marginBottom: 14 }}>
        <Stat k="Not yet claimed" v={inr(sum(pending))} s={`${pending.length} entries`} tone="out" />
        <Stat k="Claim filed" v={inr(sum(claimed))} s={`${claimed.length} entries`} tone="gold" />
        <Stat k="Marked settled" v={inr(sum(received))} s={`${received.length} entries`} tone="in" />
        <Stat k="Credits banked" v={inr(banked)} s={Math.abs(gap) > 100 ? `${inr(Math.abs(gap))} ${gap > 0 ? "short of" : "beyond"} what you marked` : "matches your records"} tone="in" />
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        {[["open", "Open"], ["pending", "Not claimed"], ["claimed", "Filed"], ["received", "Settled"]].map(([k, l]) => (
          <button key={k} className="btn" data-on={stage === k ? "1" : "0"} onClick={() => setStage(k)}>{l}</button>
        ))}
        {stage === "pending" && pending.length > 0 && (
          <button className="btn" data-v="gold"
            onClick={() => bulkPatch(pending.map(t => t.id), { reimb: "claimed" })}>
            File all {pending.length} as claimed
          </button>
        )}
        {stage === "claimed" && claimed.length > 0 && (
          <button className="btn" data-v="gold"
            onClick={() => bulkPatch(claimed.map(t => t.id), { reimb: "received" })}>
            Mark all {claimed.length} settled
          </button>
        )}
      </div>

      <div className="card scroll" style={{ padding: "8px 10px" }}>
        <table className="ledger">
          <thead><tr><th>Date</th><th>Payee</th><th>Note</th><th>Category</th><th className="r">Amount</th><th>Stage</th></tr></thead>
          <tbody>
            {list.map(t => (
              <tr key={t.id}>
                <td className="num faint">{dShort(t.date)}</td>
                <td>{t.desc}{t.sub ? <div className="faint" style={{ fontSize: 11 }}>{t.sub}</div> : null}</td>
                <td>
                  <input className="in" style={{ padding: "2px 5px", fontSize: 12.5, minWidth: 180 }}
                    placeholder="Who was there, what for" defaultValue={t.note || ""}
                    onBlur={e => e.target.value !== (t.note || "") && patchTx(t.id, { note: e.target.value })} />
                </td>
                <td><span className="chip" style={{ borderColor: C.color(t.cat), color: C.color(t.cat) }}>{C.label(t.cat)}</span></td>
                <td className="r num">{inr(t.amount)}</td>
                <td>
                  <select className="in" style={{ padding: "2px 4px", fontSize: 12.5, width: 120 }}
                    value={t.reimb} onChange={e => patchTx(t.id, { reimb: e.target.value })}>
                    <option value="pending">Not claimed</option>
                    <option value="claimed">Filed</option>
                    <option value="received">Settled</option>
                    <option value="none">Not claimable</option>
                  </select>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6}><Empty title="Nothing at this stage">
              In the ledger, hit the claim button on any meal, cab or trip you paid for on the company's behalf.
            </Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
