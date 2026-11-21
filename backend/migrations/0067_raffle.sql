-- Tombola săptămânală: fiecare extragere (câștigătorul, premiul, câți au participat și cine a extras).
-- `pool` = lista clienților care au participat (doar id-uri), ca dovadă a extragerii.
CREATE TABLE raffle_draws (
  id         TEXT PRIMARY KEY,
  week       TEXT NOT NULL,                 -- lunea săptămânii (AAAA-LL-ZZ, ora salonului)
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  prize      TEXT NOT NULL,
  bonus_id   TEXT,                          -- beneficiul primit (Bonusurile mele)
  entries    INTEGER NOT NULL,
  pool       TEXT NOT NULL DEFAULT '[]',
  status     TEXT NOT NULL DEFAULT 'won' CHECK (status IN ('won','cancelled')),
  drawn_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  drawn_by   TEXT
);
CREATE INDEX idx_raffle_week ON raffle_draws(week, status);
CREATE INDEX idx_raffle_client ON raffle_draws(client_id, status);
