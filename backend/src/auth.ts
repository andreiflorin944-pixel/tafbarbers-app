import type { Context, Next } from 'hono';
import { HttpError, type AppEnv } from './env';
import { iso } from './time';

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 10000).padStart(4, '0');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomToken(12)}`;
}

/** Normalizează un număr românesc la E.164 (+40...). Acceptă și numere străine cu +. */
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_phone');
  let p = raw.replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^07\d{8}$/.test(p)) p = '+4' + p;
  if (/^7\d{8}$/.test(p)) p = '+40' + p;
  if (!/^\+\d{8,15}$/.test(p)) throw new HttpError(400, 'invalid_phone');
  return p;
}

// Parole admin: PBKDF2-SHA256, 100k iterații, sare aleatoare.
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await pbkdf2(password, salt, 100_000);
  return `pbkdf2$100000$${hex(salt.buffer)}$${hex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iter, saltHex, hashHex] = stored.split('$');
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const bits = hex(await pbkdf2(password, salt, Number(iter)));
  return timingSafeEqual(bits, hashHex);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const DAY = 86_400_000;

export async function createSession(db: D1Database, kind: 'client' | 'admin', subjectId: string): Promise<string> {
  const token = randomToken();
  const ttl = kind === 'client' ? 180 * DAY : 14 * DAY;
  await db
    .prepare('INSERT INTO sessions (token_hash, kind, subject_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), kind, subjectId, iso(new Date(Date.now() + ttl)))
    .run();
  return token;
}

export async function deleteSession(db: D1Database, token: string) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

function bearer(c: Context): string | null {
  const h = c.req.header('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function lookup(c: Context<AppEnv>, kind: 'client' | 'admin') {
  const token = bearer(c);
  if (!token) return null;
  return c.env.DB.prepare('SELECT subject_id FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?')
    .bind(await sha256(token), kind, iso(new Date()))
    .first<{ subject_id: string }>();
}

export async function requireClient(c: Context<AppEnv>, next: Next) {
  const s = await lookup(c, 'client');
  if (!s) throw new HttpError(401, 'unauthorized');
  c.set('client', { kind: 'client', clientId: s.subject_id });
  await next();
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const s = await lookup(c, 'admin');
  if (!s) throw new HttpError(401, 'unauthorized');
  const a = await c.env.DB.prepare('SELECT id, barber_id FROM admins WHERE id = ?')
    .bind(s.subject_id)
    .first<{ id: string; barber_id: string | null }>();
  if (!a) throw new HttpError(401, 'unauthorized');
  c.set('admin', { kind: 'admin', adminId: a.id, barberId: a.barber_id });
  await next();
}

export const tokenFrom = bearer;
