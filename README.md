# Khata Book

A household ledger. Upload bank and card statements, let them sort themselves, and watch the
months stack up.

Statement parsing was built and tested against **HDFC Bank**, **Axis Bank** and **Diners Club**;
other issuers go through the AI extractor or manual column mapping. Adding a bank means adding
its narration quirks, not new code.

> Forked from a working single-user instance to be built out as a product. The original's
> ledger data does not come with it — this repo starts empty, and every table is per-user from
> the schema up.

---

## What it does

**Statements in.** Upload whatever your bank hands you — PDF, CSV, or the fixed-width `.txt`
HDFC gives you. Claude reads the file itself: it skips the letterhead, your address, the account
and card numbers, the credit-limit and reward-point blocks, and picks out just the transactions,
including the ones whose narration wraps over two or three lines. Password-protected PDFs are
asked for the password once, and it is remembered per account (encrypted) for next time. Rows you
have already imported are flagged as duplicates and left unticked, so re-uploading an overlapping
statement is safe. Without an API key you get the old behaviour instead — the importer guesses the
header row and you point at the columns by hand.

**Or just paste the SMS.** For day-to-day spending there is a box on the Import page that takes
the alerts your bank sends when money moves — one, or a whole day of them at once. Claude reads
the amount, the payee and the direction, and the last four digits in the message pick the account,
so nothing has to be chosen by hand. OTPs, offers and due-date reminders are ignored. Set each
account's last four digits under Settings for the matching to work.

Anything already filed for the same day and amount comes back unticked, even when the wording
differs — an SMS says `Swiggy` where the statement will later say `WWW SWIGGY COMGURGAON`, and
without that check the two would double up. So the useful rhythm is: paste alerts as you spend,
then upload the statement at month end as the reconciliation.

**Sorted, and it learns.** Each row goes through three stages, in order:

1. **Memory** — if you have ever corrected this payee before, that answer is reused instantly. Free.
2. **Claude** — anything new is sent in batches of 40. It picks a category, invents a specific
   subcategory (`Instamart`, `Fuel`, `School Fees`, `Team Dinner`), decides whether the spend is
   personal / household / official, and flags things that look reimbursable.
3. **Keywords** — if there's no API key or the call fails, ~160 Indian merchant rules take over.

Every time you change a category in the ledger, the payee is written back into memory. The
classifier gets cheaper and more accurate the longer you use it. What it has learned is visible
and editable under Settings.

**Month on month.** The Trends page is the point of the whole thing. Pick a start month
(January 2026 by default), and every category gets a row with a cell per month, shaded by
intensity. Switch to subcategories to see Swiggy split from Instamart. Tick any rows to plot them
against each other.

**Claims.** Any expense can be flagged reimbursable — team meals, client cabs, work travel.
They move through *not claimed → filed → settled*, with a running total of what you're owed
sitting in the sidebar.

**People.** Gifts and family transfers are filed against people you add yourself, with an
occasion note and a per-person monthly chart.

**Holdings.** Every share and fund keeps an append-only price log. Enter 200 at purchase, log 300
when you review, log 250 later — all three are kept, numbered, with the percentage move between
each, drawn as a line against your cost basis. Same chart for the whole portfolio. Fixed deposits
accrue on their own; other assets (PPF, EPF, gold, balances) feed into net worth.

---

## Deploying on Railway

Railway is the right host here: one service, one Postgres, one deploy. (Vercel would work for the
front end but you'd need a separate database and the import route would run into serverless
timeouts on large statements. Not worth the extra moving part.)

### 1. Push to GitHub

```bash
cd khata
git init
git add .
git commit -m "Khata: household ledger"
gh repo create khata --private --source=. --push
# or create the repo on github.com and:
# git remote add origin git@github.com:YOU/khata.git && git push -u origin main
```

### 2. Create the Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → pick `khata`.
2. In the same project: **New** → **Database** → **Add PostgreSQL**.

### 3. Set the variables

On the app service → **Variables**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — type it exactly, Railway resolves the reference |
| `JWT_SECRET` | output of `openssl rand -base64 48` |
| `ANTHROPIC_API_KEY` | your key from [console.anthropic.com](https://console.anthropic.com) |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` |
| `SIGNUP_ENABLED` | `false` |
| `NODE_ENV` | `production` |

Don't set `PORT` — Railway provides it.

### 4. Deploy and open

Railway builds and starts on its own. Under **Settings → Networking**, click
**Generate Domain**. Open it.

The tables are created automatically on first boot. The first account you create becomes the
owner, and because `SIGNUP_ENABLED=false`, nobody else can register afterwards. Creating that
account also seeds your three accounts and four family members.

### 5. Import January

Download a statement from HDFC net banking, Axis, and your Diners card — PDF, CSV or `.txt`, in
whatever format they offer. Pick the account, upload, give the password if the PDF asks for one,
review what came back, file. Repeat per month. The Trends page starts working from the second
month on.

**Cost:** Railway's Hobby plan is $5/month including the database. Claude Haiku classification
runs roughly ₹1–3 per month of statements, and drops as memory fills in.

### If the build fails

**`EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'`** — the build command is
running `npm ci` a second time. Nixpacks already installs during its own install phase and then
mounts a cache volume inside `node_modules`, which `npm ci` can't delete. `buildCommand` in
`railway.json` must be `npm run build` and nothing more.

**`vite: not found`** — Railway installs with dev dependencies omitted, so anything needed at
build time has to sit in `dependencies`, not `devDependencies`. That's why `vite`, `react`,
`recharts` and `papaparse` are all in `dependencies` here. Leave them there.

**Healthcheck fails / "1 replica never became healthy"** — the app built fine but can't reach the
database. Open the **Deploy Logs** tab (not Build Logs) and look at the last few lines; the app
now prints exactly what went wrong and retries for about 40 seconds. Most likely:

- `DATABASE_URL is not set` — set it to `${{Postgres.DATABASE_URL}}`, braces included.
- `host ... did not resolve` — the Postgres service isn't in this same Railway project.
- `does not support SSL` — set `PGSSL=false`. (Railway's private network has no TLS; the app
  detects `.railway.internal` and disables it automatically, but this forces it.)
- `server requires SSL` — set `PGSSL=true`. Needed for Neon, Supabase and similar.

Once it's up, `https://your-app.up.railway.app/api/health` returns the database host and whether
TLS is on, which is the fastest way to confirm what it actually connected to.

---

## Running locally

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL and JWT_SECRET
npm run dev               # API on :3000, UI on :5173
```

You need a Postgres running somewhere. Quickest:

```bash
docker run -d --name khata-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=khata -e POSTGRES_DB=khata postgres:16
# DATABASE_URL=postgres://postgres:khata@localhost:5432/khata?sslmode=disable
```

To test a production build: `npm run build && npm start`, then open `http://localhost:3000`.

---

## Installing it as an app

Khata ships a web manifest and icons, so it installs from the browser onto a desktop or a home
screen and opens in its own window with no address bar. Nothing to download and no separate build
— it is the same deployed site.

**Windows or macOS, Chrome or Edge.** Open your Railway URL, then use the install icon at the
right-hand end of the address bar, or the three-dot menu → *Cast, save and share* → *Install page
as app* (Chrome) / *Apps* → *Install this site as an app* (Edge). You get a desktop shortcut and a
Start-menu entry carrying the ख mark.

**iPad or iPhone.** Safari only: Share → *Add to Home Screen*. Safari ignores the manifest's icons
and uses `apple-touch-icon.png`, which is why that file exists separately.

**Android.** Chrome offers *Install app* from the three-dot menu. The maskable icons are what keep
the glyph from being clipped by a circle or squircle crop.

If the install option doesn't appear, hard-reload once (Ctrl+Shift+R) so the browser re-reads the
manifest instead of a cached copy. Chrome's DevTools → Application → Manifest will say what is
wrong if anything is.

There is deliberately **no service worker**. Installability hasn't required one since Chrome 112 on
desktop, and caching a shell on a ledger is how you end up reading last week's figures after a
deploy and believing them. That means the app needs a connection to load, which for something whose
data lives in Postgres it does anyway.

To change the mark — a different colour, a different letter — edit and re-run
`python3 tools/make_icons.py`. It needs Pillow and `fonts-lohit-deva`, writes straight into
`client/public/`, and renders at 4x before downsampling so the hairlines stay clean. `favicon.svg`
is separate: it carries the glyph as traced outlines rather than text, so it renders on a machine
with no Devanagari font installed.

---

## Layout

```
db/schema.sql            every table; re-applied safely on each boot
server/
  index.js               Express: auth routes, API mount, serves the built client
  db.js                  pg pool, migration runner, new-user seeding
  auth.js                bcrypt + JWT in an httpOnly cookie
  lib/taxonomy.js        the 30 fixed categories + keyword fallback rules
  lib/classify.js        memory → Claude → keywords, and the learning write-back
  lib/statementExtract.js  hands a whole statement to Claude, gets transaction rows back
  lib/pdfImport.js       decrypts a PDF and rebuilds its table from glyph positions
  lib/secret.js          encrypts the saved PDF passwords at rest
  routes/api.js          everything else: transactions, import, holdings, analytics
client/src/
  App.jsx                shell, navigation, the data store
  api.js                 fetch wrapper + all money/date/portfolio maths
  ui.jsx                 shared components, category colour lookup
  pages/                 one file per tab
client/public/           manifest and icons; Vite copies these to the root of dist/
tools/make_icons.py      regenerates the icon set from the ख glyph
```

**Adding a category** — one entry in `server/lib/taxonomy.js`. The UI reads the list from the
API, so nothing else needs touching. Subcategories need no code at all; they're free text and
the classifier invents them as needed.

---

## Iterating with Claude Code

```bash
npm install -g @anthropic-ai/claude-code
cd khata
claude
```

Useful things to ask for:

- "Add a page that shows spending by account so I can see HDFC vs Axis vs Diners side by side"
- "Email me a summary on the first of every month"
- "Add a year-on-year comparison to the Trends page"
- "Make the classifier tag which of my kids an education expense belongs to"

There's a `CLAUDE.md` in the repo with conventions so it stays consistent with what's here.

**Always** work on a branch and check the diff before pushing — Railway deploys `main`
automatically, and a bad push takes the app down until you fix it.

---

## Your data

It's in your Postgres and nowhere else. Two things go to Anthropic's API, and only if
`ANTHROPIC_API_KEY` is set:

- **Reading a statement.** The text of the file you upload is sent so Claude can find the
  transaction table. That means the whole page, not just the rows — the letterhead, your name and
  address, the masked account or card number, and the balances go with it. There is no way to
  find where the table starts without showing it the part before the table.
- **Sorting a row.** Only four fields: date, narration, amount, direction.

Anthropic does not train on API traffic. If you'd rather nothing left the server at all, leave
`ANTHROPIC_API_KEY` unset: you map the statement columns by hand and keyword rules do the sorting.
PDF decryption and everything else happen on your own server either way.

**Back up before you experiment.** Settings → *Download full backup* gives you the whole
database as JSON. Railway also does automatic Postgres backups on paid plans — worth turning on.
