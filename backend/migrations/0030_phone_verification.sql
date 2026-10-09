-- Contul creat cu cod pe e-mail nu dovedește că numărul de telefon e al clientului: îl ținem minte, iar la prima intrare
-- cu cod prin SMS (care dovedește numărul) contul trece la cel care are telefonul (celelalte sesiuni se închid).
ALTER TABLE clients ADD COLUMN phone_unverified INTEGER NOT NULL DEFAULT 0;
-- Pe ce canal a plecat codul (sms / email).
ALTER TABLE otp_codes ADD COLUMN channel TEXT;
