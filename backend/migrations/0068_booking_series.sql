-- Programări repetate: din panou (sau din aplicația echipei) o programare se repetă în fiecare săptămână sau la 2, 3, 4 săptămâni,
-- în aceeași zi, la aceeași oră. Toate programările din serie au același `series_id` (id-ul primei programări),
-- ca să se poată anula dintr-odată „aceasta și următoarele”.
ALTER TABLE bookings ADD COLUMN series_id TEXT;
CREATE INDEX idx_bookings_series ON bookings(series_id, starts_at) WHERE series_id IS NOT NULL;
