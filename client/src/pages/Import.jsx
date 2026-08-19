import React, { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { api, inr, dShort, compact } from "../api.js";
import { Field, Empty, useCats } from "../ui.jsx";

const HINTS = {
  date: ["date", "txn date", "transaction date", "value date", "posting date", "tran date", "trans date"],
  desc: ["description", "narration", "particulars", "details", "remarks", "transaction remarks", "merchant", "payee", "transaction details"],
  debit: ["debit", "withdrawal", "withdrawal amt", "dr", "debit amount", "withdrawals", "spend"],
  credit: ["credit", "deposit", "deposit amt", "cr", "credit amount", "deposits"],
  amount: ["amount", "amt", "transaction amount", "value"],
};

const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)))
    return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let y = +m[3]; if (y < 100) y += 2000;
    return `${y}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  }
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/))) {
    const mo = MON[m[2].slice(0, 3).toLowerCase()]; if (!mo) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    return `${y}-${String(mo).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseAmount(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\b(dr|debit)\b/i.test(s)) neg = true;
  s = s.replace(/[^0-9.\-]/g, "");
  if (!s || s === "-" || s === ".") return NaN;
  const n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

export default function Import({ refData, refresh, say, setTab }) {
  const C = useCats();
  const [raw, setRaw] = useState(null);
  const [map, setMap] = useState({ date: -1, desc: -1, debit: -1, credit: -1, amount: -1 });
  const [mode, setMode] = useState("dc");
  const [accountId, setAccountId] = useState(refData.accounts[0] ? refData.accounts[0].id : "");
  const [filename, setFilename] = useState("");
  const [prep, setPrep] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [sms, setSms] = useState("");
  const [check, setCheck] = useState(null);       // reconciliation against the statement's own totals
  const [shortRows, setShortRows] = useState(null); // rows held back because the check failed
  const [pendingPdf, setPendingPdf] = useState(null); // { file, needsPassword }
  const [pdfPw, setPdfPw] = useState("");
  const [savePw, setSavePw] = useState(true);
  const fileRef = useRef(null);

  function ingestRows(rows, name) {
    if (!rows.length) return say("That file had no readable rows.");

    let best = 0, bestScore = -1;
    rows.slice(0, 15).forEach((r, i) => {
      const s = r.reduce((acc, c) => {
        const v = String(c).toLowerCase().trim();
        return acc + (Object.values(HINTS).some(list => list.includes(v)) ? 1 : 0);
      }, 0);
      if (s > bestScore) { bestScore = s; best = i; }
    });

    const header = rows[best].map((h, i) => String(h).trim() || `Column ${i + 1}`);
    const body = rows.slice(best + 1).filter(r => r.length >= 2);
    const norm = s => String(s).toLowerCase().replace(/[^a-z ]/g, "").trim();
    const find = list => {
      let i = header.findIndex(h => list.includes(norm(h)));
      if (i < 0) i = header.findIndex(h => list.some(k => k.length >= 4 && norm(h).includes(k)));
      return i;
    };
    const m = {
      date: find(HINTS.date), desc: find(HINTS.desc),
      debit: find(HINTS.debit), credit: find(HINTS.credit), amount: find(HINTS.amount),
    };
    if (m.date < 0) m.date = header.findIndex((_, i) => body.slice(0, 5).every(r => parseDate(r[i])));
    if (m.desc < 0) m.desc = header.findIndex((_, i) => body.slice(0, 5).some(r => String(r[i]).length > 12 && isNaN(parseAmount(r[i]))));
    setMap(m);
    setMode(m.debit >= 0 && m.credit >= 0 ? "dc" : "neg_out");
    setRaw({ header, rows: body });
    setFilename(name || "pasted rows");
    setPrep(null);
  }

  function ingest(csvText, name) {
    const out = Papa.parse(String(csvText).trim(), { skipEmptyLines: true });
    const rows = out.data.filter(r => r.some(c => String(c).trim() !== ""));
    ingestRows(rows, name);
  }

  async function uploadStatement(file, password, save) {
    setBusy("Reading the statement with Claude…");
    const fd = new FormData();
    fd.append("file", file);
    if (accountId) fd.append("accountId", accountId);
    if (password) fd.append("password", password);
    if (save) fd.append("savePassword", "true");
    try {
      const res = await api.upload("/import/statement", fd);
      setPendingPdf(null); setPdfPw("");
      if (res.via === "ai") {
        setFilename(file.name);
        setRaw(null);
        setCheck(res.check || null);
        // Rows that don't add up to the statement's own totals mean something was
        // missed. Stop here and say so rather than filing a short month quietly.
        if (res.check && !res.check.ok) { setShortRows(res.rows); return; }
        await classify(res.rows, file.name);
      } else {
        if (res.note) say(res.note);
        if (res.matrix) ingestRows(res.matrix, file.name);
        else if (res.text) ingest(res.text, file.name);
        else say("Nothing readable in that file.");
      }
    } catch (e) {
      if (e.data && e.data.needsPassword) { setPendingPdf({ file }); say(e.message); }
      else say(e.message);
    } finally { setBusy(""); }
  }

  async function classify(parsed, name) {
    if (!parsed.length) return say("No rows parsed. Check the mapping.");
    const acct = refData.accounts.find(a => a.id === Number(accountId));
    setBusy(`Sorting ${parsed.length} rows${refData.aiEnabled ? " with Claude" : ""}…`);
    try {
      const res = await api.post("/import/classify", {
        rows: parsed.map(p => ({ ...p, accountName: acct ? acct.name : "" })),
      });
      setFilename(name);
      setRaw(null);
      setPrep(res.rows.map(r => ({
        ...r,
        desc: r.description,
        dir: r.direction,
        // A row that already knows its account found it from the digits in an
        // SMS; only fall back to the picker when it doesn't.
        keep: !r.duplicate && !r.maybeDuplicate,
        accountId: r.accountId || Number(accountId) || null,
      })).sort((a, b) => (a.date < b.date ? 1 : -1)));
    } catch (e) { say(e.message); }
    finally { setBusy(""); }
  }

  async function readSms() {
    if (!sms.trim()) return;
    setBusy("Reading the messages…");
    try {
      const res = await api.post("/import/sms", { text: sms });
      if (!res.rows.length) return say(res.note || "Nothing readable in that.");
      if (res.unmatchedTails && res.unmatchedTails.length) {
        say(`No account set for ${res.unmatchedTails.join(", ")} — add the last four digits under Settings.`);
      }
      setCheck(null);
      await classify(res.rows, `${res.rows.length} message${res.rows.length > 1 ? "s" : ""}`);
      setSms("");
    } catch (e) { say(e.message); }
    finally { setBusy(""); }
  }

  async function build() {
    if (!raw) return;
    if (map.date < 0 || (map.debit < 0 && map.credit < 0 && map.amount < 0))
      return say("Point at a date column and at least one amount column.");

    const parsed = [];
    raw.rows.forEach(r => {
      const date = parseDate(r[map.date]);
      if (!date) return;
      const description = String(map.desc >= 0 ? r[map.desc] : "").replace(/\s+/g, " ").trim();
      let amount = 0, direction = "out";
      if (mode === "dc") {
        const d = parseAmount(r[map.debit]), c = parseAmount(r[map.credit]);
        if (isFinite(d) && Math.abs(d) > 0) { amount = Math.abs(d); direction = "out"; }
        else if (isFinite(c) && Math.abs(c) > 0) { amount = Math.abs(c); direction = "in"; }
        else return;
      } else {
        const a = parseAmount(r[map.amount >= 0 ? map.amount : map.debit]);
        if (!isFinite(a) || a === 0) return;
        amount = Math.abs(a);
        direction = mode === "neg_out" ? (a < 0 ? "out" : "in") : (a > 0 ? "out" : "in");
      }
      parsed.push({ date, description, amount, direction });
    });

    await classify(parsed, filename);
  }

  async function commit() {
    const keep = prep.filter(r => r.keep);
    if (!keep.length) return say("Nothing ticked to import.");
    setBusy(`Filing ${keep.length} entries…`);
    try {
      await api.post("/transactions/bulk", {
        rows: keep.map(r => ({
          date: r.date, desc: r.desc, amount: r.amount, dir: r.dir, cat: r.cat, sub: r.sub,
          scope: r.scope, accountId: r.accountId, reimb: r.reimb, note: null,
          source: "import", confidence: r.confidence, reason: r.reason,
        })),
        batch: { accountId: Number(accountId) || null, filename, rowCount: prep.length },
      });
      await refresh();
      setPrep(null); setRaw(null); setText(""); setCheck(null); setShortRows(null);
      if (fileRef.current) fileRef.current.value = "";
      say(`${keep.length} entries added.`);
      setTab("trends");
    } catch (e) { say(e.message); }
    finally { setBusy(""); }
  }

  const colOpts = raw ? [{ i: -1, n: "— none —" }, ...raw.header.map((h, i) => ({ i, n: `${i + 1}. ${h}` }))] : [];
  const dupes = prep ? prep.filter(r => r.duplicate).length : 0;
  const maybes = prep ? prep.filter(r => r.maybeDuplicate).length : 0;
  const lowConf = prep ? prep.filter(r => r.confidence != null && r.confidence < 0.5).length : 0;
  const subs = useMemo(() => {
    if (!prep) return [];
    const m = {};
    prep.forEach(r => { if (r.sub) m[r.sub] = (m[r.sub] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [prep]);

  return (
    <>
      <span className="eyebrow">Statements</span>
      <h2 className="h2" style={{ margin: "4px 0 12px" }}>Bring in a month</h2>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
          <Field label="Which account">
            <select className="in" value={accountId} onChange={e => setAccountId(e.target.value)}>
              {refData.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Statement file">
            <input ref={fileRef} className="in" type="file" accept=".pdf,.csv,.txt,application/pdf,text/csv"
              onChange={e => {
                const f = e.target.files && e.target.files[0]; if (!f) return;
                uploadStatement(f, null, false);
              }} />
          </Field>
        </div>

        {pendingPdf && (
          <div className="card" style={{ marginTop: 10, borderColor: "var(--gold)" }}>
            <h3 className="h3" style={{ fontSize: 14 }}>Password needed</h3>
            <p className="muted" style={{ fontSize: 13 }}>{pendingPdf.file.name} is password-protected.</p>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input className="in" type="password" placeholder="Statement password" autoFocus
                value={pdfPw} onChange={e => setPdfPw(e.target.value)}
                onKeyDown={e => e.key === "Enter" && pdfPw && uploadStatement(pendingPdf.file, pdfPw, savePw)} />
              <button className="btn" data-v="primary" disabled={!pdfPw || !!busy}
                onClick={() => uploadStatement(pendingPdf.file, pdfPw, savePw)}>Unlock</button>
              <button className="btn sm" onClick={() => { setPendingPdf(null); setPdfPw(""); if (fileRef.current) fileRef.current.value = ""; }}>Cancel</button>
            </div>
            <label className="row" style={{ marginTop: 8, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={savePw} onChange={e => setSavePw(e.target.checked)} />
              Remember this password for the selected account
            </label>
          </div>
        )}

        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Or paste rows directly</summary>
          <textarea className="in" rows={5} style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 12 }}
            value={text} onChange={e => setText(e.target.value)}
            placeholder={"Date,Narration,Debit,Credit\n03/01/2026,SWIGGY BANGALORE,742.00,\n01/01/2026,SALARY JAN,,185000"} />
          <button className="btn" style={{ marginTop: 8 }} onClick={() => text.trim() && ingest(text, "pasted rows")}>Read pasted rows</button>
        </details>
        <p className="faint" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          {refData.aiEnabled
            ? "PDF, CSV or the .txt your bank hands you. Claude reads the statement itself — it skips the letterhead and address block and pulls out the transactions, then sorts each one into a category. Payees you've corrected before are matched from memory first."
            : "Set ANTHROPIC_API_KEY on the server and Claude will read statements for you. Without it, point at the columns by hand and keyword rules do the sorting."}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 className="h3">Today's spending</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Paste the alerts your bank sent you — one, or a whole day of them at once. The account is
          picked from the digits in the message, so you don't have to say which card it was.
        </p>
        <textarea className="in" rows={4} style={{ marginTop: 8, fontSize: 13 }}
          value={sms} onChange={e => setSms(e.target.value)}
          placeholder={"Rs.742.00 debited from a/c XX5441 on 30-07-26 to VPA swiggy@ybl. Ref 401234567890.\n\nSpent Rs.1299.50 on HDFC Bank Card 3278 at BLINKIT on 30-07-26. Avl Limit INR 2,08,458"} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" data-v="primary" disabled={!sms.trim() || !!busy}
            onClick={readSms}>Read these messages</button>
          {sms.trim() ? <button className="btn sm" onClick={() => setSms("")}>Clear</button> : null}
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          OTPs, offers and due-date reminders are ignored. Anything already in the ledger for that
          day and amount comes back unticked, so pasting the same message twice is safe.
        </p>
      </div>

      {busy && <div className="card" style={{ marginBottom: 12 }}><b>{busy}</b></div>}

      {shortRows && !busy && (
        <div className="card" style={{ marginBottom: 12, borderColor: "var(--out)" }}>
          <h3 className="h3">This doesn't add up</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {shortRows.length} rows came out of <b>{filename}</b>, but they don't match the totals the
            statement prints for itself. Something was missed, so nothing has been filed.
          </p>
          <div className="scroll" style={{ marginTop: 8 }}>
            <table className="ledger">
              <thead><tr><th></th><th className="r">Statement says</th><th className="r">Rows add up to</th><th className="r">Short by</th></tr></thead>
              <tbody>
                {check.parts.map(p => (
                  <tr key={p.direction}>
                    <td>{p.direction === "out" ? "Money out" : "Money in"}</td>
                    <td className="r num">{inr(p.stated)}</td>
                    <td className="r num">{inr(p.actual)}</td>
                    <td className={"r num " + (p.ok ? "faint" : "neg")}>{p.ok ? "—" : inr(Math.abs(p.diff))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Worth retrying first — a second read often picks up what it missed. If the statement's own
            total is wrong, or you know what the gap is, you can carry on and fix it in the ledger.
          </p>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn" data-v="primary" onClick={() => {
              const f = fileRef.current && fileRef.current.files[0];
              setShortRows(null); setCheck(null);
              if (f) uploadStatement(f, pdfPw || null, false); else say("Pick the file again to retry.");
            }}>Read it again</button>
            <button className="btn" onClick={async () => {
              const rows = shortRows;
              setShortRows(null);
              await classify(rows, filename);
            }}>Import anyway</button>
            <button className="btn sm" onClick={() => {
              setShortRows(null); setCheck(null);
              if (fileRef.current) fileRef.current.value = "";
            }}>Cancel</button>
          </div>
        </div>
      )}

      {raw && !prep && !busy && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 className="h3">Point at the right columns</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {raw.rows.length} rows in <b>{filename}</b>. Headings: <span className="num faint">{raw.header.join(" · ")}</span>
          </p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
            <Field label="Sign convention">
              <select className="in" value={mode} onChange={e => setMode(e.target.value)}>
                <option value="dc">Separate debit and credit columns</option>
                <option value="neg_out">One amount column, spends negative</option>
                <option value="pos_out">One amount column, spends positive (typical card)</option>
              </select>
            </Field>
            <Field label="Date"><select className="in" value={map.date} onChange={e => setMap({ ...map, date: +e.target.value })}>
              {colOpts.map(o => <option key={o.i} value={o.i}>{o.n}</option>)}</select></Field>
            <Field label="Narration"><select className="in" value={map.desc} onChange={e => setMap({ ...map, desc: +e.target.value })}>
              {colOpts.map(o => <option key={o.i} value={o.i}>{o.n}</option>)}</select></Field>
            {mode === "dc" ? (
              <>
                <Field label="Debit"><select className="in" value={map.debit} onChange={e => setMap({ ...map, debit: +e.target.value })}>
                  {colOpts.map(o => <option key={o.i} value={o.i}>{o.n}</option>)}</select></Field>
                <Field label="Credit"><select className="in" value={map.credit} onChange={e => setMap({ ...map, credit: +e.target.value })}>
                  {colOpts.map(o => <option key={o.i} value={o.i}>{o.n}</option>)}</select></Field>
              </>
            ) : (
              <Field label="Amount"><select className="in" value={map.amount} onChange={e => setMap({ ...map, amount: +e.target.value })}>
                {colOpts.map(o => <option key={o.i} value={o.i}>{o.n}</option>)}</select></Field>
            )}
          </div>
          <div className="scroll" style={{ marginTop: 10 }}>
            <table className="ledger">
              <thead><tr>{raw.header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{raw.rows.slice(0, 3).map((r, i) =>
                <tr key={i}>{raw.header.map((_, j) => <td key={j} className="num" style={{ fontSize: 11.5 }}>{String(r[j] ?? "")}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <button className="btn" data-v="primary" style={{ marginTop: 12 }} onClick={build}>Read and sort the rows</button>
        </div>
      )}

      {prep && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 className="h3">Check before it goes in</h3>
            <div className="row">
              <span className="muted num" style={{ fontSize: 12.5 }}>
                {prep.filter(r => r.keep).length}/{prep.length} ticked
                {dupes ? ` · ${dupes} duplicates` : ""}{maybes ? ` · ${maybes} possibly already in` : ""}{lowConf ? ` · ${lowConf} unsure` : ""}
              </span>
              <button className="btn sm" onClick={() => setPrep(prep.map(r => ({ ...r, keep: true })))}>Tick all</button>
              <button className="btn sm" onClick={() => setPrep(prep.map(r => ({ ...r, keep: false })))}>Untick all</button>
              <button className="btn" data-v="primary" onClick={commit} disabled={!!busy}>Add to ledger</button>
            </div>
          </div>

          {check && check.ok && (
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              <span className="pos">Balances.</span>{" "}
              {check.parts.map(p => `${p.direction === "out" ? "out" : "in"} ${inr(p.actual)}`).join(" · ")}
              {" "}— matches the totals on the statement.
            </p>
          )}

          {subs.length > 0 && (
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              Subcategories proposed: {subs.map(([s, n]) => `${s} (${n})`).join(" · ")}
            </p>
          )}

          <div className="scroll" style={{ marginTop: 8, maxHeight: 560, overflowY: "auto" }}>
            <table className="ledger prep">
              <thead><tr><th></th><th>Date</th><th>Narration</th><th>Category</th><th>Subcategory</th>
                <th>Scope</th><th>Claim</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {prep.map((r, i) => {
                  const upd = patch => { const c = [...prep]; c[i] = { ...r, ...patch }; setPrep(c); };
                  return (
                    <tr key={i} style={r.duplicate || r.maybeDuplicate ? { opacity: 0.55 } : undefined}>
                      <td><input type="checkbox" checked={r.keep} onChange={e => upd({ keep: e.target.checked })} /></td>
                      <td className="num faint">{dShort(r.date)}</td>
                      <td style={{ maxWidth: 250 }}>
                        {r.desc}
                        {r.duplicate ? <span className="chip" style={{ marginLeft: 6 }}>already in ledger</span> : null}
                        {r.maybeDuplicate ? (
                          <span className="chip" style={{ marginLeft: 6, borderColor: "var(--gold)", color: "var(--gold)" }}
                            title={r.maybeDuplicateOf ? `Same day and amount as "${r.maybeDuplicateOf}"` : undefined}>
                            same day and amount as something filed
                          </span>
                        ) : null}
                        {r.reason ? <div className="faint" style={{ fontSize: 11 }}>{r.reason}</div> : null}
                      </td>
                      <td>
                        <select className="in" style={{ padding: "2px 4px", fontSize: 12.5, width: 140, borderColor: C.color(r.cat) }}
                          value={r.cat} onChange={e => upd({ cat: e.target.value })}>
                          {C.forDir(r.dir).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="in" style={{ padding: "2px 5px", fontSize: 12.5, width: 116 }}
                          value={r.sub || ""} onChange={e => upd({ sub: e.target.value })} placeholder="—" />
                      </td>
                      <td>
                        <select className="in" style={{ padding: "2px 4px", fontSize: 12, width: 94 }}
                          value={r.scope || "personal"} onChange={e => upd({ scope: e.target.value })}>
                          {["personal", "household", "official"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        {r.dir === "out" && (
                          <button className="btn sm" data-on={r.reimb === "pending" ? "1" : "0"}
                            onClick={() => upd({ reimb: r.reimb === "pending" ? "none" : "pending" })}>
                            {r.reimb === "pending" ? "claim" : "—"}
                          </button>
                        )}
                      </td>
                      <td className={"r num " + (r.dir === "in" ? "pos" : "neg")}>{r.dir === "in" ? "" : "−"}{inr(r.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {refData.batches && refData.batches.length > 0 && !prep && !raw && (
        <div className="card">
          <h3 className="h3">Already imported</h3>
          <table className="ledger" style={{ marginTop: 8 }}>
            <thead><tr><th>File</th><th>Account</th><th>Period</th><th className="r">Rows</th></tr></thead>
            <tbody>
              {refData.batches.map(b => (
                <tr key={b.id}>
                  <td>{b.filename || "—"}</td>
                  <td className="faint">{(refData.accounts.find(a => a.id === b.account_id) || {}).name || "—"}</td>
                  <td className="num faint">{String(b.period_from).slice(0, 10)} → {String(b.period_to).slice(0, 10)}</td>
                  <td className="r num">{b.imported}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
