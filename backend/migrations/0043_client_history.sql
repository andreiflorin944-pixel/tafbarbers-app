-- Istoricul clienților adus din Barberly la import (vizite, sume, anulări, neprezentări, prima și ultima vizită).
-- Rămâne cum a venit din fișier; în panou se adună cu programările făcute la noi.
ALTER TABLE clients ADD COLUMN hist_visits INTEGER;
ALTER TABLE clients ADD COLUMN hist_spent_bani INTEGER;
ALTER TABLE clients ADD COLUMN hist_cancelled INTEGER;
ALTER TABLE clients ADD COLUMN hist_cancelled_bani INTEGER;
ALTER TABLE clients ADD COLUMN hist_noshows INTEGER;
ALTER TABLE clients ADD COLUMN hist_noshow_bani INTEGER;
ALTER TABLE clients ADD COLUMN hist_first_visit TEXT;
ALTER TABLE clients ADD COLUMN hist_last_visit TEXT;
-- Frizerul din Barberly; la noi, frizerul preferat e cel la care vine cel mai des.
ALTER TABLE clients ADD COLUMN preferred_barber_id TEXT REFERENCES barbers(id);
