-- Poze încărcate din panou (logo, servicii, frizeri). Panoul le micșorează înainte de urcare.
CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
