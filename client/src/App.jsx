import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, mKey, today } from "./api.js";
import { RefContext } from "./ui.jsx";
import Login from "./Login.jsx";
import Overview from "./pages/Overview.jsx";
import Trends from "./pages/Trends.jsx";
import Ledger from "./pages/Ledger.jsx";
import Import from "./pages/Import.jsx";
import Claims from "./pages/Claims.jsx";
import Family from "./pages/Family.jsx";
import Investments from "./pages/Investments.jsx";
import Budgets from "./pages/Budgets.jsx";
import Settings from "./pages/Settings.jsx";

const TABS = [
  ["overview", "Overview"], ["trends", "Trends"], ["ledger", "Ledger"], ["import", "Import"],
  ["claims", "Claims"], ["family", "Family"], ["invest", "Investments"],
  ["budgets", "Budgets"], ["settings", "Settings"],
];

export default function App() {
  const [user, setUser] = useState(undefined);   // undefined = still checking
  const [tab, setTab] = useState(() => location.hash.slice(1) || "overview");
  const [tx, setTx] = useState([]);
  const [ref, setRef] = useState(null);
  const [toast, setToast] = useState("");
  const [month, setMonth] = useState("all");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    api.get("/auth/me").then(d => setUser(d.user)).catch(() => setUser(null));
  }, []);

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([api.get("/bootstrap"), api.get("/transactions")]);
    setRef(b); setTx(t);
  }, []);

  useEffect(() => { if (user) load().catch(e => setToast(e.message)); }, [user, load]);
  useEffect(() => { location.hash = tab; setMenu(false); }, [tab]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const say = m => setToast(m);

  /* ---------------------------- mutations ---------------------------- */

  const patchTx = useCallback(async (id, patch) => {
    setTx(p => p.map(t => (t.id === id ? { ...t, ...patch } : t)));      // optimistic
    try { const saved = await api.patch(`/transactions/${id}`, patch); setTx(p => p.map(t => (t.id === id ? saved : t))); }
    catch (e) { say(e.message); load(); }
  }, [load]);

  const bulkPatch = useCallback(async (ids, patch) => {
    setTx(p => p.map(t => (ids.includes(t.id) ? { ...t, ...patch } : t)));
    try { await api.post("/transactions/bulk-update", { ids, patch }); say(`${ids.length} entries updated`); }
    catch (e) { say(e.message); load(); }
  }, [load]);

  const removeTx = useCallback(async id => {
    setTx(p => p.filter(t => t.id !== id));
    try { await api.del(`/transactions/${id}`); } catch (e) { say(e.message); load(); }
  }, [load]);

  const addTx = useCallback(async row => {
    const saved = await api.post("/transactions", row);
    setTx(p => [saved, ...p].sort((a, b) => (a.date < b.date ? 1 : -1)));
    say("Added to the ledger");
    return saved;
  }, []);

  const refresh = load;
  const patchRef = useCallback(upd => setRef(r => ({ ...r, ...upd })), []);

  const months = useMemo(() => {
    const s = new Set(tx.map(t => mKey(t.date)).filter(Boolean));
    s.add(mKey(today()));
    return Array.from(s).sort().reverse();
  }, [tx]);

  const owed = useMemo(
    () => tx.filter(t => t.dir === "out" && ["pending", "claimed"].includes(t.reimb)).reduce((a, t) => a + t.amount, 0),
    [tx]
  );

  if (user === undefined) return <div className="empty" style={{ paddingTop: 90 }}>Opening the ledger…</div>;
  if (!user) return <Login onIn={setUser} />;
  if (!ref) return <div className="empty" style={{ paddingTop: 90 }}>Loading your books…</div>;

  const ctx = {
    tx, refData: ref, month, setMonth, months, owed, user,
    patchTx, bulkPatch, removeTx, addTx, refresh, patchRef, say, setTab,
  };

  const Page = {
    overview: Overview, trends: Trends, ledger: Ledger, import: Import, claims: Claims,
    family: Family, invest: Investments, budgets: Budgets, settings: Settings,
  }[tab] || Overview;

  const go = id => { setTab(id); setMenu(false); };
  const current = (TABS.find(([id]) => id === tab) || TABS[0])[1];

  return (
    <RefContext.Provider value={ref}>
      {/* Narrow screens get a fixed bar and a sheet instead of a strip of tabs
          that scrolls sideways: the destination list stops being something you
          have to hunt along, and the header no longer changes width with it. */}
      <header className="topbar">
        <button className="menubtn" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}>
          <span className="menubtn-icon" aria-hidden="true"><i /><i /><i /></span>
        </button>
        <div className="topbar-title">
          <b>{current}</b>
          {tab !== "claims" && owed > 0 ? <span className="tag">{Math.round(owed / 1000)}k owed</span> : null}
        </div>
      </header>

      {menu && (
        <div className="sheet-scrim" onClick={() => setMenu(false)}>
          <nav className="sheet" onClick={e => e.stopPropagation()} aria-label="Sections">
            <div className="sheet-head">
              <div>
                <h1>Khata</h1>
                <p>{user.email}</p>
              </div>
              <button className="btn sm" onClick={() => setMenu(false)} aria-label="Close menu">Close</button>
            </div>
            {TABS.map(([id, label]) => (
              <button key={id} className="sheetbtn" data-on={tab === id ? "1" : "0"} onClick={() => go(id)}>
                {label}
                {id === "claims" && owed > 0 ? <span className="tag">{Math.round(owed / 1000)}k</span> : null}
              </button>
            ))}
            <button className="btn sm" style={{ margin: "12px 16px 4px" }}
              onClick={async () => {
                try { await api.post("/auth/logout"); } catch { /* clear it regardless */ }
                location.reload();
              }}>Sign out</button>
          </nav>
        </div>
      )}

      <div className="shell">
        <nav className="side">
          <div className="brand">
            <h1>Khata</h1>
            <p>household ledger</p>
          </div>
          {TABS.map(([id, label]) => (
            <button key={id} className="navbtn" data-on={tab === id ? "1" : "0"} onClick={() => setTab(id)}>
              {label}
              {id === "claims" && owed > 0
                ? <span className="tag">{Math.round(owed / 1000)}k</span> : null}
            </button>
          ))}
          <div className="side-foot">
            <div>{user.email}</div>
            <button className="btn sm" style={{ marginTop: 6 }}
              onClick={async () => { await api.post("/auth/logout"); location.reload(); }}>Sign out</button>
          </div>
        </nav>
        <main className="main">
          <div className="fade" key={tab}><Page {...ctx} /></div>
        </main>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </RefContext.Provider>
  );
}
