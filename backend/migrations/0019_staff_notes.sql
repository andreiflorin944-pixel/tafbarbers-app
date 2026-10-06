-- Notițe pentru echipă: sarcini și scripturi de filmat pe care adminul le dă frizerilor.
CREATE TABLE staff_notes (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'script', 'note')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  barber_id  TEXT,                 -- NULL = pentru toată echipa
  due_day    TEXT,                 -- până când (YYYY-MM-DD), opțional
  done_at    TEXT,
  done_by    TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_staff_notes_barber ON staff_notes(barber_id, done_at);
