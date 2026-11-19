-- Serviciu gratuit (oferit de salon) la încheierea programării: apare în fișa clientului la „Servicii gratuite primite”.
ALTER TABLE bookings ADD COLUMN free INTEGER NOT NULL DEFAULT 0;

-- Rest de plată: clientul a plătit doar o parte; restul rămâne pe el și se încasează la o vizită următoare.
CREATE TABLE client_debts (
  id                 TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  booking_id         TEXT NOT NULL,             -- programarea la care a rămas restul
  amount_bani        INTEGER NOT NULL CHECK (amount_bani > 0),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by         TEXT,                      -- contul de echipă care a închis programarea
  settled_at         TEXT,                      -- încasat
  settled_by         TEXT,
  settled_method     TEXT,                      -- cash / card / transfer
  settled_booking_id TEXT,                      -- programarea la care s-a încasat (dacă a fost la încasare)
  cancelled_at       TEXT,                      -- iertat / șters de proprietar
  cancelled_by       TEXT
);
CREATE INDEX idx_client_debts_client ON client_debts(client_id, settled_at, cancelled_at);
CREATE INDEX idx_client_debts_booking ON client_debts(booking_id);
CREATE INDEX idx_client_debts_settled ON client_debts(settled_at);
