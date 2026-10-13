-- Bannere: butonul poate duce și în magazin (opțional direct la un produs). SQLite nu poate schimba un CHECK,
-- așa că tabelul se reface cu aceleași coloane și date.
CREATE TABLE promos_new (
  id           TEXT PRIMARY KEY,
  kicker       TEXT NOT NULL,
  title        TEXT NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  cta          TEXT NOT NULL,
  icon         TEXT NOT NULL DEFAULT 'pricetag',
  action_type  TEXT NOT NULL CHECK (action_type IN ('service','url','book','shop')),
  action_value TEXT,
  translations TEXT NOT NULL DEFAULT '{}',
  starts_at    TEXT,
  ends_at      TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  image_url    TEXT,
  color        TEXT
);
INSERT INTO promos_new (id, kicker, title, text, cta, icon, action_type, action_value, translations, starts_at, ends_at, sort, active, image_url, color)
  SELECT id, kicker, title, text, cta, icon, action_type, action_value, translations, starts_at, ends_at, sort, active, image_url, color FROM promos;
DROP TABLE promos;
ALTER TABLE promos_new RENAME TO promos;

-- „Produsul săptămânii” e o ofertă de vânzare: duce în magazin, la ceara de păr dacă există în magazin.
UPDATE promos SET
  action_type = 'shop',
  action_value = (SELECT id FROM products WHERE active = 1 AND for_sale = 1 AND name LIKE '%cear%' ORDER BY sort LIMIT 1),
  cta = 'Vezi în magazin',
  translations = json_patch(CASE WHEN json_valid(translations) THEN translations ELSE '{}' END, '{"en":{"cta":"See in the shop"},"fr":{"cta":"Voir en boutique"}}')
WHERE id = 'promo-product' AND action_type = 'book';

-- „Devino barber” duce la site-ul academiei (cerut de florin).
UPDATE promos SET action_value = 'https://tafacademy.ro' WHERE id = 'promo-academy' AND action_type = 'url';
