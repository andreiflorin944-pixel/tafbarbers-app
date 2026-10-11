-- Jurnalul programării: ce s-a schimbat din panou sau din aplicația echipei (mutată, alt serviciu, alt preț sau reducere,
-- neprezentare, readusă la confirmată, plată anulată). Restul (creată, acceptată, încheiată, anulată, mesaje, plăți) se citește din programare.
CREATE TABLE booking_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  admin_id   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_booking_events_booking ON booking_events(booking_id, id);
