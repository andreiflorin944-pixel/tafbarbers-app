import { newId } from './auth';
import { getBusiness } from './db';
import { HttpError, type Env } from './env';
import { msg } from './messages';
import { sendPush, sendSms } from './notify';
import { iso } from './time';

// Magazin online. Plata se face la ridicarea din salon; stocul scade la comandă și revine la anulare.

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
});

export type OrderStatus = 'new' | 'ready' | 'picked_up' | 'cancelled';
type OrderRow = { id: string; client_id: string; status: OrderStatus; total_bani: number; note: string; created_at: string; updated_at: string };
type ItemRow = { order_id: string; product_id: string; name: string; price_bani: number; qty: number };

/** Codul scurt pe care clientul îl spune la ridicare. */
export const orderCode = (id: string) => id.slice(-5).toUpperCase();

export async function getOrders(env: Env, where: string, binds: unknown[], limit = 100) {
  const orders = await env.DB.prepare(
    `SELECT o.*, c.name AS client_name, c.phone AS client_phone FROM orders o JOIN clients c ON c.id = o.client_id
     WHERE ${where} ORDER BY o.created_at DESC LIMIT ${limit}`,
  )
    .bind(...binds)
    .all<OrderRow & { client_name: string; client_phone: string }>();
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
  const prods = await env.DB.prepare(`SELECT * FROM products WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`)
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
      `UPDATE products SET stock = stock + (SELECT qty FROM order_items WHERE order_id = ?1 AND product_id = products.id)
       WHERE stock IS NOT NULL AND id IN (SELECT product_id FROM order_items WHERE order_id = ?1)`,
    )
      .bind(id)
      .run();
  }
  if (to === 'ready') await notifyOrderReady(env, id);
  return true;
}

async function notifyOrderReady(env: Env, id: string) {
  const o = await env.DB.prepare('SELECT o.client_id, c.phone, c.lang FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ?')
    .bind(id)
    .first<{ client_id: string; phone: string; lang: string }>();
  if (!o || o.phone.startsWith('deleted:')) return;
  const biz = await getBusiness(env);
  const text = msg(o.lang, 'order_ready', { shop: biz.name, code: orderCode(id) });
  await sendSms(env, { kind: 'order_ready', recipient: o.phone }, text);
  const tokens = await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(o.client_id).all<{ token: string }>();
  if (tokens.results.length) await sendPush(env, { kind: 'order_ready' }, tokens.results.map((t) => t.token), biz.name, text, { orderId: id });
}
