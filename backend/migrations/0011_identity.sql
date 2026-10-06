-- Profil client și TAF Identity: data nașterii, poză de profil, descrierea tunsorii dorite
-- și pozele ei (ale clientului, vizibile echipei) plus poze doar pentru echipă.
ALTER TABLE clients ADD COLUMN birth_date TEXT;
ALTER TABLE clients ADD COLUMN photo_url TEXT;
ALTER TABLE clients ADD COLUMN identity_note TEXT NOT NULL DEFAULT '';
-- Cine a urcat poza (clientul); NULL = panoul.
ALTER TABLE media ADD COLUMN client_id TEXT;

CREATE TABLE client_photos (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  media_id   TEXT NOT NULL,
  private    INTEGER NOT NULL DEFAULT 0,  -- 1 = urcată de echipă, clientul n-o vede
  caption    TEXT NOT NULL DEFAULT '',
  added_by   TEXT,                        -- id-ul contului de echipă; NULL = clientul
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_client_photos ON client_photos(client_id, private);
