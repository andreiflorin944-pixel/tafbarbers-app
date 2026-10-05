-- Magazin online: produse, comenzi cu plata la ridicare din salon.
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_bani  INTEGER NOT NULL,
  image_url   TEXT,
  stock       INTEGER CHECK (stock IS NULL OR stock >= 0), -- NULL = fără limită
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id),
  status     TEXT NOT NULL DEFAULT 'new', -- new | ready | picked_up | cancelled
  total_bani INTEGER NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_client ON orders(client_id, created_at);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  price_bani INTEGER NOT NULL,
  qty        INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
