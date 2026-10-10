-- Traducerile în engleză și franceză ale textelor scrise în panou (servicii, frizeri, produse, abonamente, despre salon,
-- regulamente, campanii, bonusuri). Cheia e textul românesc: când româna se schimbă se face o traducere nouă,
-- iar corectura de mână a textului vechi nu se mai folosește.
CREATE TABLE translations (
  lang       TEXT NOT NULL CHECK (lang IN ('en','fr')),
  hash       TEXT NOT NULL,              -- sha256 al textului românesc
  ro         TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',   -- gol = nu s-a putut traduce automat (aplicația arată româna)
  manual     INTEGER NOT NULL DEFAULT 0, -- 1 = corectată de mână în panou; traducerea automată nu o mai schimbă
  updated_at TEXT NOT NULL,
  PRIMARY KEY (lang, hash)
);
