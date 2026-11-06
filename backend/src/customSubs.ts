import { newId } from './auth';
import { getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';

// Abonament personalizat („Creează-ți abonamentul”): clientul alege singur serviciile pe o lună (30 de zile),
// ex. 2 × Skin Fade + 2 × Barbă, iar reducerea crește cu numărul de vizite: 2 → 5%, 3 → 10%, 4 → 15%.
// Un serviciu combinat (tuns + barbă) e o singură vizită. Prețul = suma prețurilor din listă minus reducerea,
// rotunjit în jos la leu întreg (în favoarea clientului).
// Fiecare combinație devine un plan ascuns (`plans.custom = 1`), refolosit cât timp combinația și prețul sunt aceleași,
// așa că plata cu cardul, reînnoirea automată, activarea la salon și panoul merg la fel ca la abonamentele obișnuite.

export type CustomSubSettings = {
  enabled: boolean;
  /** Reducerea (%) după numărul de vizite: `discounts[n]` pentru n vizite. */
  discounts: Record<string, number>;
  minVisits: number;
  maxVisits: number;
  periodDays: number;
  /** Serviciile care pot intra; gol = toate serviciile active. */
  serviceIds: string[];
};

export const DEFAULT_CUSTOM_SUB: CustomSubSettings = {
  enabled: false,
  discounts: { '2': 5, '3': 10, '4': 15 },
  minVisits: 2,
  maxVisits: 4,
  periodDays: 30,
  serviceIds: [],
};

export async function getCustomSubSettings(env: Env): Promise<CustomSubSettings> {
  const s = await getSetting<Partial<CustomSubSettings>>(env, 'custom_sub', DEFAULT_CUSTOM_SUB);
  return { ...DEFAULT_CUSTOM_SUB, ...s, discounts: { ...(s.discounts ?? DEFAULT_CUSTOM_SUB.discounts) } };
}

const int = (v: unknown, min: number, max: number, code: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, code);
  return n;
};

/** Salvează setările din panou, validate. */
export async function saveCustomSubSettings(env: Env, b: Partial<CustomSubSettings>) {
  const cur = await getCustomSubSettings(env);
  const next: CustomSubSettings = { ...cur };
  if (b.enabled !== undefined) next.enabled = !!b.enabled;
  if (b.minVisits !== undefined) next.minVisits = int(b.minVisits, 1, 20, 'invalid_min_visits');
  if (b.maxVisits !== undefined) next.maxVisits = int(b.maxVisits, 1, 20, 'invalid_max_visits');
  if (next.maxVisits < next.minVisits) throw new HttpError(400, 'invalid_max_visits');
  if (b.periodDays !== undefined) next.periodDays = int(b.periodDays, 7, 365, 'invalid_period');
  if (b.serviceIds !== undefined) {
    if (!Array.isArray(b.serviceIds)) throw new HttpError(400, 'invalid_body');
    next.serviceIds = b.serviceIds.map(String).filter((s) => /^[\w-]+$/.test(s));
  }
  if (b.discounts !== undefined) {
    if (!b.discounts || typeof b.discounts !== 'object') throw new HttpError(400, 'invalid_body');
    const d: Record<string, number> = {};
    for (const [k, v] of Object.entries(b.discounts)) {
      const n = int(k, 1, 20, 'invalid_discount');
      const pct = Number(v);
      if (!(pct >= 0 && pct <= 90)) throw new HttpError(400, 'invalid_discount');
      d[String(n)] = Math.round(pct * 10) / 10;
    }
    next.discounts = d;
  }
  await setSetting(env, 'custom_sub', next);
  return next;
}

/** Reducerea pentru `n` vizite: treapta cea mai mare până la n (peste ultima treaptă rămâne ultima). */
export function discountFor(s: Pick<CustomSubSettings, 'discounts'>, n: number) {
  let best = 0;
  let bestAt = 0;
  for (const [k, v] of Object.entries(s.discounts)) {
    const at = Number(k);
    if (at <= n && at >= bestAt) {
      best = v;
      bestAt = at;
    }
  }
  return best;
}

export type CartItem = { serviceId: string; qty: number };

/** "svc-a:2,svc-b:1" ⇄ [{serviceId, qty}], ordonat după id, ca aceeași combinație să dea același text. */
export const itemsText = (items: CartItem[]) =>
  [...items]
    .sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0))
    .map((i) => `${i.serviceId}:${i.qty}`)
    .join(',');
export const parseItems = (t: string | null | undefined): CartItem[] =>
  t
    ? t
        .split(',')
        .map((x) => x.split(':'))
        .filter(([id, q]) => id && Number(q) > 0)
        .map(([id, q]) => ({ serviceId: id!, qty: Number(q) }))
    : [];

type Svc = { id: string; name: string; price_bani: number };

/**
 * Calculează prețul unei combinații cu prețurile de acum. Aruncă eroare dacă nu se poate cumpăra
 * (oprit, prea puține / prea multe vizite, serviciu inexistent sau neinclus).
 */
export async function quoteCustom(env: Env, raw: unknown, s?: CustomSubSettings) {
  const st = s ?? (await getCustomSubSettings(env));
  if (!Array.isArray(raw)) throw new HttpError(400, 'invalid_body');
  const merged = new Map<string, number>();
  for (const x of raw as Array<{ serviceId?: unknown; qty?: unknown }>) {
    const id = String(x?.serviceId ?? '');
    if (!/^[\w-]+$/.test(id)) throw new HttpError(400, 'invalid_body');
    const q = Number(x?.qty ?? 1);
    if (!Number.isInteger(q) || q < 0 || q > 20) throw new HttpError(400, 'invalid_body');
    if (q) merged.set(id, (merged.get(id) ?? 0) + q);
  }
  const items: CartItem[] = [...merged].map(([serviceId, qty]) => ({ serviceId, qty }));
  const visits = items.reduce((a, i) => a + i.qty, 0);
  if (visits < st.minVisits) throw new HttpError(400, 'too_few_visits');
  if (visits > st.maxVisits) throw new HttpError(400, 'too_many_visits');
  const ids = items.map((i) => i.serviceId);
  const r = await env.DB.prepare(`SELECT id, name, price_bani FROM services WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<Svc>();
  const byId = new Map(r.results.map((x) => [x.id, x]));
  for (const i of items) {
    if (!byId.has(i.serviceId) || (st.serviceIds.length && !st.serviceIds.includes(i.serviceId))) throw new HttpError(400, 'service_not_allowed');
  }
  const fullBani = items.reduce((a, i) => a + byId.get(i.serviceId)!.price_bani * i.qty, 0);
  const pct = discountFor(st, visits);
  // Rotunjit în jos la leu întreg.
  const priceBani = Math.floor((fullBani * (100 - pct)) / 100 / 100) * 100;
  const lines = items.map((i) => ({ serviceId: i.serviceId, name: byId.get(i.serviceId)!.name, qty: i.qty, price: byId.get(i.serviceId)!.price_bani / 100 }));
  const name = `Abonament personalizat: ${lines.map((l) => `${l.qty} × ${l.name}`).join(' + ')}`.slice(0, 200);
  return { items, lines, visits, pct, fullBani, priceBani, periodDays: st.periodDays, name };
}
export type CustomQuote = Awaited<ReturnType<typeof quoteCustom>>;

/** Planul ascuns al combinației (același conținut, preț și durată = același plan), creat la nevoie. */
export async function ensureCustomPlan(env: Env, q: CustomQuote) {
  const text = itemsText(q.items);
  const found = await env.DB.prepare('SELECT id FROM plans WHERE custom = 1 AND items = ? AND price_bani = ? AND period_days = ? LIMIT 1')
    .bind(text, q.priceBani, q.periodDays)
    .first<{ id: string }>();
  if (found) return found.id;
  const id = newId('pc');
  await env.DB.prepare(
    `INSERT INTO plans (id, name, description, price_bani, period_days, cuts, service_ids, sort, active, custom, items) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 1, 1, ?)`,
  )
    .bind(id, q.name, `Reducere ${q.pct}%`, q.priceBani, q.periodDays, q.visits, q.items.map((i) => i.serviceId).join(','), text)
    .run();
  return id;
}

/** Ce s-a folosit din fiecare serviciu al abonamentelor personalizate: subId → serviceId → vizite finalizate. */
export async function usedByService(env: Env, subIds: string[]) {
  const out = new Map<string, Map<string, number>>();
  if (!subIds.length) return out;
  for (let i = 0; i < subIds.length; i += 50) {
    const chunk = subIds.slice(i, i + 50);
    const r = await env.DB.prepare(
      `SELECT subscription_id AS s, service_id AS v, count(*) AS n FROM bookings WHERE payment = 'subscription' AND subscription_id IN (${chunk.map(() => '?').join(',')}) GROUP BY subscription_id, service_id`,
    )
      .bind(...chunk)
      .all<{ s: string; v: string; n: number }>();
    for (const x of r.results) {
      if (!out.has(x.s)) out.set(x.s, new Map());
      out.get(x.s)!.set(x.v, x.n);
    }
  }
  return out;
}

/**
 * Cât se returnează la anularea unui abonament personalizat: suma plătită minus vizitele folosite la prețul întreg (fără reducere), minim 0.
 * Prețul întreg = prețul de acum al serviciului.
 */
export async function customRefundBani(env: Env, sub: { id: string; price_bani: number; items: string | null }) {
  const used = (await usedByService(env, [sub.id])).get(sub.id) ?? new Map<string, number>();
  if (!used.size) return sub.price_bani;
  const ids = [...used.keys()];
  const r = await env.DB.prepare(`SELECT id, price_bani FROM services WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; price_bani: number }>();
  const price = new Map(r.results.map((x) => [x.id, x.price_bani]));
  const usedBani = [...used].reduce((a, [id, n]) => a + (price.get(id) ?? 0) * n, 0);
  return Math.max(0, sub.price_bani - usedBani);
}
