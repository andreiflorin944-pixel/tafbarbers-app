-- Client blocat din panou: nu mai poate intra în cont, nu primește cod de conectare și nu se mai poate programa
-- din aplicație sau de pe site (echipa îl poate programa în continuare din panou, dacă vrea).
ALTER TABLE clients ADD COLUMN blocked_at TEXT;
ALTER TABLE clients ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN blocked_by TEXT;
