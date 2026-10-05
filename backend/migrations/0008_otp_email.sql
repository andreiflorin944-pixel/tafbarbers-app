-- Codul de intrare poate merge și pe e-mail; ținem minte adresa ca s-o salvăm în cont la confirmare.
ALTER TABLE otp_codes ADD COLUMN email TEXT;
