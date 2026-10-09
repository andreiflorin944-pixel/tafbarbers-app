-- Logare cu Apple sau Google: contul extern (provider + id-ul lui) legat de un client.
CREATE TABLE client_identities (
  provider   TEXT NOT NULL CHECK (provider IN ('apple','google')),
  subject    TEXT NOT NULL,                       -- id-ul utilizatorului la Apple / Google („sub” din token)
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_client_identities_client ON client_identities(client_id);

-- Prima logare cu Apple / Google, înainte să știm numărul de telefon: tichet scurt pentru completarea contului.
CREATE TABLE social_tickets (
  id         TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  email      TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL
);
