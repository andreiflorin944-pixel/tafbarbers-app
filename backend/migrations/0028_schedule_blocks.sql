-- Blocuri în programul frizerilor: pauză de masă, liber, educațional, altceva (cu nume) și „Doar membri TAF Club”.
-- Primele patru scot orele din programările online; orele „doar membri” rămân libere numai pentru clienții
-- cu abonament activ sau marcați manual ca membri. Concediile pe zile întregi rămân în time_off.
CREATE TABLE schedule_blocks (
  id         TEXT PRIMARY KEY,
  barber_id  TEXT REFERENCES barbers(id) ON DELETE CASCADE,   -- NULL = toți frizerii
  kind       TEXT NOT NULL CHECK (kind IN ('lunch','off','education','other','members')),
  label      TEXT NOT NULL DEFAULT '',                         -- numele pentru „Altceva” (opțional la celelalte)
  day        TEXT,                                             -- o singură dată: ziua locală AAAA-LL-ZZ
  weekdays   TEXT,                                             -- recurent: zilele săptămânii, ex. ',1,3,5,' (0 = duminică)
  start_min  INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min    INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440 AND end_min > start_min),
  from_day   TEXT,                                             -- recurent: de când se aplică
  until_day  TEXT,                                             -- recurent: până când (inclusiv); NULL = fără sfârșit
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK ((day IS NULL) <> (weekdays IS NULL))
);
CREATE INDEX idx_blocks_day ON schedule_blocks(day);
CREATE INDEX idx_blocks_barber ON schedule_blocks(barber_id);

-- Membru TAF Club pus de mână din fișa clientului (pe lângă cei cu abonament activ).
ALTER TABLE clients ADD COLUMN club_member INTEGER NOT NULL DEFAULT 0;
