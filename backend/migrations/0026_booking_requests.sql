-- Cereri de programare: când proprietarul cere aprobare, programarea din aplicație intră ca „requested”
-- (ține ora ocupată) până când salonul o acceptă sau o refuză. SQLite nu poate schimba o regulă CHECK,
-- așa că tabelul se refac cu aceleași coloane, plus starea nouă și coloanele răspunsului.
PRAGMA defer_foreign_keys = true;

CREATE TABLE bookings_new (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id),
  barber_id   TEXT NOT NULL REFERENCES barbers(id),
  service_id  TEXT NOT NULL REFERENCES services(id),
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  price_bani  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('requested','confirmed','cancelled','completed','no_show')),
  source      TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','admin','web')),
  note        TEXT NOT NULL DEFAULT '',
  reminder_24h_at TEXT,
  reminder_2h_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cancelled_at TEXT,
  payment TEXT CHECK (payment IN ('paid','subscription')),
  paid_bani INTEGER,
  subscription_id TEXT,
  bonus_id TEXT,
  completed_at TEXT,
  completed_by TEXT,
  cancelled_by TEXT CHECK (cancelled_by IN ('client','staff')),
  cancelled_by_admin TEXT,
  tip_bani INTEGER,
  gift_card_id TEXT,
  gift_bani INTEGER,
  pay_method TEXT,
  online_paid_bani INTEGER,
  online_payment_ref TEXT,
  online_refunded_at TEXT,
  -- Răspunsul la cerere: accepted | refused | expired (nimeni n-a răspuns până la ora programării).
  request_outcome TEXT CHECK (request_outcome IN ('accepted','refused','expired')),
  request_answered_at TEXT,
  request_answered_by TEXT,           -- contul din echipă care a răspuns
  refuse_reason TEXT
);

INSERT INTO bookings_new (
  id, client_id, barber_id, service_id, starts_at, ends_at, price_bani, status, source, note, reminder_24h_at, reminder_2h_at,
  created_at, cancelled_at, payment, paid_bani, subscription_id, bonus_id, completed_at, completed_by, cancelled_by,
  cancelled_by_admin, tip_bani, gift_card_id, gift_bani, pay_method, online_paid_bani, online_payment_ref, online_refunded_at
)
SELECT
  id, client_id, barber_id, service_id, starts_at, ends_at, price_bani, status, source, note, reminder_24h_at, reminder_2h_at,
  created_at, cancelled_at, payment, paid_bani, subscription_id, bonus_id, completed_at, completed_by, cancelled_by,
  cancelled_by_admin, tip_bani, gift_card_id, gift_bani, pay_method, online_paid_bani, online_payment_ref, online_refunded_at
FROM bookings;

DROP TABLE bookings;
ALTER TABLE bookings_new RENAME TO bookings;

CREATE INDEX idx_bookings_barber_time ON bookings(barber_id, starts_at);
CREATE INDEX idx_bookings_client ON bookings(client_id, starts_at);
CREATE INDEX idx_bookings_reminders ON bookings(status, starts_at);
CREATE INDEX idx_bookings_starts ON bookings(starts_at);
