import { newId } from './auth';
import { HttpError, type Env } from './env';
import { refundFor } from './payments';
import { sendTemplate } from './sendTemplate';
import { iso } from './time';

// Magazin online. Plata se face la ridicarea din salon sau online, din aplicație; stocul scade la comandă și revine la anulare.
// O comandă plătită online și apoi anulată își primește banii înapoi pe card (sau apare „de returnat” în panou).

export type ProductRow = {
  id: string;
  name: string;
  description: string;
  price_bani: number;
  image_url: string | null;
  stock: number | null;
  sort: number;
  active: number;
  created_at: string;
  for_sale: number;
  unit: string;
  cost_bani: number | null;
};

export const product = (r: ProductRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  price: r.price_bani / 100,
  imageUrl: r.image_url,
  stock: r.stock,
  sort: r.sort,
  active: !!r.active,
  forSale: !!r.for_sale,
  unit: r.unit,
  cost: r.cost_bani === null ? null : r.cost_bani / 100,
});

export type OrderStatus = 'new' | 'ready' | 'picked_up' | 'cancelled';
type OrderRow = { id: string; client_id: string; status: OrderStatus; total_bani: number; note: string; created_at: string; updated_at: string; paid_at: string | null; pay_method: string | null };
type ItemRow = { order_id: string; product_id: string; name: string; price_bani: number; qty: number };

/** Codul scurt pe care clientul îl spune la ridicare. */
export const orderCode = (id: string) => id.slice(-5).toUpperCase();

export async function getOrders(env: Env, where: string, binds: unknown[], limit = 100) {
  const orders = await env.DB.prepare(
    `SELECT o.*, c.name AS client_name, c.phone AS client_phone,
       (SELECT p.status FROM online_payments p WHERE p.kind = 'order' AND p.ref = o.id AND p.session_id = o.payment_ref) AS online_status
     FROM orders o JOIN clients c ON c.id = o.client_id
     WHERE ${where} ORDER BY o.created_at DESC LIMIT ${limit}`,
  )
    .bind(...binds)
    .all<OrderRow & { client_name: string; client_phone: string; online_status: string | null }>();
  if (!orders.results.length) return [];
  const ids = orders.results.map((o) => o.id);
  const items = await env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<ItemRow>();
  return orders.results.map((o) => ({
    id: o.id,
    code: orderCode(o.id),
    status: o.status,
    total: o.total_bani / 100,
    note: o.note,
    paidAt: o.paid_at,
    payMethod: o.pay_method,
    // Plata online a comenzii: plătită / returnată pe card / de returnat (după anulare).
    onlineStatus: (o.online_status ?? null) as 'paid' | 'refunded' | 'to_refund' | null,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    clientId: o.client_id,
    clientName: o.client_name,
    clientPhone: o.client_phone.startsWith('deleted:') ? '' : o.client_phone,
    items: items.results
      .filter((i) => i.order_id === o.id)
      .map((i) => ({ productId: i.product_id, name: i.name, price: i.price_bani / 100, qty: i.qty })),
  }));
}

export async function getOrder(env: Env, id: string) {
  const [o] = await getOrders(env, 'o.id = ?', [id], 1);
  if (!o) throw new HttpError(404, 'not_found');
  return o;
}

export async function createOrder(env: Env, clientId: string, input: { items?: Array<{ productId?: string; qty?: number }>; note?: string }) {
  const lines = new Map<string, number>();
  for (const it of input.items ?? []) {
    const qty = Math.floor(Number(it.qty));
    if (!it.productId || !(qty >= 1 && qty <= 10)) throw new HttpError(400, 'invalid_body');
    lines.set(it.productId, (lines.get(it.productId) ?? 0) + qty);
  }
  if (!lines.size || lines.size > 20) throw new HttpError(400, 'invalid_body');

  const open = await env.DB.prepare(`SELECT count(*) AS n FROM orders WHERE client_id = ? AND status IN ('new', 'ready')`)
    .bind(clientId)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= 3) throw new HttpError(409, 'too_many_open_orders');

  const ids = [...lines.keys()];
  const prods = await env.DB.prepare(`SELECT * FROM products WHERE active = 1 AND for_sale = 1 AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<ProductRow>();
  if (prods.results.length !== ids.length) throw new HttpError(409, 'product_unavailable');

  const id = newId('o');
  const now = iso(new Date());
  const total = prods.results.reduce((s, p) => s + p.price_bani * lines.get(p.id)!, 0);
  // Totul într-o singură tranzacție: dacă un produs nu mai are stoc, regula CHECK oprește tot.
  const stmts = [
    ...prods.results.map((p) =>
      env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL').bind(lines.get(p.id)!, p.id),
    ),
    env.DB.prepare('INSERT INTO orders (id, client_id, status, total_bani, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      clientId,
      'new',
      total,
      (input.note ?? '').trim().slice(0, 300),
      now,
      now,
    ),
    // Fișa de magazie: vânzarea apare ca ieșire pentru produsele cu stoc urmărit.
    ...prods.results
      .filter((p) => p.stock !== null)
      .map((p) =>
        env.DB.prepare(`INSERT INTO stock_moves (product_id, qty, kind, order_id, unit_cost_bani, created_at) VALUES (?, ?, 'vanzare', ?, ?, ?)`).bind(
          p.id,
          -lines.get(p.id)!,
          id,
          p.cost_bani,
          now,
        ),
      ),
    ...prods.results.map((p) =>
      env.DB.prepare('INSERT INTO order_items (order_id, product_id, name, price_bani, qty) VALUES (?, ?, ?, ?, ?)').bind(
        id,
        p.id,
        p.name,
        p.price_bani,
        lines.get(p.id)!,
      ),
    ),
  ];
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes('CHECK constraint')) throw new HttpError(409, 'out_of_stock');
    throw e;
  }
  return getOrder(env, id);
}

/** Schimbă starea comenzii. La anulare stocul revine. Întoarce false dacă tranziția nu e permisă. */
export async function setOrderStatus(env: Env, id: string, to: OrderStatus, from: OrderStatus[]): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`,
  )
    .bind(to, iso(new Date()), id, ...from)
    .run();
  if (!r.meta.changes) return false;
  if (to === 'cancelled') {
    await env.DB.prepare(
      `INSERT INTO stock_moves (product_id, qty, kind, order_id, unit_cost_bani)
       SELECT i.product_id, i.qty, 'vanzare_anulata', i.order_id, p.cost_bani FROM order_items i JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ? AND p.stock IS NOT NULL`,
    )
      .bind(id)
      .run();
    await env.DB.prepare(
      `UPDATE products SET stock = stock + (SELECT qty FROM order_items WHERE order_id = ?1 AND product_id = products.id)
       WHERE stock IS NOT NULL AND id IN (SELECT product_id FROM order_items WHERE order_id = ?1)`,
    )
      .bind(id)
      .run();
    try {
      await refundFor(env, 'order', id, 'Comandă anulată');
    } catch (e) {
      console.error('refund order', id, e);
    }
  }
  if (to === 'ready') await notifyOrder(env, id, 'order_ready');
  return true;
}

/** Mesajul către client despre comanda lui (primită, gata, anulată), după șabloanele din panou. */
export async function notifyOrder(env: Env, id: string, event: 'order_created' | 'order_ready' | 'order_cancelled') {
  const o = await env.DB.prepare('SELECT client_id, paid_at FROM orders WHERE id = ?').bind(id).first<{ client_id: string; paid_at: string | null }>();
  if (!o) return;
  // Plătită deja online: mesajul „gata” nu-i mai spune să plătească la ridicare.
  const tpl = event === 'order_ready' && o.paid_at ? 'order_ready_paid' : event;
  await sendTemplate(env, tpl, o.client_id, { ordernumber: orderCode(id) }, { data: { orderId: id } });
}
