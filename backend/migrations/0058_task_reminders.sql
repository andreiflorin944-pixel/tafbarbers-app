-- Amintirile cu taskuri pentru frizeri: cu 10 minute înainte de începerea programului și la sfârșitul lui.
-- Fiecare cont de frizer le poate opri din aplicație (Meniu); pornite implicit.
ALTER TABLE admins ADD COLUMN notify_tasks INTEGER NOT NULL DEFAULT 1;

-- Ce amintire a plecat deja (o dată pe zi, pe frizer, la început și la sfârșit), ca rulările la 5 minute să nu o repete.
CREATE TABLE task_reminders (
  barber_id TEXT NOT NULL,
  day       TEXT NOT NULL,                       -- ziua locală AAAA-LL-ZZ
  kind      TEXT NOT NULL CHECK (kind IN ('start', 'end')),
  sent_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (barber_id, day, kind)
);
