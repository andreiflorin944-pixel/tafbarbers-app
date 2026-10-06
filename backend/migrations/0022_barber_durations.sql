-- Durata proprie a unui frizer pentru un serviciu (în minute); NULL = durata standard a serviciului.
ALTER TABLE barber_services ADD COLUMN duration_min INTEGER CHECK (duration_min IS NULL OR (duration_min >= 5 AND duration_min <= 600));
