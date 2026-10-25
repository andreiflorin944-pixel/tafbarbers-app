-- Actualizările aplicației pornite din panou (Aplicații → „Actualizați aplicația”):
-- construirea și trimiterea prin EAS, apoi (la iOS) trimiterea la verificare la Apple, pas cu pas din cron.
CREATE TABLE app_releases (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,          -- ios | android | all
  kind TEXT NOT NULL,              -- store = versiune nouă în magazine; ota = actualizare rapidă, fără magazin
  version TEXT NOT NULL,
  whats_new TEXT NOT NULL DEFAULT '',
  run_id TEXT,                     -- rularea EAS Workflows
  run_url TEXT,
  status TEXT NOT NULL,            -- building | apple | done | failed
  step TEXT NOT NULL DEFAULT '',   -- ultimul pas, pe înțelesul proprietarului
  error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX app_releases_created ON app_releases (created_at);
