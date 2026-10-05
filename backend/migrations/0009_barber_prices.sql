-- Preț propriu al unui frizer pentru un serviciu (în bani); NULL = prețul standard al serviciului.
ALTER TABLE barber_services ADD COLUMN price_bani INTEGER CHECK (price_bani IS NULL OR price_bani >= 0);
