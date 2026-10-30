-- Copierea programărilor din Barberly cât timp clienții se mută în aplicația nouă.
-- Barberly nu are export și nici API care să dea lista programărilor, dar trimite un e-mail la fiecare programare
-- nouă sau anulare. Un script din Gmail trimite aceste e-mailuri serverului, care face programarea și la noi.

-- Programarea din Barberly de la care vine (id-ul din linkul „Vezi programarea” sau, fără el, telefon + oră).
ALTER TABLE bookings ADD COLUMN barberly_ref TEXT;
CREATE UNIQUE INDEX idx_bookings_barberly_ref ON bookings(barberly_ref) WHERE barberly_ref IS NOT NULL;

-- Jurnalul e-mailurilor primite: fiecare o singură dată (după id-ul mesajului), cu ce s-a făcut din el.
CREATE TABLE barberly_inbox (
  message_id  TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  subject     TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,          -- new | cancel | change | unknown
  result      TEXT NOT NULL,          -- created | updated | cancelled | duplicate | past | ignored | error
  detail      TEXT NOT NULL DEFAULT '',
  booking_id  TEXT
);
CREATE INDEX idx_barberly_inbox_received ON barberly_inbox(received_at);
