-- Termenele de păstrare (GDPR art. 5 alin. 1 lit. e). Amprenta IP a scanărilor QR se golește după 30 de zile; ca numărul de
-- „persoane” din statistici să rămână corect, fiecare scanare ține minte la intrare dacă e prima de la acea rețea pe campanie.
ALTER TABLE qr_scans ADD COLUMN first INTEGER NOT NULL DEFAULT 1;
UPDATE qr_scans SET first = 0
WHERE ip_hash IS NOT NULL AND EXISTS (
  SELECT 1 FROM qr_scans s2
  WHERE s2.campaign_id = qr_scans.campaign_id AND s2.ip_hash = qr_scans.ip_hash
    AND (s2.at < qr_scans.at OR (s2.at = qr_scans.at AND s2.id < qr_scans.id))
);
CREATE INDEX IF NOT EXISTS idx_message_log_created ON message_log(created_at);
