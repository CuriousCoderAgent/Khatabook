import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Field } from "./ui.jsx";

export default function Login({ onIn }) {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/auth/status").then(s => {
      setStatus(s);
      if (s.needsFirstUser) setMode("signup");
    }).catch(() => setStatus({}));
  }, []);

  const go = async () => {
    setErr(""); setBusy(true);
    try {
      const d = await api.post(`/auth/${mode}`, { email, password, name });
      onIn(d.user);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const first = status && status.needsFirstUser;

  return (
    <div className="auth">
      <div className="auth-box">
        <h1 style={{ fontFamily: "var(--cond)", fontSize: 30, margin: 0 }}>Khata</h1>
        <p className="eyebrow" style={{ marginTop: 2 }}>household ledger</p>

        <div className="card" style={{ marginTop: 18 }}>
          <h3 className="h3">{first ? "Set up your account" : mode === "login" ? "Sign in" : "Create an account"}</h3>
          {first && <p className="muted" style={{ fontSize: 13 }}>
            This instance has no users yet. The first account you make becomes the owner.
          </p>}
          <div className="grid" style={{ marginTop: 10 }}>
            {mode === "signup" && (
              <Field label="Name"><input className="in" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>
            )}
            <Field label="Email">
              <input className="in" type="email" value={email} autoComplete="username"
                onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} />
            </Field>
            <Field label="Password">
              <input className="in" type="password" value={password}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} />
            </Field>
          </div>
          {err ? <p className="neg" style={{ fontSize: 13, marginBottom: 0 }}>{err}</p> : null}
          <button className="btn" data-v="primary" style={{ width: "100%", marginTop: 12 }} disabled={busy} onClick={go}>
            {busy ? "One moment…" : first ? "Create owner account" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          {!first && status && status.signupEnabled && (
            <button className="btn sm" style={{ width: "100%", marginTop: 8 }}
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}>
              {mode === "login" ? "Create an account instead" : "I already have an account"}
            </button>
          )}
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
          Your statements and balances stay in your own database. Nothing is shared with anyone.
        </p>
      </div>
    </div>
  );
}
