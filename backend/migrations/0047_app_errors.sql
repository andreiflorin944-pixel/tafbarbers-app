-- Erorile din aplicația de pe telefon (o închidere neașteptată, un ecran care nu se poate afișa), ca să le putem
-- repara fără să-i cerem clientului detalii. Doar textul erorii și versiunea aplicației; păstrăm ultimele 300.
CREATE TABLE app_errors (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  platform   TEXT NOT NULL DEFAULT '',
  version    TEXT NOT NULL DEFAULT '',
  fatal      INTEGER NOT NULL DEFAULT 0,
  message    TEXT NOT NULL,
  stack      TEXT NOT NULL DEFAULT '',
  client_id  TEXT
);
CREATE INDEX app_errors_created ON app_errors(created_at);
