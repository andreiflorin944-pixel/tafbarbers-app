-- Rapoarte: cine a anulat programarea și bacșișul primit la plată.
ALTER TABLE bookings ADD COLUMN cancelled_by TEXT CHECK (cancelled_by IN ('client','staff'));
ALTER TABLE bookings ADD COLUMN cancelled_by_admin TEXT;
ALTER TABLE bookings ADD COLUMN tip_bani INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookings_starts ON bookings(starts_at);
