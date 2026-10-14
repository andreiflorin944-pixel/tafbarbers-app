-- Poza abonamentului, arătată clientului în aplicație deasupra numelui (null = fără poză, ca până acum).
ALTER TABLE plans ADD COLUMN photo_url TEXT;
