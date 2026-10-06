-- Plata online a programării (Stripe): suma plătită, plata Stripe (payment_intent) și returnarea la anulare.
ALTER TABLE bookings ADD COLUMN online_paid_bani INTEGER;
ALTER TABLE bookings ADD COLUMN online_payment_ref TEXT;
ALTER TABLE bookings ADD COLUMN online_refunded_at TEXT;
