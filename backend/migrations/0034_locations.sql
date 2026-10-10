-- Locațiile salonului (Setări → Locații). Fiecare frizer lucrează într-o singură locație; clientul alege întâi locația,
-- apoi frizerul, serviciul și ora. La început există o singură locație, făcută din numele și adresa salonului.
CREATE TABLE locations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',          -- gol = telefonul salonului (din Setări)
  photo_url  TEXT,
  active     INTEGER NOT NULL DEFAULT 1,        -- 0 = nu mai apare în aplicație, iar frizerii ei nu mai primesc programări
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO locations (id, name, address, sort)
  SELECT 'loc-main', coalesce(nullif(trim(json_extract(value, '$.name')), ''), 'TAFBarbers'), coalesce(json_extract(value, '$.address'), ''), 1
  FROM settings WHERE key = 'business';
-- Fără setări salvate: tot o locație, cu numele implicit.
INSERT OR IGNORE INTO locations (id, name, sort) VALUES ('loc-main', 'TAFBarbers', 1);

ALTER TABLE barbers ADD COLUMN location_id TEXT REFERENCES locations(id);
UPDATE barbers SET location_id = 'loc-main';

-- Locația programării (a frizerului în acel moment), ca istoricul să rămână corect dacă frizerul se mută.
ALTER TABLE bookings ADD COLUMN location_id TEXT REFERENCES locations(id);
UPDATE bookings SET location_id = (SELECT location_id FROM barbers WHERE barbers.id = bookings.barber_id);

-- Lista de așteptare pentru „orice frizer” ține de o locație (NULL = oricare locație).
ALTER TABLE waitlist ADD COLUMN location_id TEXT REFERENCES locations(id);
UPDATE waitlist SET location_id = 'loc-main';
