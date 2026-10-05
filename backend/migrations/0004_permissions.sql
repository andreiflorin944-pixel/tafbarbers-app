-- Drepturi pe cont pentru frizeri (proprietarul, fără barber_id, are tot).
ALTER TABLE admins ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}';
