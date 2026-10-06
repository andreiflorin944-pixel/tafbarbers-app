-- Retenție și clienți noi: „Ne e dor de tine”, ore libere de ultim moment, carduri cadou,
-- poze înainte/după și linkul „Programează” (Google Maps, Instagram).
ALTER TABLE clients ADD COLUMN winback_at TEXT;
ALTER TABLE clients ADD COLUMN lastminute_at TEXT;

CREATE TABLE gift_cards (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  amount_bani     INTEGER NOT NULL,
  balance_bani    INTEGER NOT NULL,
  buyer_client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  recipient_name  TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT,
  message         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','used','cancelled')),
  paid_by         TEXT,            -- contul de echipă care a încasat cardul
  paid_at         TEXT,
  expires_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_gift_cards_buyer ON gift_cards(buyer_client_id);
CREATE INDEX idx_gift_cards_recipient ON gift_cards(recipient_phone);

ALTER TABLE bookings ADD COLUMN gift_card_id TEXT;
ALTER TABLE bookings ADD COLUMN gift_bani INTEGER;

CREATE TABLE before_after (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  before_media TEXT NOT NULL,
  after_media  TEXT NOT NULL,
  barber_id    TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_before_after_client ON before_after(client_id);

CREATE TABLE link_clicks (
  day TEXT NOT NULL,
  src TEXT NOT NULL,
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, src)
);
