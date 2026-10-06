-- Abonamente la tuns și plata confirmată de frizer la fiecare programare finalizată.
CREATE TABLE plans (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_bani  INTEGER NOT NULL,
  period_days INTEGER NOT NULL,
  cuts        INTEGER,                      -- câte tunsori intră; NULL = nelimitat
  service_ids TEXT NOT NULL DEFAULT '',     -- serviciile acoperite (listă cu virgulă); gol = toate
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Abonamentul cumpărat de un client. Numele, prețul și regulile se copiază din plan,
-- ca modificările ulterioare ale planului să nu schimbe abonamentele deja vândute.
CREATE TABLE subscriptions (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_id      TEXT,
  name         TEXT NOT NULL,
  price_bani   INTEGER NOT NULL,
  cuts_total   INTEGER,
  cuts_used    INTEGER NOT NULL DEFAULT 0,
  service_ids  TEXT NOT NULL DEFAULT '',
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  note         TEXT NOT NULL DEFAULT '',
  created_by   TEXT,                        -- contul de echipă care l-a activat (plătit la salon)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cancelled_at TEXT
);
CREATE INDEX idx_subscriptions_client ON subscriptions(client_id, ends_at);

-- Cum s-a plătit o programare finalizată: suma încasată sau pe abonament.
ALTER TABLE bookings ADD COLUMN payment TEXT CHECK (payment IN ('paid','subscription'));
ALTER TABLE bookings ADD COLUMN paid_bani INTEGER;
ALTER TABLE bookings ADD COLUMN subscription_id TEXT;
ALTER TABLE bookings ADD COLUMN bonus_id TEXT;
ALTER TABLE bookings ADD COLUMN completed_at TEXT;
ALTER TABLE bookings ADD COLUMN completed_by TEXT;
