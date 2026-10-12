-- Administratorul de locație e repartizat pe o unitate: vede programările, concediile, statisticile și rapoartele doar de acolo.
-- Gol = toate locațiile (ca înainte).
ALTER TABLE admins ADD COLUMN location_id TEXT REFERENCES locations(id);
