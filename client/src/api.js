async function call(method, url, body) {
  const res = await fetch("/api" + url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

async function upload(url, formData) {
  const res = await fetch("/api" + url, { method: "POST", body: formData, credentials: "same-origin" });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { data });
  return data;
}

export const api = {
  get: u => call("GET", u),
  post: (u, b) => call("POST", u, b),
  patch: (u, b) => call("PATCH", u, b),
  put: (u, b) => call("PUT", u, b),
  del: u => call("DELETE", u),
  upload,
};

/* -------------------------------- money -------------------------------- */

export const N = n => (isFinite(Number(n)) ? Number(n) : 0);
export const inr = n => "₹" + Math.round(N(n)).toLocaleString("en-IN");
export const inr2 = n => "₹" + N(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const compact = n => {
  const v = N(n), a = Math.abs(v);
  if (a >= 1e7) return "₹" + (v / 1e7).toFixed(2) + "Cr";
  if (a >= 1e5) return "₹" + (v / 1e5).toFixed(2) + "L";
  if (a >= 1e3) return "₹" + (v / 1e3).toFixed(1) + "k";
  return "₹" + Math.round(v);
};
export const pct = n => (N(n) >= 0 ? "+" : "") + N(n).toFixed(1) + "%";

/* -------------------------------- dates -------------------------------- */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const today = () => new Date().toISOString().slice(0, 10);
export const mKey = d => String(d || "").slice(0, 7);
export const mName = k => {
  if (!k) return "";
  const [y, m] = k.split("-");
  return MONTHS[+m - 1] + " " + y;
};
export const mShort = k => {
  if (!k) return "";
  const [y, m] = k.split("-");
  return MONTHS[+m - 1] + " " + String(y).slice(2);
};
export const dShort = d => {
  if (!d) return "";
  // Postgres DATE columns come back as full timestamps once they have been
  // through JSON, so trim before splitting or the day carries the time with it.
  const [, m, dd] = String(d).slice(0, 10).split("-");
  return dd + " " + MONTHS[+m - 1];
};
export function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/* ------------------------------ portfolio ------------------------------ */

export const holdQty = h => (h.lots || []).reduce((a, l) => a + N(l.qty), 0);
export const holdCost = h => (h.lots || []).reduce((a, l) => a + N(l.qty) * N(l.price), 0);
export const holdAvg = h => (holdQty(h) ? holdCost(h) / holdQty(h) : 0);
export const sortedPrices = h =>
  [...(h.prices || [])].map(p => ({ ...p, as_of: String(p.as_of).slice(0, 10), price: N(p.price) }))
    .sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : a.id - b.id));
export const lastPrice = h => {
  const p = sortedPrices(h);
  return p.length ? p[p.length - 1].price : holdAvg(h);
};
export const holdValue = h => holdQty(h) * lastPrice(h);
export const qtyAsOf = (h, d) => (h.lots || []).filter(l => String(l.buy_date).slice(0, 10) <= d).reduce((a, l) => a + N(l.qty), 0);
export const costAsOf = (h, d) => (h.lots || []).filter(l => String(l.buy_date).slice(0, 10) <= d).reduce((a, l) => a + N(l.qty) * N(l.price), 0);
export const priceAsOf = (h, d) => {
  const p = sortedPrices(h).filter(x => x.as_of <= d);
  return p.length ? p[p.length - 1].price : 0;
};

/**
 * How long the money has actually been in, weighted by how much of it went in
 * when. Two lakh in six months ago and fifty thousand last week is not "held
 * since last week", and averaging the dates plainly would say it was.
 */
export const holdYears = (h, on) => {
  const lots = h.lots || [];
  const cost = holdCost(h);
  if (!cost) return 0;
  const now = new Date(on || today());
  const weighted = lots.reduce((a, l) => {
    const days = Math.max(0, (now - new Date(String(l.buy_date).slice(0, 10))) / 864e5);
    return a + N(l.qty) * N(l.price) * days;
  }, 0);
  return weighted / cost / 365.25;
};

/**
 * Annualised return — what this would compound to over a year at the rate it has
 * managed so far. Below a month it is left out: 2% in nine days annualises to
 * something like 120%, which says far more about nine days than about the
 * holding, and printing it would be a small lie told in a confident font.
 */
export const MIN_ANNUALISE_YEARS = 30 / 365.25;
export function annualised(h, on) {
  const cost = holdCost(h);
  const value = holdValue(h);
  const years = holdYears(h, on);
  if (!cost || !value || years < MIN_ANNUALISE_YEARS) return null;
  return (Math.pow(value / cost, 1 / years) - 1) * 100;
}

/** Same shape for a whole set of holdings, weighted by what each one cost. */
export function annualisedPortfolio(holdings, on) {
  const list = (holdings || []).filter(h => holdCost(h) > 0);
  const cost = list.reduce((a, h) => a + holdCost(h), 0);
  const value = list.reduce((a, h) => a + holdValue(h), 0);
  if (!cost || !value) return null;
  const years = list.reduce((a, h) => a + holdCost(h) * holdYears(h, on), 0) / cost;
  if (years < MIN_ANNUALISE_YEARS) return null;
  return (Math.pow(value / cost, 1 / years) - 1) * 100;
}

/* --------------------------------- sales -------------------------------- */

export const saleProceeds = s => N(s.qty) * N(s.price);
/** Null when the cost of what was sold is not known — never a guessed profit. */
export const saleGain = s =>
  s.cost_basis == null ? null : N(s.qty) * (N(s.price) - N(s.cost_basis));
export const saleGainPct = s => {
  const g = saleGain(s);
  const base = N(s.qty) * N(s.cost_basis);
  return g == null || !base ? null : (g / base) * 100;
};

export function fdValue(f, on) {
  const start = new Date(f.start_date), now = new Date(on || today());
  const yrs = Math.max(0, (now - start) / (365.25 * 864e5));
  const n = f.compounding || 4;
  return N(f.principal) * Math.pow(1 + N(f.rate) / 100 / n, n * yrs);
}
export function fdMaturity(f) {
  const yrs = Math.max(0, (new Date(f.maturity_date) - new Date(f.start_date)) / (365.25 * 864e5));
  const n = f.compounding || 4;
  return N(f.principal) * Math.pow(1 + N(f.rate) / 100 / n, n * yrs);
}
export function netWorth(ref) {
  const equity = (ref.holdings || []).reduce((a, h) => a + holdValue(h), 0);
  const fd = (ref.fds || []).reduce((a, f) => a + fdValue(f), 0);
  const other = (ref.assets || []).reduce((a, x) => a + N(x.value), 0);
  return { equity, fd, other, total: equity + fd + other };
}
