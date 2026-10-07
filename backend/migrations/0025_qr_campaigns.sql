-- Coduri QR pentru campanii de marketing: câți scanează fiecare cod și cine își face cont sau intră în cont prin el.
CREATE TABLE qr_campaigns (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,          -- apare în link: /q/<code>
  name TEXT NOT NULL,
  target TEXT NOT NULL,               -- book (deschide programarea) | home (prima pagină)
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE qr_scans (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  at TEXT NOT NULL,
  device TEXT NOT NULL,               -- ios | android | other
  ip_hash TEXT                        -- adresa IP doar ca amprentă (hash), ca să numărăm oameni diferiți
);
CREATE INDEX qr_scans_campaign ON qr_scans (campaign_id, at);
CREATE INDEX qr_scans_ip ON qr_scans (ip_hash, at);

CREATE TABLE qr_clients (
  campaign_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- signup (cont nou) | login (client existent)
  match TEXT NOT NULL,                -- exact (aplicația a primit codul) | probable (aceeași rețea, la scurt timp după scanare)
  at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, client_id)
);
CREATE INDEX qr_clients_client ON qr_clients (client_id);
