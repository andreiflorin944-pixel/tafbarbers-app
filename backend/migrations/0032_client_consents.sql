-- Dovada acordurilor („semnătura”, GDPR art. 7 alin. 1): câte un rând de fiecare dată când clientul acceptă termenii și
-- politica de confidențialitate sau își dă / își retrage acordul pentru oferte.
CREATE TABLE client_consents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       TEXT NOT NULL REFERENCES clients(id),
  source          TEXT NOT NULL,                  -- register (cont nou cu cod), social (Apple / Google), first_login (client adăugat din panou), login, profile
  terms           INTEGER NOT NULL DEFAULT 0,     -- 1 = a acceptat termenii și condițiile
  privacy         INTEGER NOT NULL DEFAULT 0,     -- 1 = a acceptat politica de confidențialitate
  marketing       INTEGER,                        -- 1 = vrea oferte, 0 = nu vrea; NULL = acordul pentru oferte nu s-a schimbat aici
  channels        TEXT NOT NULL DEFAULT '',       -- canalele de oferte pornite după acest pas (push,email,sms)
  terms_version   TEXT,                           -- „Ultima actualizare” a termenilor în acel moment
  privacy_version TEXT,                           -- „Ultima actualizare” a politicii de confidențialitate în acel moment
  ip              TEXT,                           -- adresa IP completă (CF-Connecting-IP); se șterge odată cu contul
  user_agent      TEXT,                           -- se șterge odată cu contul
  lang            TEXT,
  channel         TEXT,                           -- app sau web
  anonymized_at   TEXT,                           -- contul a fost șters: au rămas doar data și ce a acceptat
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_client_consents_client ON client_consents(client_id, id);
