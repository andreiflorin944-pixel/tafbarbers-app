-- Consilierul AI de tunsori: clientul face o poză, AI-ul îi propune 2-3 servicii ale salonului.
-- Ca exemple, consilierul arată pozele înainte/după ale serviciului, dar doar perechile bifate în panou
-- („clientul e de acord să fie arătată ca exemplu”); pozele clienților rămân private altfel.
-- Poza clientului pentru analiză NU se salvează nicăieri; numărul analizelor se ține în assistant_usage (chei „advisor:…”).
ALTER TABLE before_after ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE before_after ADD COLUMN show_example INTEGER NOT NULL DEFAULT 0;

-- Perechile existente primesc serviciul ultimei programări a clientului de dinaintea pozei (la același frizer, dacă se știe).
UPDATE before_after SET service_id = (
  SELECT b.service_id FROM bookings b
  WHERE b.client_id = before_after.client_id AND b.status IN ('confirmed', 'completed')
    AND b.starts_at <= before_after.created_at
  ORDER BY (before_after.barber_id IS NOT NULL AND b.barber_id = before_after.barber_id) DESC, b.starts_at DESC LIMIT 1
);

CREATE INDEX idx_before_after_example ON before_after(service_id, show_example);
