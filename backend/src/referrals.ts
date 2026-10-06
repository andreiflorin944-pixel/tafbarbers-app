import { newId } from './auth';
import { getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';
import { iso } from './time';

// Recomandări: fiecare client are un cod; cine își face cont cu el îi aduce un beneficiu,
// dat automat (beneficiul standard din panou) sau ales de admin pentru fiecare recomandare.

export type BonusKind = 'percent' | 'amount' | 'free' | 'other';
export type Reward = { title: string; kind: BonusKind; value: number | null; validDays: number | null };
export type ReferralSettings = { enabled: boolean; auto: boolean; standard: Reward };

export const DEFAULT_REFERRAL: ReferralSettings = {
  enabled: true,
  auto: true,
  standard: { title: '10% reducere la următoarea tunsoare', kind: 'percent', value: 10, validDays: 90 },
};

export const getReferralSettings = async (env: Env): Promise<ReferralSettings> => ({ ...DEFAULT_REFERRAL, ...(await getSetting(env, 'referral', DEFAULT_REFERRAL)) });

export function parseReward(b: Partial<Reward> | undefined): Reward {
  const title = String(b?.title ?? '').trim().slice(0, 120);
  if (!title) throw new HttpError(400, 'title_required');
  const kind = (['percent', 'amount', 'free', 'other'] as const).includes(b?.kind as BonusKind) ? (b!.kind as BonusKind) : 'other';
  let value: number | null = null;
  if (kind === 'percent' || kind === 'amount') {
    value = Number(b?.value);
    if (!(value > 0) || (kind === 'percent' && value > 100) || value > 10000) throw new HttpError(400, 'invalid_value');
  }
  const days = b?.validDays === null || b?.validDays === undefined || (b.validDays as unknown) === '' ? null : Math.round(Number(b.validDays));
  if (days !== null && !(days >= 1 && days <= 3650)) throw new HttpError(400, 'invalid_value');
  return { title, kind, value, validDays: days };
}

export async function saveReferralSettings(env: Env, b: Partial<ReferralSettings>) {
  const cur = await getReferralSettings(env);
  const next: ReferralSettings = {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
    auto: typeof b.auto === 'boolean' ? b.auto : cur.auto,
    standard: b.standard ? parseReward(b.standard) : cur.standard,
  };
  await setSetting(env, 'referral', next);
  return next;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // fără 0/O, 1/I

/** Codul de recomandare al clientului; îl creează la prima cerere. */
export async function referralCode(env: Env, clientId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT referral_code FROM clients WHERE id = ?').bind(clientId).first<{ referral_code: string | null }>();
  if (row?.referral_code) return row.referral_code;
  for (let i = 0; i < 5; i++) {
    const a = new Uint8Array(6);
    crypto.getRandomValues(a);
    const code = [...a].map((x) => ALPHABET[x % ALPHABET.length]).join('');
    const r = await env.DB.prepare('UPDATE clients SET referral_code = ? WHERE id = ? AND referral_code IS NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE referral_code = ?)')
      .bind(code, clientId, code)
      .run();
    if (r.meta.changes) return code;
    const again = await env.DB.prepare('SELECT referral_code FROM clients WHERE id = ?').bind(clientId).first<{ referral_code: string | null }>();
    if (again?.referral_code) return again.referral_code;
  }
  throw new HttpError(500, 'server_error');
}

/** La crearea unui cont cu cod: leagă contul nou de cel care l-a recomandat și, dacă e automat, dă beneficiul. */
export async function applyReferral(env: Env, newClientId: string, rawCode: unknown) {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!code) return;
  const s = await getReferralSettings(env);
  if (!s.enabled) return;
  const ref = await env.DB.prepare('SELECT id FROM clients WHERE referral_code = ? AND deleted_at IS NULL').bind(code).first<{ id: string }>();
  if (!ref || ref.id === newClientId) return;
  await env.DB.prepare('UPDATE clients SET referred_by = ? WHERE id = ? AND referred_by IS NULL').bind(ref.id, newClientId).run();
  if (s.auto) await giveBonus(env, ref.id, s.standard, 'referral', newClientId);
}

export async function giveBonus(env: Env, clientId: string, r: Reward, source: 'manual' | 'referral', referralOf: string | null = null) {
  const id = newId('bn');
  const expires = r.validDays ? iso(new Date(Date.now() + r.validDays * 86_400_000)) : null;
  await env.DB.prepare('INSERT INTO bonuses (id, client_id, title, kind, value, source, referral_of, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, clientId, r.title, r.kind, r.value, source, referralOf, expires)
    .run();
  return id;
}

type BonusRow = {
  id: string;
  title: string;
  kind: BonusKind;
  value: number | null;
  source: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  used_at: string | null;
  referral_name?: string | null;
};
export const bonus = (r: BonusRow) => {
  const expired = r.status === 'active' && !!r.expires_at && r.expires_at < iso(new Date());
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    value: r.value,
    source: r.source,
    status: expired ? 'expired' : r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    usedAt: r.used_at,
    ...(r.referral_name !== undefined && { referralName: r.referral_name }),
  };
};

export async function getBonuses(env: Env, clientId: string, withNames: boolean) {
  const r = await env.DB.prepare(
    `SELECT b.*, ${withNames ? 'n.name' : 'NULL'} AS referral_name FROM bonuses b LEFT JOIN clients n ON n.id = b.referral_of
     WHERE b.client_id = ? AND b.status != 'cancelled' ORDER BY b.created_at DESC LIMIT 100`,
  )
    .bind(clientId)
    .all<BonusRow>();
  return r.results.map(bonus);
}

/** Ce vede clientul: codul lui, câți a adus și bonusurile. */
export async function myReferrals(env: Env, clientId: string) {
  const s = await getReferralSettings(env);
  const [code, count, bonuses] = await Promise.all([
    referralCode(env, clientId),
    env.DB.prepare('SELECT count(*) AS n FROM clients WHERE referred_by = ? AND deleted_at IS NULL').bind(clientId).first<{ n: number }>(),
    getBonuses(env, clientId, false),
  ]);
  return { enabled: s.enabled, code, referred: count?.n ?? 0, reward: s.enabled ? s.standard.title : null, bonuses };
}
