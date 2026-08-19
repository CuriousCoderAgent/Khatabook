# Notes for Claude Code

Household expense ledger. One Postgres, deployed on Railway from `main`.

Forked from a working single-user instance and being built out as a product. Every table is
already keyed by `user_id`, but the code still assumes one owner in two places: `SIGNUP_ENABLED`
gates registration behind an env var rather than a real onboarding flow, and there is no billing,
plan or tenant concept anywhere. Read "the owner" in older comments as "the signed-in user".

## Stack

Express + `pg` (no ORM) on the back, React + Vite + Recharts on the front, one repo, one process.
`server/index.js` serves the API and the built client out of `dist/`.

**Native shells.** `ios/` and `android/` are Capacitor wrappers around the same client — added for
App Store / Play Store distribution, not a separate app. `capacitor.config.json` has no `server.url`
by default, which means an unconfigured build embeds `dist/` locally; before shipping, set
`server.url` to the deployed Railway domain so the WebView loads the real site instead. That's not
optional: auth is a same-origin httpOnly cookie and `client/src/api.js` calls relative `/api/...`
URLs, so a locally-bundled `dist/` has no origin to send that cookie to and every request 404s.
Run `npm run cap:sync` after any client build to refresh both native projects.

**SMS auto-capture (Android only).** `android/.../SmsReceiver.java` listens for bank alerts in the
background and forwards them to `POST /api/import/sms/device`, which runs the same
extract-then-classify pipeline as pasting a message by hand (`/api/import/sms`) and files the result
straight into the ledger — see `server/routes/devices.js`. It authenticates with a `device_tokens`
bearer token instead of the session cookie, because a broadcast receiver has no WebView to hold that
cookie; `SmsCapturePlugin.java` + `client/src/lib/smsCapture.js` are what let Settings issue one and
hand it to the OS permission flow. iOS has no equivalent — Apple gives no app access to the SMS
inbox — so this stays Android-only until a share-intent flow is built for iOS. Before a release
build, `android/app/src/main/res/values/strings.xml`'s `khata_api_base_url` needs the same deployed
domain as `capacitor.config.json`'s `server.url`, or the background listener has nowhere to POST to.

## Conventions that matter

**Database.** No migration tool. `db/schema.sql` is re-run on every boot, so every statement must
be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). To add a column, append
an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at the bottom of the file — never edit an existing
`CREATE TABLE`, or existing databases won't pick up the change.

**Money.** `NUMERIC(14,2)` in Postgres, which `pg` returns as a *string*. Always wrap in `Number()`
or the `N()` helper before arithmetic. Amounts are stored positive; `direction` (`in`/`out`) carries
the sign. Never store a negative amount.

**Dates.** `DATE` columns, `YYYY-MM-DD` strings everywhere in JS. Never construct `new Date()` from
a user string without going through `parseDate` in `client/src/pages/Import.jsx` — Indian statements
are `DD/MM/YYYY` and the JS parser reads those as American.

**Categories.** The 30 top-level keys in `server/lib/taxonomy.js` are the whole vocabulary and are
mirrored to the client via `/api/bootstrap`. Adding one there is enough. Subcategories are free
text with no table — the classifier invents them, the user edits them. Don't formalise them.

**Every category edit teaches.** `PATCH /api/transactions/:id` calls `remember()` when `cat`, `sub`
or `scope` changes. Anything new that mutates a transaction's category must do the same, or the
classifier quietly stops learning.

**Reading and sorting are separate calls with separate payloads.** `server/lib/statementExtract.js`
reads raw text — a whole statement, or pasted bank SMS alerts — and returns the four fields. It
gets the preamble too, because that is the only way to find where a statement's table starts.
`server/lib/classify.js` sorts already-parsed rows and gets only the four fields. Don't merge them
and don't widen what the classifier sees. Both degrade without a key: statement extraction falls
back to manual column mapping, classification to keyword rules. SMS has no fallback — without a
key there is nothing to parse it with.

**Transfers are not spending.** `invest`, `home_loan`, `cc_pay` and `self` all carry `both: true`
and are excluded from `isSpend()` in `client/src/ui.jsx`. Paying the Diners bill from HDFC would
otherwise double-count the whole month. Keep that exclusion in any new aggregate.

**Don't total spending by filtering on `isSpend()`.** Use `C.spent(rows)` and `C.invested(rows)`,
or `C.spendPart(t)` / `C.investPart(t)` for a single row. A home loan EMI splits across both: the
`principal` column is the part that buys the house and counts as investment, and the remainder is
interest and counts as spending. Filtering on the category alone drops that interest out of every
total. A car or personal loan EMI stays `emi` and is spending in full — nothing is left over at
the end of it. `principal` is NULL when the split isn't known, which counts the whole EMI as
asset; that flatters the figure, so anywhere it happens says so (`C.emiUnsplit(rows)`).

**Bootstrap is sequential on purpose.** Ten cheap reads in series; hosted Postgres plans cap
concurrent connections. Don't "optimise" it into a `Promise.all`.

**Auth.** JWT in an httpOnly cookie. Every route in `routes/api.js` sits behind `requireAuth`, and
every query filters on `user_id` — including nested ones, which go through a join on the parent
(see `ownsHolding`). A new table needs a `user_id` column and that same filter.

**No client-side storage.** State lives in React and the database. No localStorage.

## Style

Dense but readable. Comments explain *why*, not *what*. UI copy is sentence case, plain verbs,
no exclamation marks — read a few labels before writing new ones. Money is formatted with the
helpers in `client/src/api.js` (`inr`, `compact`), never raw `toLocaleString`.

Design language: greenbar accounting paper. Ledger green for money in, ledger red for money out,
aged gold for anything needing attention. Figures are always monospace and tabular. All colours
are CSS variables in `styles.css` — don't hardcode hex in components except for chart series.

## Testing a change

```bash
npm run build          # catches every JSX and import error
node --check server/**/*.js
```

There's no test suite. If you add one, Vitest fits the existing setup.

## Don't

- Don't add an ORM or a migration framework. The whole point is that it stays legible.
- Don't send more than the four fields (date, narration, amount, direction) to the classifier.
  (The statement extractor is the one exception, and only because it has to see the raw file.)
- Don't make price points editable. The append-only log is a deliberate feature — a price can be
  deleted to fix a typo, never overwritten.
