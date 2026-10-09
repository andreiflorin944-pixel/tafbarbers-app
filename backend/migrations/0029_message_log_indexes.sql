-- Căutări în jurnalul de mesaje: cine a primit deja o campanie (trimitere pe bucăți, fără dubluri),
-- încercările unui reminder și codurile de intrare cerute recent pentru un număr sau o adresă.
CREATE INDEX IF NOT EXISTS idx_message_log_campaign ON message_log(campaign_id, recipient);
CREATE INDEX IF NOT EXISTS idx_message_log_booking ON message_log(booking_id, kind);
CREATE INDEX IF NOT EXISTS idx_message_log_recipient ON message_log(recipient, kind, created_at);
