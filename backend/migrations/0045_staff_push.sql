-- Notificări pe telefon pentru echipă: telefoanele legate de conturile din panou (aplicația echipei),
-- separat de cele ale clienților (același telefon poate fi și client, și frizer).
CREATE TABLE staff_push_tokens (
  token      TEXT PRIMARY KEY,           -- Expo push token
  admin_id   TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX staff_push_tokens_admin ON staff_push_tokens(admin_id);

-- Fiecare își oprește sau pornește din aplicația echipei anunțurile despre programări (implicit pornite).
ALTER TABLE admins ADD COLUMN notify_bookings INTEGER NOT NULL DEFAULT 1;
