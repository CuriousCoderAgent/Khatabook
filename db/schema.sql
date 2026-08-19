-- Khata schema. Safe to run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id       SERIAL PRIMARY KEY,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  kind     TEXT NOT NULL DEFAULT 'bank',   -- bank | card | cash | wallet
  last4    TEXT,
  archived BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS people (
  id       SERIAL PRIMARY KEY,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  relation TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  txn_date      DATE NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  amount        NUMERIC(14,2) NOT NULL,
  direction     TEXT NOT NULL,                       -- in | out
  category      TEXT NOT NULL DEFAULT 'misc',
  subcategory   TEXT,                                -- free text, AI may invent these
  scope         TEXT NOT NULL DEFAULT 'personal',    -- personal | household | official
  account_id    INT REFERENCES accounts(id) ON DELETE SET NULL,
  reimb         TEXT NOT NULL DEFAULT 'none',        -- none | pending | claimed | received
  person_id     INT REFERENCES people(id) ON DELETE SET NULL,
  note          TEXT,
  source        TEXT DEFAULT 'manual',               -- manual | import | sample
  batch_id      INT,
  fingerprint   TEXT,
  ai_confidence REAL,
  ai_reason     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tx_user_date  ON transactions (user_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS tx_user_cat   ON transactions (user_id, category);
CREATE INDEX IF NOT EXISTS tx_user_fp    ON transactions (user_id, fingerprint);

-- Every correction you make teaches the classifier. Checked before the AI is called.
CREATE TABLE IF NOT EXISTS merchant_memory (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,                 -- normalised merchant token
  category    TEXT NOT NULL,
  subcategory TEXT,
  scope       TEXT,
  reimb_hint  TEXT,
  hits        INT NOT NULL DEFAULT 1,
  origin      TEXT NOT NULL DEFAULT 'learned', -- learned | manual | ai
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, pattern)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id  INT REFERENCES accounts(id) ON DELETE SET NULL,
  filename    TEXT,
  row_count   INT,
  imported    INT,
  period_from DATE,
  period_to   DATE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holdings (
  id      SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol  TEXT NOT NULL,
  name    TEXT,
  kind    TEXT NOT NULL DEFAULT 'stock',   -- stock | mf | etf | gold | crypto | other
  notes   TEXT
);

CREATE TABLE IF NOT EXISTS lots (
  id         SERIAL PRIMARY KEY,
  holding_id INT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  qty        NUMERIC(18,6) NOT NULL,
  price      NUMERIC(18,4) NOT NULL,
  buy_date   DATE NOT NULL
);

-- Append-only by design. Nothing here is ever overwritten by a newer price.
CREATE TABLE IF NOT EXISTS price_points (
  id         SERIAL PRIMARY KEY,
  holding_id INT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  as_of      DATE NOT NULL,
  price      NUMERIC(18,4) NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pp_holding ON price_points (holding_id, as_of);

CREATE TABLE IF NOT EXISTS fixed_deposits (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank          TEXT NOT NULL,
  principal     NUMERIC(14,2) NOT NULL,
  rate          NUMERIC(6,3) NOT NULL,
  start_date    DATE NOT NULL,
  maturity_date DATE NOT NULL,
  compounding   INT NOT NULL DEFAULT 4,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  id       SERIAL PRIMARY KEY,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  kind     TEXT,
  value    NUMERIC(14,2) NOT NULL DEFAULT 0,
  as_of    DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS budgets (
  id       SERIAL PRIMARY KEY,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount   NUMERIC(14,2) NOT NULL,
  UNIQUE (user_id, category)
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pdf_password_enc TEXT;

-- One row per one-shot data load or migration that has already been applied.
-- Nothing writes to it yet; it is here so that when this app has real users and
-- needs a data fix, the fix has somewhere to record that it ran.
CREATE TABLE IF NOT EXISTS seed_runs (
  name    TEXT PRIMARY KEY,
  ran_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows_in INT,
  note    TEXT
);

-- Shares sold. Lots hold what is still owned, so without this a position that
-- was exited leaves no trace at all: the app could show what you hold and what
-- it is worth, but never what you sold, when, or what came of it.
-- cost_basis is per share and nullable on purpose — a sale out of stock bought
-- before the records begin has no knowable cost, and guessing one would invent
-- a profit. NULL means "proceeds known, return not".
CREATE TABLE IF NOT EXISTS sales (
  id         SERIAL PRIMARY KEY,
  holding_id INT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  qty        NUMERIC(18,6) NOT NULL,
  price      NUMERIC(18,4) NOT NULL,
  sell_date  DATE NOT NULL,
  cost_basis NUMERIC(18,4),
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_holding ON sales (holding_id, sell_date);

-- The part of a home loan EMI that pays down the loan rather than the interest
-- on it. Only that part buys you a slice of the house; the rest is the cost of
-- borrowing and is spending like any other. NULL means the split is not known
-- yet, in which case the whole EMI is treated as going into the asset — which
-- flatters the figure, so the UI says so wherever it does it.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS principal NUMERIC(14,2);
