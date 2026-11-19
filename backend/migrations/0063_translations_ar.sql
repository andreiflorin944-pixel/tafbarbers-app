-- Limba arabă: tabelul de traduceri primea doar 'en' și 'fr'. Îl refacem ca să primească și 'ar'
-- (traducerile existente rămân neschimbate).
CREATE TABLE translations_new (
  lang       TEXT NOT NULL CHECK (lang IN ('en','fr','ar')),
  hash       TEXT NOT NULL,
  ro         TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  manual     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (lang, hash)
);
INSERT INTO translations_new (lang, hash, ro, text, manual, updated_at)
  SELECT lang, hash, ro, text, manual, updated_at FROM translations;
DROP TABLE translations;
ALTER TABLE translations_new RENAME TO translations;
