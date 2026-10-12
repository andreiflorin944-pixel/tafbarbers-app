-- „Ești lângă salon”: coordonatele fiecărei locații (pentru zona din jurul ei pe telefonul clientului)
-- și când a primit clientul ultima dată mesajul (cel mult de câteva ori pe săptămână).
ALTER TABLE locations ADD COLUMN lat REAL;
ALTER TABLE locations ADD COLUMN lng REAL;
ALTER TABLE clients ADD COLUMN nearby_at TEXT;
