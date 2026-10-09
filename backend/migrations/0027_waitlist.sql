-- Lista de așteptare: clientul care nu găsește oră liberă într-o zi cere să fie anunțat dacă se eliberează un loc
-- (serviciu + frizer opțional + interval din zi). Nu se face nicio programare automată: primește doar un mesaj.
CREATE TABLE waitlist (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id),
  service_id   TEXT NOT NULL REFERENCES services(id),
  barber_id    TEXT REFERENCES barbers(id),          -- NULL = orice frizer
  day          TEXT NOT NULL,                        -- ziua locală AAAA-LL-ZZ
  part         TEXT NOT NULL DEFAULT 'any' CHECK (part IN ('any','morning','afternoon','evening')),
  -- waiting = încă n-a primit nimic; notified = a primit cel puțin un mesaj (mai poate primi până la limită);
  -- booked = și-a făcut programare în ziua aceea; expired = ziua a trecut; removed = scos de client sau din panou.
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','notified','booked','expired','removed')),
  notify_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at TEXT,
  last_slot    TEXT,                                 -- ora (ISO) din ultimul mesaj
  removed_by   TEXT CHECK (removed_by IN ('client','staff')),
  closed_at    TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_waitlist_open ON waitlist(status, day, created_at);
CREATE INDEX idx_waitlist_client ON waitlist(client_id, status);

-- Ce loc liber i s-a anunțat fiecărei înscrieri: un loc eliberat se anunță o singură dată aceleiași persoane,
-- iar pe aceeași oră se anunță doar câțiva oameni odată (primii înscriși), apoi următorii dacă locul e tot liber.
CREATE TABLE waitlist_offers (
  entry_id   TEXT NOT NULL REFERENCES waitlist(id),
  slot_start TEXT NOT NULL,
  barber_id  TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (entry_id, slot_start)
);
CREATE INDEX idx_waitlist_offers_slot ON waitlist_offers(slot_start, barber_id, sent_at);
