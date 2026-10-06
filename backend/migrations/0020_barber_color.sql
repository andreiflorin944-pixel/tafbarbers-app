-- Fiecare frizer are culoarea lui în calendarul din panou (ca în Barberly).
ALTER TABLE barbers ADD COLUMN color TEXT;
UPDATE barbers SET color = '#F28C28' WHERE id = 'barber-florin';
UPDATE barbers SET color = '#E5484D' WHERE id = 'barber-andrei';
