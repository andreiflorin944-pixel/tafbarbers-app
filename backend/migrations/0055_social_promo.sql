-- Promo „Urmărește-ne pe rețele”: reducerea se deblochează o singură dată pe cont.
ALTER TABLE clients ADD COLUMN social_promo_at TEXT;     -- când și-a deblocat reducerea
ALTER TABLE clients ADD COLUMN social_promo_bonus TEXT;  -- bonusul dat (bonuses.id)
CREATE INDEX idx_clients_social_promo ON clients(social_promo_at);
