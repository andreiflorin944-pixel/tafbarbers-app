-- Registrul plăților online (Stripe): fiecare plată primită prin webhook, indiferent pentru ce (programare, comandă,
-- card cadou, abonament). De aici se vede în panou ce s-a încasat online, ce s-a returnat și ce trebuie returnat de mână.
--   status: paid = păstrată (legată de ce s-a cumpărat) · refunded = returnată pe card · to_refund = de returnat (Stripe n-a putut singur)
CREATE TABLE online_payments (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('booking','order','gift','sub')),
  ref            TEXT NOT NULL,                -- id-ul programării / comenzii / cardului cadou / abonamentului
  client_id      TEXT,
  session_id     TEXT NOT NULL UNIQUE,         -- sesiunea Stripe Checkout (cs_...): același eveniment primit de două ori nu se numără de două ori
  payment_intent TEXT,                         -- plata Stripe (pi_...), cu care se face returnarea
  amount_bani    INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','refunded','to_refund')),
  note           TEXT NOT NULL DEFAULT '',     -- de ce s-a returnat sau trebuie returnată (anulată, plătită de două ori…)
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  refunded_at    TEXT,
  refunded_by    TEXT,                         -- 'stripe' (automat) sau contul din panou care a marcat-o returnată de mână
  refund_ref     TEXT                          -- returnarea Stripe (re_...)
);
CREATE INDEX idx_online_payments_ref ON online_payments(kind, ref);
CREATE INDEX idx_online_payments_created ON online_payments(created_at);
CREATE INDEX idx_online_payments_status ON online_payments(status);

-- Cererea de plată în aplicație trimisă de echipă pentru o programare (suma cerută, când și de cine).
ALTER TABLE bookings ADD COLUMN pay_request_bani INTEGER;
ALTER TABLE bookings ADD COLUMN pay_requested_at TEXT;
ALTER TABLE bookings ADD COLUMN pay_requested_by TEXT;

-- Plățile online de dinainte de registru (dacă au existat) intră și ele, ca să se vadă în panou.
INSERT OR IGNORE INTO online_payments (id, kind, ref, client_id, session_id, payment_intent, amount_bani, status, created_at, refunded_at, refunded_by)
  SELECT 'op_b_' || id, 'booking', id, client_id, coalesce(online_payment_ref, 'legacy-b-' || id),
    CASE WHEN online_payment_ref LIKE 'pi_%' THEN online_payment_ref END, online_paid_bani,
    CASE WHEN online_refunded_at IS NOT NULL THEN 'refunded' WHEN status = 'cancelled' THEN 'to_refund' ELSE 'paid' END,
    created_at, online_refunded_at, CASE WHEN online_refunded_at IS NOT NULL THEN 'stripe' END
  FROM bookings WHERE online_paid_bani IS NOT NULL;
INSERT OR IGNORE INTO online_payments (id, kind, ref, client_id, session_id, amount_bani, status, created_at)
  SELECT 'op_o_' || id, 'order', id, client_id, coalesce(payment_ref, 'legacy-o-' || id), total_bani,
    CASE WHEN status = 'cancelled' THEN 'to_refund' ELSE 'paid' END, coalesce(paid_at, created_at)
  FROM orders WHERE pay_method = 'online';
INSERT OR IGNORE INTO online_payments (id, kind, ref, client_id, session_id, amount_bani, status, created_at)
  SELECT 'op_g_' || id, 'gift', id, buyer_client_id, coalesce(payment_ref, 'legacy-g-' || id), amount_bani,
    CASE WHEN pay_method = 'online' AND status != 'cancelled' THEN 'paid' ELSE 'to_refund' END, coalesce(paid_at, created_at)
  FROM gift_cards WHERE pay_method = 'online' OR payment_ref IS NOT NULL;
