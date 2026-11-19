-- Albumul de lucrări al fiecărui frizer: pozele cu tunsorile făcute, urcate de frizer (aplicația echipei) sau de patron (panou).
-- Clienții le văd în aplicație (profilul frizerului) și pe site. Poza în sine stă în `media`.
CREATE TABLE barber_album (
  id         TEXT PRIMARY KEY,
  barber_id  TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  media_id   TEXT NOT NULL,
  added_by   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_barber_album_barber ON barber_album (barber_id, created_at);
