-- Recomandări și bonusuri.
ALTER TABLE clients ADD COLUMN referral_code TEXT;
ALTER TABLE clients ADD COLUMN referred_by TEXT;  -- clientul care l-a recomandat
CREATE UNIQUE INDEX idx_clients_referral ON clients(referral_code);
CREATE INDEX idx_clients_referred_by ON clients(referred_by);

-- Beneficiile unui client: reducere procentuală, sumă fixă, tunsoare gratuită sau alt beneficiu (text).
CREATE TABLE bonuses (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('percent','amount','free','other')),
  value       REAL,                         -- % sau lei; NULL la free/other
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','referral')),
  referral_of TEXT,                         -- clientul nou adus prin recomandare
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','cancelled')),
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  used_at     TEXT,
  used_by     TEXT                          -- contul de echipă care l-a marcat folosit
);
CREATE INDEX idx_bonuses_client ON bonuses(client_id, status);
