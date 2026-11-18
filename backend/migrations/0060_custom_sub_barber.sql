-- Abonament personalizat pe frizer: clientul alege frizerul, prețul se calculează cu prețurile lui,
-- iar abonamentul acoperă doar programările la el. NULL = orice frizer, preț standard (abonamentele de până acum).
ALTER TABLE plans ADD COLUMN barber_id TEXT;
ALTER TABLE subscriptions ADD COLUMN barber_id TEXT;
