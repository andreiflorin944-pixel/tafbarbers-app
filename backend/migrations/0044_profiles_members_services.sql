-- Profilul frizerului: porecla (apare lângă nume în aplicație). Rangul rămâne în coloana role.
ALTER TABLE barbers ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
-- Servicii doar pentru membrii TAF Club (membru marcat de mână sau cu abonament activ).
ALTER TABLE services ADD COLUMN members_only INTEGER NOT NULL DEFAULT 0;
