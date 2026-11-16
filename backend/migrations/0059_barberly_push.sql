-- Programările noastre trimise în calendarul Barberly (cât timp se lucrează pe ambele), ca ora să fie ocupată și acolo.
-- Un rând pe programarea noastră: id-ul ei din Barberly, ce s-a trimis ultima dată și cum a mers.
CREATE TABLE barberly_outbox (
  booking_id   TEXT PRIMARY KEY,
  barberly_id  TEXT,                                -- id-ul programării în Barberly (null până merge prima trimitere)
  state        TEXT NOT NULL CHECK (state IN ('synced', 'error', 'cancelled')),
  starts_at    TEXT,                                -- ora trimisă (ca să se vadă când s-a mutat la noi)
  ends_at      TEXT,
  barber_id    TEXT,
  tries        INTEGER NOT NULL DEFAULT 0,          -- încercări nereușite la rând (după 5 nu se mai încearcă singur)
  detail       TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX barberly_outbox_state ON barberly_outbox (state, updated_at);
