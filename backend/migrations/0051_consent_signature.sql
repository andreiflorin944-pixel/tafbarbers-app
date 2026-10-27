-- Semnarea termenilor și a politicii de confidențialitate: clientul derulează ambele documente până la capăt, bifă că le-a
-- citit și le acceptă, apoi scrie numele ca semnătură. Păstrăm semnătura, amprenta (SHA-256) textului exact pe care l-a
-- văzut și faptul că l-a derulat integral.
ALTER TABLE client_consents ADD COLUMN signature TEXT;   -- numele scris de client; se șterge odată cu contul
ALTER TABLE client_consents ADD COLUMN doc_hash TEXT;    -- SHA-256 al textului termenilor + politicii, în limba afișată
ALTER TABLE client_consents ADD COLUMN read_full INTEGER; -- 1 = a derulat ambele documente până jos înainte să semneze
