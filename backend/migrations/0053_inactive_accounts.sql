-- Conturile nefolosite (GDPR art. 5 alin. 1 lit. e): după 1 an fără programare, vizită, comandă sau deschiderea aplicației,
-- clientul e anunțat, iar după încă 30 de zile contul se șterge ca la „Șterge contul”.
ALTER TABLE clients ADD COLUMN last_active_at TEXT;      -- ultima deschidere a aplicației cu contul (cel mult o scriere pe zi)
ALTER TABLE clients ADD COLUMN inactive_warned_at TEXT;  -- când a primit anunțul că i se va șterge contul
