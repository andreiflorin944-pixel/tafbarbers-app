// Gestiunea de produse: NIR (nota de intrare-recepție) la marfa primită, ieșiri (vânzare în magazin, consum în salon,
// casare) și fișa de magazie. Stocul din `products.stock` e același cu cel din magazinul aplicației.
import { newId } from './auth';
import { HttpError, type Env } from './env';
import { iso, isDay } from './time';

export type MoveKind = 'nir' | 'nir_anulat' | 'vanzare' | 'vanzare_anulata' | 'consum' | 'casare' | 'ajustare';
export const MOVE_LABELS: Record<MoveKind, string> = {
  nir: 'Intrare (NIR)',
  nir_anulat: 'NIR anulat',
  vanzare: 'Vânzare magazin',
  vanzare_anulata: 'Comandă anulată',
  consum: 'Consum în salon',
  casare: 'Casare (deteriorat, expirat)',
  ajustare: 'Corecție stoc (inventar)',
};

type NirLineInput = {
  productId?: string;
  newProduct?: { name?: string; unit?: string; forSale?: boolean; price?: number };
  qty?: number;
  unitCost?: number; // lei, fără TVA
  vatPct?: number;
};
export type NirInput = {
  day?: string;
  supplier?: string;
  supplierCui?: string;
  invoiceNo?: string;
  invoiceDay?: string | null;
  note?: string;
  lines?: NirLineInput[];
};

type NirRow = {
  id: string;
  number: number;
  day: string;
  supplier: string;
  supplier_cui: string;
  invoice_no: string;
  invoice_day: string | null;
  note: string;
  total_bani: number;
  vat_bani: number;
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
  created_by_name?: string | null;
  lines_count?: number;
};
const nir = (r: NirRow) => ({
  id: r.id,
  number: r.number,
  day: r.day,
  supplier: r.supplier,
  supplierCui: r.supplier_cui,
  invoiceNo: r.invoice_no,
  invoiceDay: r.invoice_day,
  note: r.note,
  total: r.total_bani / 100,
  vat: r.vat_bani / 100,
  createdAt: r.created_at,
  createdByName: r.created_by_name ?? null,
  cancelledAt: r.cancelled_at,
  ...(r.lines_count !== undefined && { linesCount: r.lines_count }),
});

const NIR_SELECT = `SELECT n.*, coalesce(nullif(a.name, ''), a.email) AS created_by_name,
  (SELECT count(*) FROM stock_moves m WHERE m.nir_id = n.id AND m.kind = 'nir') AS lines_count
  FROM nir_docs n LEFT JOIN admins a ON a.id = n.created_by`;

export async function listNir(env: Env) {
  const r = await env.DB.prepare(`${NIR_SELECT} ORDER BY n.number DESC LIMIT 500`).all<NirRow>();
  return r.results.map(nir);
}

export async function getNir(env: Env, id: string) {
  const r = await env.DB.prepare(`${NIR_SELECT} WHERE n.id = ?`).bind(id).first<NirRow>();
  if (!r) throw new HttpError(404, 'not_found');
  const lines = await env.DB.prepare(
    `SELECT m.product_id, p.name, p.unit, m.qty, m.unit_cost_bani, m.vat_pct FROM stock_moves m JOIN products p ON p.id = m.product_id
     WHERE m.nir_id = ? AND m.kind = 'nir' ORDER BY m.id`,
  )
    .bind(id)
    .all<{ product_id: string; name: string; unit: string; qty: number; unit_cost_bani: number; vat_pct: number }>();
  return {
    ...nir(r),
    lines: lines.results.map((l) => {
      const value = l.qty * l.unit_cost_bani;
      const vat = Math.round((value * (l.vat_pct ?? 0)) / 100);
      return { productId: l.product_id, name: l.name, unit: l.unit, qty: l.qty, unitCost: l.unit_cost_bani / 100, vatPct: l.vat_pct ?? 0, value: value / 100, vat: vat / 100 };
    }),
  };
}

/** Înregistrează marfa primită: crește stocul, ține minte prețul de achiziție și numerotează NIR-ul. */
export async function createNir(env: Env, adminId: string, b: NirInput) {
  const day = b.day && isDay(b.day) ? b.day : null;
  if (!day) throw new HttpError(400, 'invalid_day');
  const supplier = String(b.supplier ?? '').trim().slice(0, 120);
  if (!supplier) throw new HttpError(400, 'supplier_required');
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length || lines.length > 100) throw new HttpError(400, 'lines_required');

  const stmts: D1PreparedStatement[] = [];
  const now = iso(new Date());
  const id = newId('nir');
  let total = 0;
  let vatTotal = 0;
  const parsed: Array<{ productId: string; qty: number; cost: number; vat: number }> = [];
  for (const l of lines) {
    const qty = Math.round(Number(l.qty));
    const cost = Math.round(Number(l.unitCost) * 100);
    const vat = l.vatPct === undefined || l.vatPct === null ? 0 : Math.round(Number(l.vatPct));
    if (!(qty >= 1 && qty <= 100000)) throw new HttpError(400, 'invalid_qty');
    if (!(cost >= 0 && cost <= 10_000_000)) throw new HttpError(400, 'invalid_price');
    if (![0, 5, 9, 11, 19, 21].includes(vat)) throw new HttpError(400, 'invalid_vat');
    let productId = l.productId ?? '';
    if (!productId) {
      const np = l.newProduct ?? {};
      const name = String(np.name ?? '').trim().slice(0, 120);
      if (!name) throw new HttpError(400, 'name_required');
      const price = Math.round(Number(np.price ?? 0) * 100);
      if (!(price >= 0 && price <= 10_000_00)) throw new HttpError(400, 'invalid_price');
      productId = newId('p');
      // Produsul nou intră cu stoc 0, apoi linia de NIR îl crește. Implicit nu apare în magazin până nu-l publici.
      stmts.push(
        env.DB.prepare(
          `INSERT INTO products (id, name, description, price_bani, image_url, stock, sort, active, created_at, for_sale, unit, cost_bani)
           VALUES (?, ?, '', ?, NULL, 0, 0, 1, ?, ?, ?, ?)`,
        ).bind(productId, name, price, now, np.forSale ? 1 : 0, String(np.unit ?? 'buc').trim().slice(0, 12) || 'buc', cost),
      );
    } else {
      const p = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
      if (!p) throw new HttpError(400, 'product_not_found');
    }
    parsed.push({ productId, qty, cost, vat });
    total += qty * cost;
    vatTotal += Math.round((qty * cost * vat) / 100);
  }
  const last = await env.DB.prepare('SELECT coalesce(max(number), 0) AS n FROM nir_docs').first<{ n: number }>();
  const number = (last?.n ?? 0) + 1;
  stmts.push(
    env.DB.prepare(
      `INSERT INTO nir_docs (id, number, day, supplier, supplier_cui, invoice_no, invoice_day, note, total_bani, vat_bani, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      number,
      day,
      supplier,
      String(b.supplierCui ?? '').trim().slice(0, 20),
      String(b.invoiceNo ?? '').trim().slice(0, 40),
      b.invoiceDay && isDay(b.invoiceDay) ? b.invoiceDay : null,
      String(b.note ?? '').trim().slice(0, 300),
      total,
      vatTotal,
      adminId,
      now,
    ),
  );
  for (const l of parsed) {
    stmts.push(
      env.DB.prepare('UPDATE products SET stock = coalesce(stock, 0) + ?, cost_bani = ? WHERE id = ?').bind(l.qty, l.cost, l.productId),
      env.DB.prepare(
        `INSERT INTO stock_moves (product_id, qty, kind, nir_id, unit_cost_bani, vat_pct, created_by, created_at) VALUES (?, ?, 'nir', ?, ?, ?, ?, ?)`,
      ).bind(l.productId, l.qty, id, l.cost, l.vat, adminId, now),
    );
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    // Două NIR-uri salvate în aceeași clipă ar lua același număr: al doilea reîncearcă.
    if (String(e).includes('UNIQUE') && String(e).includes('number')) return createNir(env, adminId, b);
    throw e;
  }
  return getNir(env, id);
}

/** Anulează un NIR greșit: marfa iese din stoc (dacă nu s-a vândut între timp). */
export async function cancelNir(env: Env, adminId: string, id: string) {
  const doc = await env.DB.prepare('SELECT cancelled_at FROM nir_docs WHERE id = ?').bind(id).first<{ cancelled_at: string | null }>();
  if (!doc) throw new HttpError(404, 'not_found');
  if (doc.cancelled_at) throw new HttpError(409, 'already_cancelled');
  const lines = await env.DB.prepare(`SELECT product_id, qty, unit_cost_bani, vat_pct FROM stock_moves WHERE nir_id = ? AND kind = 'nir'`)
    .bind(id)
    .all<{ product_id: string; qty: number; unit_cost_bani: number; vat_pct: number }>();
  const now = iso(new Date());
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE nir_docs SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL').bind(now, id),
      ...lines.results.flatMap((l) => [
        env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL').bind(l.qty, l.product_id),
        env.DB.prepare(
          `INSERT INTO stock_moves (product_id, qty, kind, nir_id, unit_cost_bani, vat_pct, created_by, created_at) VALUES (?, ?, 'nir_anulat', ?, ?, ?, ?, ?)`,
        ).bind(l.product_id, -l.qty, id, l.unit_cost_bani, l.vat_pct, adminId, now),
      ]),
    ]);
  } catch (e) {
    if (String(e).includes('CHECK constraint')) throw new HttpError(409, 'stock_too_low');
    throw e;
  }
  return getNir(env, id);
}

/** Ieșire din stoc fără vânzare: consum în salon sau casare. */
export async function stockOut(env: Env, adminId: string, b: { productId?: string; qty?: number; kind?: string; note?: string }) {
  const qty = Math.round(Number(b.qty));
  if (!(qty >= 1 && qty <= 100000)) throw new HttpError(400, 'invalid_qty');
  if (b.kind !== 'consum' && b.kind !== 'casare') throw new HttpError(400, 'invalid_kind');
  const p = await env.DB.prepare('SELECT stock, cost_bani FROM products WHERE id = ?').bind(b.productId ?? '').first<{ stock: number | null; cost_bani: number | null }>();
  if (!p) throw new HttpError(404, 'not_found');
  if (p.stock === null) throw new HttpError(409, 'stock_not_tracked');
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').bind(qty, b.productId),
      env.DB.prepare(`INSERT INTO stock_moves (product_id, qty, kind, unit_cost_bani, note, created_by) VALUES (?, ?, ?, ?, ?, ?)`).bind(
        b.productId,
        -qty,
        b.kind,
        p.cost_bani,
        String(b.note ?? '').trim().slice(0, 200),
        adminId,
      ),
    ]);
  } catch (e) {
    if (String(e).includes('CHECK constraint')) throw new HttpError(409, 'stock_too_low');
    throw e;
  }
  return { ok: true };
}

/** Corecție după inventar (sau când stocul e schimbat direct din fișa produsului). */
export function adjustMove(env: Env, adminId: string, productId: string, delta: number, note = '') {
  return env.DB.prepare(`INSERT INTO stock_moves (product_id, qty, kind, unit_cost_bani, note, created_by)
    SELECT id, ?, 'ajustare', cost_bani, ?, ? FROM products WHERE id = ?`).bind(delta, note.slice(0, 200), adminId, productId);
}

export type MoveRow = {
  id: number;
  product_id: string;
  product_name: string;
  unit: string;
  qty: number;
  kind: MoveKind;
  nir_id: string | null;
  nir_number: number | null;
  order_id: string | null;
  unit_cost_bani: number | null;
  note: string;
  created_by_name: string | null;
  created_at: string;
};

export async function listMoves(env: Env, f: { productId?: string; start: string; end: string }) {
  const r = await env.DB.prepare(
    `SELECT m.*, p.name AS product_name, p.unit, n.number AS nir_number, coalesce(nullif(a.name, ''), a.email) AS created_by_name
     FROM stock_moves m JOIN products p ON p.id = m.product_id LEFT JOIN nir_docs n ON n.id = m.nir_id LEFT JOIN admins a ON a.id = m.created_by
     WHERE m.created_at >= ? AND m.created_at < ? ${f.productId ? 'AND m.product_id = ?' : ''} ORDER BY m.id LIMIT 20000`,
  )
    .bind(...(f.productId ? [f.start, f.end, f.productId] : [f.start, f.end]))
    .all<MoveRow>();
  return r.results;
}
