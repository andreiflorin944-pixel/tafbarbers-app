-- Coduri de reducere pentru cardurile cadou (ex. campania de Crăciun): generate din panou, cu procent sau sumă fixă,
-- număr de folosiri pe cod și dată de expirare. Cardul își păstrează valoarea întreagă; cumpărătorul plătește mai puțin.
CREATE TABLE gift_promo_codes (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  batch       TEXT NOT NULL DEFAULT '',            -- numele seriei (ex. „Crăciun Instagram”), ca să le vezi grupate
  kind        TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value       INTEGER NOT NULL,                    -- procent (1-90) sau lei
  max_uses    INTEGER,                             -- NULL = nelimitat
  expires_day TEXT,                                -- YYYY-MM-DD inclusiv, ora salonului; NULL = fără expirare
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_gift_promo_batch ON gift_promo_codes(batch);

-- Cât a plătit cumpărătorul (NULL = valoarea cardului) și cu ce cod.
ALTER TABLE gift_cards ADD COLUMN price_bani INTEGER;
ALTER TABLE gift_cards ADD COLUMN promo_code_id TEXT;
CREATE INDEX idx_gift_cards_promo ON gift_cards(promo_code_id);
