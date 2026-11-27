// Codurile de reducere pentru cardurile cadou (Marketing → Coduri reducere card cadou).
// Proprietarul generează o serie (ex. 50 de coduri CRACIUN-XXXXX, 10% sau 20 lei, câte o folosire, până pe 31 decembrie)
// sau un singur cod ales de el (ex. TAF10, folosit de oricâți). La cumpărare (site, aplicație, salon) codul scade prețul;
// cardul rămâne la valoarea lui întreagă. O folosire = un card cadou plătit cu acel cod.
import { newId } from './auth';
import { HttpError, type Env } from './env';
import { localDay } from './time';

export type PromoRow = {
  id: string;
  code: string;
  batch: string;
  kind: 'percent' | 'fixed';
  value: number;
  max_uses: number | null;
  expires_day: string | null;
  active: number;
  created_at: string;
  used?: number;
};

// Fără litere și cifre care se confundă (O/0, I/1/L).
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomPart = (n: number) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => ALPHA[x % ALPHA.length]).join('');
};
export const normCode = (raw: unknown) => String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** Câte carduri plătite au folosit codul (plus cele în curs de plată din ultimele 40 de minute, ca să nu se vândă peste limită). */
const USED_SQL = `(SELECT count(*) FROM gift_cards g WHERE g.promo_code_id = p.id AND (g.status IN ('active','used') OR (g.status = 'pending' AND g.created_at > ?)))`;
const recent = () => new Date(Date.now() - 40 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

export const promoView = (p: PromoRow, today: string) => ({
  id: p.id,
  code: p.code,
  batch: p.batch,
  kind: p.kind,
  value: p.value,
  maxUses: p.max_uses,
  used: p.used ?? 0,
  expiresDay: p.expires_day,
  active: !!p.active,
  state: !p.active ? 'off' : p.expires_day && p.expires_day < today ? 'expired' : p.max_uses !== null && (p.used ?? 0) >= p.max_uses ? 'used_up' : 'ok',
  createdAt: p.created_at,
});

export async function listPromos(env: Env) {
  const r = await env.DB.prepare(`SELECT p.*, (SELECT count(*) FROM gift_cards g WHERE g.promo_code_id = p.id AND g.status IN ('active','used')) AS used FROM gift_promo_codes p ORDER BY p.created_at DESC, p.code LIMIT 2000`).all<PromoRow>();
  const today = localDay(env.TIMEZONE || 'Europe/Bucharest', new Date());
  return r.results.map((p) => promoView(p, today));
}

/** O serie nouă: `count` coduri cu prefix sau un singur cod ales (`code`). */
export async function generatePromos(env: Env, adminId: string | null, b: Record<string, unknown>) {
  const kind = b.kind === 'fixed' ? 'fixed' : b.kind === 'percent' ? 'percent' : null;
  if (!kind) throw new HttpError(400, 'invalid_kind');
  const value = Math.round(Number(b.value));
  if (kind === 'percent' ? !(value >= 1 && value <= 90) : !(value >= 1 && value <= 2000)) throw new HttpError(400, 'invalid_value');
  const maxUses = b.maxUses === null || b.maxUses === '' || b.maxUses === undefined || Number(b.maxUses) === 0 ? null : Math.round(Number(b.maxUses));
  if (maxUses !== null && !(maxUses >= 1 && maxUses <= 100000)) throw new HttpError(400, 'invalid_uses');
  const expires = b.expiresDay ? String(b.expiresDay) : null;
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new HttpError(400, 'invalid_date');
  const batch = String(b.batch ?? '').trim().slice(0, 60);
  const custom = normCode(b.code);
  let codes: string[];
  if (custom) {
    if (!/^[A-Z0-9-]{3,20}$/.test(custom)) throw new HttpError(400, 'invalid_code');
    if (await env.DB.prepare('SELECT 1 FROM gift_promo_codes WHERE code = ?').bind(custom).first()) throw new HttpError(409, 'code_taken');
    codes = [custom];
  } else {
    const count = Math.round(Number(b.count));
    if (!(count >= 1 && count <= 500)) throw new HttpError(400, 'invalid_count');
    const prefix = normCode(b.prefix).replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'TAF';
    const set = new Set<string>();
    while (set.size < count) set.add(`${prefix}-${randomPart(5)}`);
    codes = [...set];
  }
  const stmts = codes.map((code) =>
    env.DB.prepare('INSERT OR IGNORE INTO gift_promo_codes (id, code, batch, kind, value, max_uses, expires_day, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(newId('gp'), code, batch, kind, value, maxUses, expires, adminId),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { created: codes.length, codes };
}

/** Oprește / pornește un cod sau toată seria lui. */
export async function setPromoActive(env: Env, b: { id?: string; batch?: string; active?: boolean }) {
  if (typeof b.active !== 'boolean') throw new HttpError(400, 'invalid_active');
  const r = b.id
    ? await env.DB.prepare('UPDATE gift_promo_codes SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, b.id).run()
    : typeof b.batch === 'string'
      ? await env.DB.prepare('UPDATE gift_promo_codes SET active = ? WHERE batch = ?').bind(b.active ? 1 : 0, b.batch).run()
      : null;
  if (!r) throw new HttpError(400, 'invalid_target');
  return { changed: r.meta.changes };
}

/** Prețul cu codul: valoarea cardului minus reducerea, rotunjit la leu, cel puțin 5 lei. Aruncă eroare dacă codul nu e bun. */
export async function quotePromo(env: Env, rawCode: unknown, amountLei: number) {
  const code = normCode(rawCode);
  if (!code) throw new HttpError(400, 'promo_invalid');
  const p = await env.DB.prepare(`SELECT p.*, ${USED_SQL} AS used FROM gift_promo_codes p WHERE p.code = ?`).bind(recent(), code).first<PromoRow>();
  if (!p || !p.active) throw new HttpError(404, 'promo_invalid');
  const today = localDay(env.TIMEZONE || 'Europe/Bucharest', new Date());
  if (p.expires_day && p.expires_day < today) throw new HttpError(409, 'promo_expired');
  if (p.max_uses !== null && (p.used ?? 0) >= p.max_uses) throw new HttpError(409, 'promo_used_up');
  const off = p.kind === 'percent' ? Math.round((amountLei * p.value) / 100) : p.value;
  const price = Math.max(5, amountLei - off);
  return { id: p.id, code: p.code, kind: p.kind, value: p.value, amount: amountLei, discount: amountLei - price, price };
}
