-- Roluri pentru conturile echipei: administrator de organizație (tot), administrator de locație, frizer.
-- Drepturile bifate pe cont se aplică peste cele implicite ale rolului.
ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'barber' CHECK (role IN ('org_admin','location_admin','barber'));
UPDATE admins SET role = 'org_admin' WHERE barber_id IS NULL;
