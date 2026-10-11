-- Abonamente cu plată recurentă (Stripe): clientul plătește o dată cu cardul, apoi Stripe îl taxează singur la fiecare perioadă.
-- Fiecare perioadă plătită rămâne un rând separat în `subscriptions` (cu tunsorile ei), legat de abonamentul Stripe prin `recurring_id`,
-- ca istoricul, rapoartele și scăderea tunsorilor să meargă la fel ca până acum.

-- Clientul în Stripe (cus_...): același la toate abonamentele lui, ca să nu se creeze unul nou la fiecare cumpărare.
ALTER TABLE clients ADD COLUMN stripe_customer_id TEXT;

-- Un abonament recurent din Stripe (sub_...), cu ce se reînnoiește (copiat din plan la cumpărare, ca schimbările planului să nu-l afecteze).
--   status: active = se plătește · past_due = plata a căzut, Stripe reîncearcă · ended = abonamentul Stripe s-a încheiat
--   auto_renew: 1 = se reînnoiește la finalul perioadei · 0 = oprit (perioada plătită rămâne valabilă până la capăt)
CREATE TABLE recurring_subs (
  id                 TEXT PRIMARY KEY,           -- abonamentul Stripe (sub_...)
  client_id          TEXT NOT NULL,
  plan_id            TEXT,
  name               TEXT NOT NULL,
  price_bani         INTEGER NOT NULL,
  cuts               INTEGER,                    -- tunsori pe perioadă; NULL = nelimitat
  service_ids        TEXT NOT NULL DEFAULT '',
  interval_days      INTEGER NOT NULL,
  customer_id        TEXT,
  auto_renew         INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','ended')),
  current_period_end TEXT,                       -- când se face următoarea plată (sau când se termină, dacă e oprit)
  failed_invoice     TEXT,                       -- ultima factură căzută pentru care clientul a fost anunțat (o singură dată pe factură)
  last_failed_at     TEXT,
  stopped_by         TEXT,                       -- cine a oprit reînnoirea: 'client', contul din panou, 'stripe', 'gdpr'
  event_at           INTEGER NOT NULL DEFAULT 0, -- ora (unix) ultimei schimbări aplicate: evenimentele Stripe mai vechi venite târziu se ignoră
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ended_at           TEXT
);
CREATE INDEX idx_recurring_subs_client ON recurring_subs(client_id, status);
CREATE INDEX idx_recurring_subs_plan ON recurring_subs(plan_id, status);

-- Perioada plătită a cărui abonament recurent este (NULL = plătit la salon sau o singură dată).
ALTER TABLE subscriptions ADD COLUMN recurring_id TEXT;
CREATE INDEX idx_subscriptions_recurring ON subscriptions(recurring_id);

-- Plățile recurente intră în același registru: factura Stripe (in_...) se trece o singură dată, chiar dacă Stripe o anunță de mai multe ori.
ALTER TABLE online_payments ADD COLUMN invoice_id TEXT;
ALTER TABLE online_payments ADD COLUMN renewal INTEGER NOT NULL DEFAULT 0; -- 1 = reînnoire automată (nu prima plată)
CREATE UNIQUE INDEX idx_online_payments_invoice ON online_payments(invoice_id) WHERE invoice_id IS NOT NULL;
