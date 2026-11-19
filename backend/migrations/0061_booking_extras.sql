-- Mai multe servicii la aceeași programare (ex. Tuns + Vopsit barbă): serviciul principal rămâne în bookings.service_id,
-- cele adăugate stau aici. Durata și prețul lor (ale frizerului, din momentul adăugării) sunt deja incluse în
-- bookings.ends_at și bookings.price_bani, deci rapoartele și plățile văd totalul.
CREATE TABLE booking_extras (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id  TEXT NOT NULL REFERENCES services(id),
  duration_min INTEGER NOT NULL,
  price_bani  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_booking_extras_booking ON booking_extras(booking_id);
