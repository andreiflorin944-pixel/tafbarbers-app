-- Abonament personalizat: clientul își alege singur serviciile pe 30 de zile (ex. 2 × Skin Fade + 2 × Barbă),
-- iar reducerea crește cu numărul de vizite (setările în `settings`, cheia `custom_sub`).
-- Fiecare combinație cumpărată devine un plan ascuns (`custom = 1`), ca plata cu cardul, reînnoirea automată și panoul
-- să meargă exact ca la abonamentele obișnuite. `items` = serviciile și de câte ori: "svc-skin-fade:2,svc-beard:2".
ALTER TABLE plans ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN items TEXT;
CREATE INDEX idx_plans_custom ON plans(custom, items, price_bani);

-- Copiat din plan la cumpărare: câte vizite din fiecare serviciu are abonamentul. NULL = abonament obișnuit.
ALTER TABLE subscriptions ADD COLUMN items TEXT;

-- Bannerele de pe Acasă pot deschide și „Creează-ți abonamentul” (action_type 'custom_sub').
-- SQLite nu poate schimba un CHECK, așa că tabelul se reface cu aceleași coloane și date (ca în 0046).
CREATE TABLE promos_new (
  id               TEXT PRIMARY KEY,
  kicker           TEXT NOT NULL,
  title            TEXT NOT NULL,
  text             TEXT NOT NULL DEFAULT '',
  cta              TEXT NOT NULL,
  icon             TEXT NOT NULL DEFAULT 'pricetag',
  action_type      TEXT NOT NULL CHECK (action_type IN ('service','url','book','shop','custom_sub')),
  action_value     TEXT,
  translations     TEXT NOT NULL DEFAULT '{}',
  starts_at        TEXT,
  ends_at          TEXT,
  sort             INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  image_url        TEXT,
  color            TEXT,
  discount_percent INTEGER
);
INSERT INTO promos_new (id, kicker, title, text, cta, icon, action_type, action_value, translations, starts_at, ends_at, sort, active, image_url, color, discount_percent)
  SELECT id, kicker, title, text, cta, icon, action_type, action_value, translations, starts_at, ends_at, sort, active, image_url, color, discount_percent FROM promos;
DROP TABLE promos;
ALTER TABLE promos_new RENAME TO promos;
