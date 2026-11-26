-- „Client fără programare” (walk-in): clientul intrat de pe stradă se trece în calendar fără cont.
-- Toate aceste programări stau pe un singur client de sistem, ascuns (ca un cont șters: nu apare în liste,
-- nu primește mesaje și nu intră în campanii); numele scris de frizer (opțional) stă pe programare.
ALTER TABLE bookings ADD COLUMN walkin_name TEXT;
INSERT OR IGNORE INTO clients (id, phone, name, marketing_sms, marketing_email, marketing_push, deleted_at)
VALUES ('cl_walkin', 'deleted:cl_walkin', 'Client fără programare', 0, 0, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
