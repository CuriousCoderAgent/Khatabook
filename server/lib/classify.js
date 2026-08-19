import Anthropic from "@anthropic-ai/sdk";
import { q } from "../db.js";
import { CATEGORIES, CAT_KEYS, SCOPES, keywordGuess, normaliseMerchant, dirAllowed } from "./taxonomy.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const aiEnabled = () => Boolean(client);

const CAT_LIST = CATEGORIES.map(c => `${c.key} (${c.label}, ${c.dir})`).join("\n");

const SYSTEM = `You sort Indian bank and credit-card transactions for one household's personal ledger.

Return ONLY a JSON array. No prose, no markdown fences.

For each input row return:
{"i":<index>,"category":"<key>","subcategory":"<short label or null>","scope":"personal|household|official","reimbursable":<true|false>,"confidence":<0-1>,"reason":"<max 8 words>"}

Allowed category keys:
${CAT_LIST}

Rules:
- category must be one of the keys above and must match the row's direction (in/out), with one
  exception: invest, home_loan, cc_pay and self may be used on a row going either way, because money moves
  both ways through them. A payout from a broker, a refund credited back to a card, or money
  coming back from your own account are all "in" rows that are not income — use invest, cc_pay
  or self for those rather than reaching for an income category.
- a refund or reversal of a purchase keeps the category of the thing being refunded. An Amazon
  refund is an "in" row with category shopping, not an income category.
- subcategory is free text you choose: two or three words, title case, specific and reusable. Split broad merchants: Swiggy food orders -> "Swiggy"; Swiggy Instamart -> category groceries, subcategory "Instamart". Amazon -> guess from the narration ("Groceries", "Electronics", "Household"). Fuel, tolls, school fees, pharmacy, streaming all make good subcategories. Reuse a subcategory you have already used in this batch rather than inventing a near-duplicate.
- scope: "household" for things the whole home consumes (groceries, utilities, rent, domestic help, kids, family groceries), "personal" for one person's own spending, "official" when it reads like work (team meals, client travel, office cabs, conference fees).
- reimbursable: true only when it plausibly gets claimed from an employer — team meals, client entertainment, work travel, office cabs. Never for groceries, rent, personal shopping.
- Transfers between the user's own accounts are "self". Paying a credit card bill is "cc_pay". Neither is spending.
- Money moving to a broker, SIP, PPF, NPS or mutual fund is "invest", not spending.
- A home loan EMI is "home_loan", not "emi" and not spending: it leaves a house behind. Housing
  finance arms (HDFC Ltd Housing, LIC Housing, PNB Housing) and any narration reading "home loan"
  or "housing loan" go here. A car, personal, education or consumer-durable EMI stays "emi" and
  is spending — nothing is left over at the end of it.
- Indian context: Swiggy, Zomato, Blinkit, Zepto, BigBasket, DMart, Ola, Uber, Rapido, IRCTC, BESCOM, FASTag, Zerodha, Groww, UPI handles. A UPI transfer to a person's name is usually "family" or "self", not shopping.
- If genuinely unclear, use "misc" with low confidence rather than guessing wildly.`;

/**
 * Classify rows. Order of precedence:
 *   1. learned merchant memory (free, instant, reflects the user's own corrections)
 *   2. Claude, in batches, for whatever is left
 *   3. keyword fallback if there is no API key or the call fails
 */
export async function classifyRows(userId, rows) {
  const memRes = await q("SELECT * FROM merchant_memory WHERE user_id=$1", [userId]);
  const memory = new Map(memRes.rows.map(m => [m.pattern, m]));

  const out = new Array(rows.length);
  const unknown = [];

  rows.forEach((r, i) => {
    const pattern = normaliseMerchant(r.description);
    const hit = pattern && memory.get(pattern);
    if (hit) {
      out[i] = {
        category: hit.category,
        subcategory: hit.subcategory,
        scope: hit.scope || "personal",
        reimbursable: hit.reimb_hint === "yes",
        confidence: 0.95,
        reason: "learned from your past corrections",
        via: "memory",
      };
    } else {
      unknown.push({ i, pattern, ...r });
    }
  });

  if (unknown.length && client) {
    const known = memRes.rows.map(m => m.subcategory).filter(Boolean);
    const vocab = Array.from(new Set(known)).slice(0, 40);
    const CHUNK = 40;
    for (let s = 0; s < unknown.length; s += CHUNK) {
      const chunk = unknown.slice(s, s + CHUNK);
      try {
        const answers = await askClaude(chunk, vocab);
        chunk.forEach((row, j) => {
          const a = answers.find(x => Number(x.i) === j);
          out[row.i] = a ? sanitise(a, row) : { ...keywordGuess(row.description, row.direction), scope: "personal", reimbursable: false, via: "keyword" };
        });
      } catch (err) {
        console.error("classifier fell back to keywords:", err.message);
        chunk.forEach(row => {
          out[row.i] = { ...keywordGuess(row.description, row.direction), scope: "personal", reimbursable: false, via: "keyword" };
        });
      }
    }
  } else {
    unknown.forEach(row => {
      out[row.i] = { ...keywordGuess(row.description, row.direction), scope: "personal", reimbursable: false, via: "keyword" };
    });
  }

  return out;
}

async function askClaude(chunk, vocab) {
  const payload = chunk.map((r, j) => ({
    i: j,
    date: r.date,
    narration: String(r.description || "").slice(0, 140),
    amount: r.amount,
    direction: r.direction,
    account: r.accountName || "",
  }));

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{
      role: "user",
      content:
        (vocab.length ? `Subcategories already in use — reuse these when they fit:\n${vocab.join(", ")}\n\n` : "") +
        `Rows:\n${JSON.stringify(payload)}`,
    }],
  });

  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("classifier returned no JSON array");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sanitise(a, row) {
  const cat = CAT_KEYS.includes(a.category) ? a.category : null;
  const dirOk = cat && dirAllowed(cat, row.direction);
  return {
    category: dirOk ? cat : keywordGuess(row.description, row.direction).category,
    subcategory: a.subcategory ? String(a.subcategory).slice(0, 40) : null,
    scope: SCOPES.includes(a.scope) ? a.scope : "personal",
    reimbursable: Boolean(a.reimbursable),
    confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0.5)),
    reason: String(a.reason || "").slice(0, 80),
    via: "ai",
  };
}

/** Called whenever the user overrides a category — this is what makes it learn. */
export async function remember(userId, description, { category, subcategory, scope, reimb }) {
  const pattern = normaliseMerchant(description);
  if (!pattern || !category) return;
  await q(
    `INSERT INTO merchant_memory (user_id, pattern, category, subcategory, scope, reimb_hint, origin)
     VALUES ($1,$2,$3,$4,$5,$6,'learned')
     ON CONFLICT (user_id, pattern) DO UPDATE
       SET category=$3, subcategory=$4, scope=$5, reimb_hint=$6,
           hits=merchant_memory.hits+1, updated_at=now()`,
    [userId, pattern, category, subcategory || null, scope || "personal",
     reimb && reimb !== "none" ? "yes" : "no"]
  );
}
