-- „Întârzii”: clientul anunță din aplicație că ajunge mai târziu (5–30 de minute, cu o notiță opțională).
-- Frizerul programării și administratorii primesc anunț pe telefon; panoul și aplicația echipei arată întârzierea la programare.
ALTER TABLE bookings ADD COLUMN late_min INTEGER;
ALTER TABLE bookings ADD COLUMN late_note TEXT;
ALTER TABLE bookings ADD COLUMN late_at TEXT;
ALTER TABLE bookings ADD COLUMN late_count INTEGER NOT NULL DEFAULT 0;
