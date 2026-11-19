-- Servicii oferite cadou la închiderea programării (ex. Spălat, Ceară): se adaugă în plus, cu 0 lei,
-- fără să schimbe prețul sau ora programării. Apar pe bon și în fișa clientului la „Servicii gratuite primite”.
CREATE TABLE booking_gifts (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id  TEXT NOT NULL,
  value_bani  INTEGER NOT NULL DEFAULT 0,     -- cât ar fi costat (prețul frizerului sau cel standard), pentru rapoarte
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by  TEXT                            -- contul de echipă care l-a oferit
);
CREATE INDEX idx_booking_gifts_booking ON booking_gifts(booking_id);

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
