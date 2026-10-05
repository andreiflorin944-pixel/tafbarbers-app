-- TAFBarbers: schema inițial (platformă proprie, fără Barberly)
-- Prețuri în bani (1 leu = 100), ore în minute de la miezul nopții, timpi în ISO UTC.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE services (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL,
  price_bani   INTEGER NOT NULL,
  color        TEXT NOT NULL DEFAULT '#3B3FE0',
  image_url    TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE barbers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'Barber',
  bio        TEXT NOT NULL DEFAULT '',
  photo_url  TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

-- Ce servicii face fiecare frizer (lipsă rând = nu face).
CREATE TABLE barber_services (
  barber_id  TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (barber_id, service_id)
);

-- Program săptămânal per frizer; weekday 0 = duminică. Mai multe intervale pe zi = pauze.
CREATE TABLE working_hours (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  barber_id  TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min  INTEGER NOT NULL,
  end_min    INTEGER NOT NULL CHECK (end_min > start_min)
);
CREATE INDEX idx_hours_barber ON working_hours(barber_id, weekday);

-- Concedii, pauze ad-hoc, zile libere.
CREATE TABLE time_off (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  barber_id  TEXT REFERENCES barbers(id) ON DELETE CASCADE, -- NULL = tot salonul închis
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE clients (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,  -- format E.164, ex. +40712345678
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT,
  lang          TEXT NOT NULL DEFAULT 'ro',
  marketing_sms   INTEGER NOT NULL DEFAULT 0,
  marketing_email INTEGER NOT NULL DEFAULT 0,
  marketing_push  INTEGER NOT NULL DEFAULT 1,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE bookings (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id),
  barber_id   TEXT NOT NULL REFERENCES barbers(id),
  service_id  TEXT NOT NULL REFERENCES services(id),
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  price_bani  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  source      TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','admin','web')),
  note        TEXT NOT NULL DEFAULT '',
  reminder_24h_at TEXT,
  reminder_2h_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cancelled_at TEXT
);
CREATE INDEX idx_bookings_barber_time ON bookings(barber_id, starts_at);
CREATE INDEX idx_bookings_client ON bookings(client_id, starts_at);
CREATE INDEX idx_bookings_reminders ON bookings(status, starts_at);

-- Coduri de login prin SMS.
CREATE TABLE otp_codes (
  phone      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('client','admin')),
  subject_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE admins (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  barber_id     TEXT REFERENCES barbers(id) -- frizerul vede doar programările lui, dacă e setat
);

-- Bannere de marketing din aplicație (pagina Acasă).
CREATE TABLE promos (
  id          TEXT PRIMARY KEY,
  kicker      TEXT NOT NULL,
  title       TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  cta         TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'pricetag',
  action_type TEXT NOT NULL CHECK (action_type IN ('service','url','book')),
  action_value TEXT,
  translations TEXT NOT NULL DEFAULT '{}', -- JSON: {"en":{...},"fr":{...}}
  starts_at   TEXT,
  ends_at     TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE push_tokens (
  token      TEXT PRIMARY KEY,           -- Expo push token
  client_id  TEXT REFERENCES clients(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Campanii: push / e-mail / SMS cu oferte.
CREATE TABLE campaigns (
  id          TEXT PRIMARY KEY,
  channel     TEXT NOT NULL CHECK (channel IN ('push','email','sms')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  scheduled_at TEXT,
  sent_at     TEXT,
  recipients  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Jurnal pentru fiecare mesaj trimis (reminder, OTP, campanie).
CREATE TABLE message_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- otp | reminder_24h | reminder_2h | confirm | cancel | campaign
  recipient   TEXT NOT NULL,
  booking_id  TEXT,
  campaign_id TEXT,
  status      TEXT NOT NULL,             -- sent | failed
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
