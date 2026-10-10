-- Parola clientului (opțională): pe lângă intrarea cu cod, clientul își poate pune o parolă din Cont și intră cu e-mail
-- (sau telefon) și parolă. Doar hash PBKDF2 (ca la echipă); nu pleacă niciodată din server, nici în exportul GDPR.
ALTER TABLE clients ADD COLUMN password_hash TEXT;
ALTER TABLE clients ADD COLUMN password_set_at TEXT;

-- Încercările greșite de intrare cu parolă, ca să blocăm ghicirea: pe cont / pe datele scrise și pe IP (doar hash, fără IP-ul în clar).
-- După prea multe greșeli într-un sfert de oră, cheia se blochează 15 minute.
CREATE TABLE login_failures (
  key          TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  first_at     TEXT NOT NULL,
  locked_until TEXT
);
