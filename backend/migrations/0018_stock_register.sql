-- Acordul separat pentru oferte, NIR cu mișcările de stoc, metoda de plată (numerar / card) și pregătirea plății online.
ALTER TABLE clients ADD COLUMN marketing_consent_at TEXT; -- când a bifat (sau a schimbat) acordul pentru oferte

-- Produse doar pentru salon (ceară, lame, șampon folosit la spălat), cu stoc, dar care nu apar în magazinul din aplicație.
ALTER TABLE products ADD COLUMN for_sale INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'buc';
ALTER TABLE products ADD COLUMN cost_bani INTEGER; -- ultimul preț de achiziție, fără TVA

-- Nota de intrare-recepție: marfa primită de la furnizor.
CREATE TABLE nir_docs (
  id           TEXT PRIMARY KEY,
  number       INTEGER NOT NULL UNIQUE,
  day          TEXT NOT NULL,          -- data recepției (YYYY-MM-DD)
  supplier     TEXT NOT NULL,
  supplier_cui TEXT NOT NULL DEFAULT '',
  invoice_no   TEXT NOT NULL DEFAULT '',
  invoice_day  TEXT,
  note         TEXT NOT NULL DEFAULT '',
  total_bani   INTEGER NOT NULL DEFAULT 0, -- fără TVA
  vat_bani     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cancelled_at TEXT
);

-- Toate intrările și ieșirile de produse (fișa de magazie). qty: + intrare, − ieșire.
CREATE TABLE stock_moves (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     TEXT NOT NULL,
  qty            INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('nir','nir_anulat','vanzare','vanzare_anulata','consum','casare','ajustare')),
  nir_id         TEXT,
  order_id       TEXT,
  unit_cost_bani INTEGER,
  vat_pct        INTEGER,
  note           TEXT NOT NULL DEFAULT '',
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_stock_moves_product ON stock_moves(product_id, created_at);
CREATE INDEX idx_stock_moves_day ON stock_moves(created_at);

-- Cum s-a încasat: numerar, card la POS, online (Stripe), transfer.
ALTER TABLE bookings ADD COLUMN pay_method TEXT;
ALTER TABLE subscriptions ADD COLUMN pay_method TEXT;
ALTER TABLE gift_cards ADD COLUMN pay_method TEXT;
ALTER TABLE gift_cards ADD COLUMN payment_ref TEXT; -- id-ul plății online
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN pay_method TEXT;
ALTER TABLE orders ADD COLUMN payment_ref TEXT;
