-- „Extra fără timp” (ex. Spălat, Ceară pe față): se pun în plus la o programare, se plătesc, dar nu ocupă timp în calendar.
-- Sunt tot servicii (prețuri proprii pe frizer în barber_services, traduceri, rapoarte), cu addon = 1 și durata 0.
-- Nu apar în listele de servicii care se programează singure; se adaugă doar pe o programare (booking_extras, durata 0).
ALTER TABLE services ADD COLUMN addon INTEGER NOT NULL DEFAULT 0;
