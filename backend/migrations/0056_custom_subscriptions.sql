-- Abonament personalizat: clientul își alege singur serviciile pe 30 de zile (ex. 2 × Skin Fade + 2 × Barbă),
-- iar reducerea crește cu numărul de vizite (setările în `settings`, cheia `custom_sub`).
-- Fiecare combinație cumpărată devine un plan ascuns (`custom = 1`), ca plata cu cardul, reînnoirea automată și panoul
-- să meargă exact ca la abonamentele obișnuite. `items` = serviciile și de câte ori: "svc-skin-fade:2,svc-beard:2".
ALTER TABLE plans ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN items TEXT;
CREATE INDEX idx_plans_custom ON plans(custom, items, price_bani);

-- Copiat din plan la cumpărare: câte vizite din fiecare serviciu are abonamentul. NULL = abonament obișnuit.
ALTER TABLE subscriptions ADD COLUMN items TEXT;
