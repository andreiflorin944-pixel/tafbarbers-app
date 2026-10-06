-- Postări programate pe Facebook, Instagram și TikTok: conturile conectate, pozele/clipurile urcate și postările.
CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,              -- facebook | instagram | tiktok
  external_id TEXT NOT NULL,          -- id-ul paginii / contului la rețea
  name TEXT NOT NULL,
  token TEXT NOT NULL,                -- criptat
  refresh_token TEXT,                 -- criptat (TikTok)
  token_expires_at TEXT,
  page_id TEXT,                       -- Instagram: pagina de Facebook prin care postăm
  created_at TEXT NOT NULL,
  UNIQUE (network, external_id)
);

CREATE TABLE social_media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- image | video
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage TEXT NOT NULL,              -- d1 (tabelul media) | r2 (bucket MEDIA)
  created_at TEXT NOT NULL
);

CREATE TABLE social_posts (
  id TEXT PRIMARY KEY,
  caption TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '[]',   -- id-uri din social_media, în ordine
  targets TEXT NOT NULL DEFAULT '[]', -- id-uri din social_accounts
  scheduled_at TEXT,
  status TEXT NOT NULL,               -- draft | scheduled | posting | done | partial | failed
  results TEXT NOT NULL DEFAULT '{}', -- pe fiecare cont: stare, link, eroare
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX social_posts_due ON social_posts (status, scheduled_at);
