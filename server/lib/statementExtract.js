import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const extractEnabled = () => Boolean(client);

const CHUNK_LINES = 120;
const DATE_START = /^\s*"?\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|^\s*"?\d{4}-\d{2}-\d{2}\b/;

const SYSTEM = `You read Indian bank and credit-card statements and pull out the transaction rows.

Return ONLY a JSON array. No prose, no markdown fences. Empty array if the text holds no transactions.

For each transaction:
{"date":"YYYY-MM-DD","narration":"<the payee/description text>","amount":<positive number>,"direction":"in|out"}

Rules:
- Skip everything that is not a transaction: bank letterhead, the account holder's name and address, account/card numbers, IFSC, GSTIN and HSN codes, statement period, page headers repeated per page, column headings, opening/closing balance lines, totals, reward-point summaries, minimum-due and credit-limit blocks, and any legal footer.
- amount is always positive. "direction" carries the sign: "out" for money leaving (debit, withdrawal, purchase, spend), "in" for money arriving (credit, deposit, refund, cashback, payment received).
- Columns are separated by "|". An empty cell between two "|" means that column is blank for this row. On a bank statement with separate withdrawal and deposit columns, which column the amount lands in is what decides the direction. Never treat the running balance column as the amount.
- On a credit-card statement, a purchase is "out". A payment to the card, a refund or a reversal is "in" — these are usually marked CR, Cr or a trailing minus.
- Indian dates are DD/MM/YY or DD/MM/YYYY: 03/01/26 is 3 January 2026, never 1 March. Two-digit years are 20xx. If a row has both a transaction date and a value/posting date, use the transaction date.
- A narration often wraps onto the next line or two. Join the continuation into one narration. Keep the merchant text; drop trailing reference numbers only if the narration is otherwise very long.
- Do not invent, merge or split transactions. One statement row in, one object out, in the order they appear.`;

/** Split at a line that looks like the start of a record, so wrapped narrations stay whole. */
function chunkLines(lines) {
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    let end = Math.min(start + CHUNK_LINES, lines.length);
    if (end < lines.length) {
      for (let i = end; i > end - 25 && i > start + 1; i--) {
        if (DATE_START.test(lines[i])) { end = i; break; }
      }
    }
    chunks.push(lines.slice(start, end));
    start = end;
  }
  return chunks;
}

function parseArray(text) {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("extractor returned no JSON array");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const clean = r => {
  const date = String(r.date || "").slice(0, 10);
  const amount = Math.abs(Number(r.amount));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(amount) || amount === 0) return null;
  return {
    date,
    description: String(r.narration || "").replace(/\s+/g, " ").trim().slice(0, 200),
    amount,
    direction: r.direction === "in" ? "in" : "out",
  };
};

/**
 * Hand the statement text to Claude and get transaction rows back. Unlike the
 * column-mapping heuristic this copes with the half-page of preamble every real
 * statement carries, and with narrations that wrap across lines.
 */
export async function extractTransactions(lines, accountHint) {
  if (!client) throw Object.assign(new Error("No ANTHROPIC_API_KEY set."), { status: 400 });

  const usable = lines.map(l => String(l).trim()).filter(Boolean);
  if (!usable.length) return [];

  const out = [];
  for (const chunk of chunkLines(usable)) {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{
        role: "user",
        content:
          (accountHint ? `This is a statement for: ${accountHint}\n\n` : "") +
          `Statement text:\n${chunk.join("\n")}`,
      }],
    });
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    for (const r of parseArray(text)) {
      const row = clean(r);
      if (row) out.push(row);
    }
  }
  return out;
}

const TOTALS_SYSTEM = `You read the summary figures off an Indian bank or credit-card statement.

Return ONLY a JSON object, no prose or fences:
{"debits":<number|null>,"credits":<number|null>}

- "debits" is the statement's own stated total of money out: TRANSACTION TOTAL debits, total
  withdrawals, PURCHASES/DEBITS on a card. "credits" is its stated total of money in: total
  deposits, PAYMENTS/CREDITS RECEIVED.
- Take the figures the statement prints. Never add anything up yourself, and never infer one from
  the other or from a balance.
- Use null for anything the text does not state outright. A statement that prints no totals must
  give {"debits":null,"credits":null}. Guessing is worse than null here.
- Ignore opening and closing balances, minimum amount due, total dues, credit limit and reward
  points. None of those are transaction totals.`;

/**
 * Read the statement's own stated debit and credit totals, so an import can be
 * checked against them. Fingerprinting catches a row that arrived twice; nothing
 * catches a row that never arrived at all, and a statement eleven rows short
 * looks exactly like a statement with eleven fewer transactions.
 *
 * Only the head and tail are sent — summary blocks live at one end or the other,
 * and it keeps this to one cheap call regardless of statement length.
 */
export async function extractTotals(lines) {
  if (!client) return null;
  const usable = lines.map(l => String(l).trim()).filter(Boolean);
  if (!usable.length) return null;

  const edges = usable.length <= 90
    ? usable
    : [...usable.slice(0, 45), "...", ...usable.slice(-45)];

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: TOTALS_SYSTEM,
      messages: [{ role: "user", content: `Statement text:\n${edges.join("\n")}` }],
    });
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
    if (s < 0 || e < 0) return null;
    const o = JSON.parse(cleaned.slice(s, e + 1));
    const num = v => (v == null || !isFinite(Number(v)) ? null : Math.abs(Number(v)));
    const debits = num(o.debits), credits = num(o.credits);
    return debits == null && credits == null ? null : { debits, credits };
  } catch (e) {
    console.error("could not read statement totals:", e.message);
    return null;
  }
}

const SMS_SYSTEM = `You read Indian bank and credit-card transaction alerts — the SMS a bank sends the moment money moves — and turn each one into a ledger row.

Return ONLY a JSON array, no prose or fences. One object per transaction, in the order they appear:
{"date":"YYYY-MM-DD","narration":"<merchant or payee>","amount":<positive number>,"direction":"in|out","last4":"<4 digits or null>"}

Rules:
- The amount is the sum that moved. It is never the available balance, the available limit, the
  outstanding due or the reward points, all of which these messages like to print right after it.
  "Rs.742 debited ... Avl Bal Rs.51,208" moved 742, not 51,208.
- direction: "out" for debited, spent, paid, withdrawn, purchased. "in" for credited, received,
  refunded, reversed, cashback.
- narration is the merchant or person, cleaned up: from "VPA swiggy@ybl" give "Swiggy", from
  "UPI/P2M/4012/BLINKIT" give "Blinkit", from "at AMAZON RETAIL BENGALURU" give "Amazon Retail".
  Drop reference numbers, VPA suffixes, "Not you? Call...", and the bank's own name unless the
  bank IS the payee. If no payee can be read, use a short description of what happened.
- last4 is the last four digits of the account or card the message names — "A/c XX5441" gives
  "5441", "Card ending 3278" gives "3278". Use null if the message names none. Never take four
  digits from a reference number, an amount or a phone number.
- Indian dates: DD-MM-YY or DD-MM-YYYY. 03-01-26 is 3 January 2026, never 1 March. A message
  with no date at all happened TODAY, whose date is given below.
- Ignore anything that is not a completed transaction: OTPs, balance enquiries, offers, EMI
  reminders, due-date notices, failed or declined payment alerts, "requested money from you".
  If the whole paste holds none, return [].
- Several messages may be pasted at once, run together with no separator. Split them yourself.`;

/**
 * Read pasted bank SMS alerts into ledger rows. Same contract as the statement
 * reader — the four fields, plus the account tail so the row can file itself
 * against the right account without asking.
 */
export async function extractFromSms(text, today) {
  if (!client) throw Object.assign(new Error("No ANTHROPIC_API_KEY set."), { status: 400 });
  const body = String(text || "").trim();
  if (!body) return [];

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SMS_SYSTEM,
    messages: [{ role: "user", content: `Today is ${today}.\n\nMessages:\n${body.slice(0, 12000)}` }],
  });

  const out = msg.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  return parseArray(out).map(r => {
    const row = clean(r);
    if (!row) return null;
    const last4 = /^\d{4}$/.test(String(r.last4 || "")) ? String(r.last4) : null;
    return { ...row, last4 };
  }).filter(Boolean);
}

/** Compare what we pulled out against what the statement says it holds. */
export function reconcile(rows, totals) {
  if (!totals) return null;
  const sum = d => rows.filter(r => r.direction === d).reduce((a, r) => a + r.amount, 0);
  const parts = [];
  let ok = true;
  for (const [dir, stated] of [["out", totals.debits], ["in", totals.credits]]) {
    if (stated == null) continue;
    const actual = Math.round(sum(dir) * 100) / 100;
    // A rupee or two of slack: statements round, and a paise-level gap is not a
    // missing row. Anything larger is.
    const good = Math.abs(actual - stated) <= 2;
    if (!good) ok = false;
    parts.push({ direction: dir, stated, actual, diff: Math.round((actual - stated) * 100) / 100, ok: good });
  }
  return parts.length ? { ok, parts } : null;
}
