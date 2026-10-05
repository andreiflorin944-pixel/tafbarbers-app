-- Bannere: poză de fundal și culoare proprie (NULL = culoarea principală, alternativ ca până acum).
ALTER TABLE promos ADD COLUMN image_url TEXT;
ALTER TABLE promos ADD COLUMN color TEXT;
