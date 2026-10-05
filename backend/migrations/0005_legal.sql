-- GDPR: acordul clientului pentru termeni și ștergerea datelor.
ALTER TABLE clients ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE clients ADD COLUMN deleted_at TEXT;
