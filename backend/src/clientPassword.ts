import type { Context } from 'hono';
import { normalizePhone, sha256 } from './auth';
import { HttpError, type AppEnv, type Env } from './env';
import { iso } from './time';

// Parola clientului (opțională, pe lângă intrarea cu cod) și protecția contra ghicirii ei.

export const CLIENT_PASSWORD_MIN = 8;
// Limita de sus ține PBKDF2 departe de texte uriașe trimise intenționat.
const CLIENT_PASSWORD_MAX = 200;

export function validClientPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < CLIENT_PASSWORD_MIN) throw new HttpError(400, 'password_too_short');
  if (p.length > CLIENT_PASSWORD_MAX) throw new HttpError(400, 'password_too_long');
  return p;
}

/** Hash-ul folosit când contul nu există sau nu are parolă: verificarea durează la fel, deci timpul nu dă contul de gol. */
export const DUMMY_HASH = 'pbkdf2$100000$00000000000000000000000000000000$' + '0'.repeat(64);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Identifier = { kind: 'email' | 'phone'; value: string };

/** E-mailul sau telefonul scris la intrare; null dacă nu arată a niciunul. */
export function parseIdentifier(raw: unknown): Identifier | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 200) return null;
  if (s.includes('@')) return EMAIL_RE.test(s) ? { kind: 'email', value: s.toLowerCase() } : null;
  try {
    return { kind: 'phone', value: normalizePhone(s) };
  } catch {
    return null;
  }
}

export type PasswordAccount = { id: string; phone: string; email: string | null; password_hash: string | null; phone_unverified: number; terms_accepted_at: string | null };

/** Conturile (active) cu acest e-mail sau telefon; cel mai vechi primul. De obicei unul singur. */
export async function findAccounts(env: Env, id: Identifier): Promise<PasswordAccount[]> {
  const where = id.kind === 'email' ? 'lower(email) = ?' : 'phone = ?';
  const r = await env.DB.prepare(
    `SELECT id, phone, email, password_hash, phone_unverified, terms_accepted_at FROM clients WHERE ${where} AND deleted_at IS NULL ORDER BY created_at LIMIT 3`,
  )
    .bind(id.value)
    .all<PasswordAccount>();
  return r.results;
}

// --- Blocarea după prea multe parole greșite ---

const WINDOW = 15 * 60_000;
const LOCK = 15 * 60_000;
/** Greșeli permise într-un sfert de oră pe un cont (sau pe datele scrise), apoi blocare 15 minute. */
export const ACCOUNT_MAX_FAILS = 5;
/** Pe aceeași adresă IP (mai mult, pentru că o rețea poate fi a mai multor clienți: Wi-Fi-ul salonului, operatorul mobil). */
export const IP_MAX_FAILS = 20;

export type LoginKeys = { ip: string | null; ident: string | null; accounts: string[] };

/** Cheile de blocare: doar hash-uri (IP-ul și ce s-a scris nu se păstrează în clar). */
export async function loginKeys(c: Context<AppEnv>, id: Identifier | null, accountIds: string[]): Promise<LoginKeys> {
  const ip = c.req.header('CF-Connecting-IP');
  const salt = c.env.SOCIAL_KEY ?? c.env.ADMIN_SETUP_KEY ?? '';
  return {
    ip: ip ? `ip:${(await sha256(`login:${salt}:${ip}`)).slice(0, 32)}` : null,
    ident: id ? `id:${(await sha256(`login:${id.kind}:${id.value}`)).slice(0, 32)}` : null,
    accounts: accountIds.map((x) => `acct:${x}`),
  };
}

const all = (k: LoginKeys) => [k.ip, k.ident, ...k.accounts].filter((x): x is string => !!x);

export async function isLocked(env: Env, keys: string[]): Promise<boolean> {
  if (!keys.length) return false;
  const r = await env.DB.prepare(`SELECT 1 FROM login_failures WHERE key IN (${keys.map(() => '?').join(',')}) AND locked_until > ? LIMIT 1`)
    .bind(...keys, iso(new Date()))
    .first();
  return !!r;
}

export const lockedAny = (env: Env, k: LoginKeys) => isLocked(env, all(k));

/** O greșeală în plus pe fiecare cheie; la a N-a greșeală din fereastră cheia se blochează 15 minute. */
export async function recordFailure(env: Env, k: LoginKeys) {
  const now = Date.now();
  const nowIso = iso(new Date(now));
  const win = iso(new Date(now - WINDOW));
  const until = iso(new Date(now + LOCK));
  // O blocare expirată sau o fereastră trecută: numărătoarea o ia de la capăt.
  const reset = `((login_failures.locked_until IS NOT NULL AND login_failures.locked_until <= ?2) OR (login_failures.locked_until IS NULL AND login_failures.first_at < ?3))`;
  const stmt = (key: string, max: number) =>
    env.DB.prepare(
      `INSERT INTO login_failures (key, fails, first_at, locked_until) VALUES (?1, 1, ?2, CASE WHEN ?5 <= 1 THEN ?4 END)
       ON CONFLICT(key) DO UPDATE SET
         fails = CASE WHEN ${reset} THEN 1 ELSE login_failures.fails + 1 END,
         first_at = CASE WHEN ${reset} THEN ?2 ELSE login_failures.first_at END,
         locked_until = CASE WHEN ${reset} THEN NULL WHEN login_failures.fails + 1 >= ?5 THEN ?4 ELSE login_failures.locked_until END`,
    ).bind(key, nowIso, win, until, max);
  const list = [...(k.ip ? [stmt(k.ip, IP_MAX_FAILS)] : []), ...(k.ident ? [stmt(k.ident, ACCOUNT_MAX_FAILS)] : []), ...k.accounts.map((a) => stmt(a, ACCOUNT_MAX_FAILS))];
  if (list.length) await env.DB.batch(list);
}

/** După o intrare reușită (sau o parolă nouă): greșelile contului se uită. Cele pe IP rămân până expiră. */
export async function clearFailures(env: Env, keys: string[]) {
  if (!keys.length) return;
  await env.DB.prepare(`DELETE FROM login_failures WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).run();
}
