import { createSession, newId } from './auth';
import type { Env } from './env';
import { HttpError } from './env';
import { iso } from './time';

// Logare cu Apple sau Google: aplicația primește de la ei un „id token” (JWT semnat), iar noi îl verificăm
// cu cheile lor publice. Prima dată legăm contul extern de un client (cu numărul lui de telefon); apoi intră dintr-o apăsare.

export type Provider = 'apple' | 'google';

const ISSUERS: Record<Provider, string[]> = {
  apple: ['https://appleid.apple.com'],
  google: ['https://accounts.google.com', 'accounts.google.com'],
};
const JWKS: Record<Provider, string> = {
  apple: 'https://appleid.apple.com/auth/keys',
  google: 'https://www.googleapis.com/oauth2/v3/certs',
};

export function audiences(env: Env, provider: Provider): string[] {
  if (provider === 'apple') return (env.APPLE_AUDIENCES ?? 'ro.tafbarbers.app,host.exp.Exponent').split(',').map((s) => s.trim()).filter(Boolean);
  return [env.GOOGLE_IOS_CLIENT_ID, env.GOOGLE_ANDROID_CLIENT_ID, env.GOOGLE_WEB_CLIENT_ID].filter((x): x is string => !!x);
}

/** Ce butoane arată aplicația. Apple apare doar pe iPhone (aplicația verifică singură). */
export function socialConfig(env: Env) {
  return {
    apple: audiences(env, 'apple').length > 0,
    google: audiences(env, 'google').length > 0
      ? { iosClientId: env.GOOGLE_IOS_CLIENT_ID ?? null, androidClientId: env.GOOGLE_ANDROID_CLIENT_ID ?? null, webClientId: env.GOOGLE_WEB_CLIENT_ID ?? null }
      : null,
  };
}

type Jwk = JsonWebKey & { kid?: string };
const keyCache = new Map<string, { at: number; keys: Jwk[] }>();

async function keysFor(env: Env, provider: Provider): Promise<Jwk[]> {
  const url = env.SOCIAL_JWKS_BASE ? `${env.SOCIAL_JWKS_BASE}/${provider}/keys` : JWKS[provider];
  const hit = keyCache.get(url);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.keys;
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(500, 'social_unavailable');
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));

export type Identity = { provider: Provider; subject: string; email: string | null; emailVerified: boolean; name: string };

/** Verifică semnătura, emitentul, destinatarul și expirarea tokenului. */
export async function verifyIdToken(env: Env, provider: Provider, token: string, nonce?: string): Promise<Identity> {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new HttpError(400, 'social_invalid');
  let header: { kid?: string; alg?: string };
  let p: { iss?: string; aud?: string | string[]; exp?: number; iat?: number; sub?: string; email?: string; email_verified?: boolean | string; name?: string; nonce?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    p = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch {
    throw new HttpError(400, 'social_invalid');
  }
  if (header.alg !== 'RS256') throw new HttpError(400, 'social_invalid');
  const jwk = (await keysFor(env, provider)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(400, 'social_invalid');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(400, 'social_invalid');
  const now = Date.now() / 1000;
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!ISSUERS[provider].includes(p.iss ?? '')) throw new HttpError(400, 'social_invalid');
  if (!aud.some((a) => a && audiences(env, provider).includes(a))) throw new HttpError(400, 'social_invalid');
  if (!p.exp || p.exp < now - 60) throw new HttpError(400, 'social_expired');
  if (!p.sub) throw new HttpError(400, 'social_invalid');
  // Apple pune în token hash-ul SHA-256 al nonce-ului trimis de aplicație; Google pune nonce-ul ca atare.
  if (nonce && p.nonce && p.nonce !== nonce && p.nonce !== (await sha256hex(nonce))) throw new HttpError(400, 'social_invalid');
  const email = typeof p.email === 'string' && p.email.includes('@') ? p.email.toLowerCase() : null;
  return { provider, subject: p.sub, email, emailVerified: p.email_verified === true || p.email_verified === 'true', name: (p.name ?? '').trim() };
}

async function sha256hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Contul extern e deja legat: sesiune nouă. Altfel un tichet (15 minute) pentru completarea contului cu telefonul. */
export async function socialSignIn(env: Env, id: Identity, nameHint: string) {
  const linked = await env.DB.prepare(
    `SELECT i.client_id FROM client_identities i JOIN clients c ON c.id = i.client_id WHERE i.provider = ? AND i.subject = ? AND c.deleted_at IS NULL`,
  )
    .bind(id.provider, id.subject)
    .first<{ client_id: string }>();
  if (linked) return { token: await createSession(env.DB, 'client', linked.client_id), clientId: linked.client_id };
  const ticket = newId('st');
  await env.DB.prepare('DELETE FROM social_tickets WHERE expires_at < ?').bind(iso(new Date())).run();
  await env.DB.prepare('INSERT INTO social_tickets (id, provider, subject, email, email_verified, name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(ticket, id.provider, id.subject, id.email, id.emailVerified ? 1 : 0, (id.name || nameHint).slice(0, 80), iso(new Date(Date.now() + 15 * 60_000)))
    .run();
  return { needsPhone: true as const, ticket, email: id.email, name: (id.name || nameHint).slice(0, 80) };
}

export type Ticket = { id: string; provider: Provider; subject: string; email: string | null; email_verified: number; name: string };

export async function readTicket(env: Env, ticket: string | undefined): Promise<Ticket> {
  const t = ticket
    ? await env.DB.prepare('SELECT * FROM social_tickets WHERE id = ? AND expires_at > ?').bind(ticket, iso(new Date())).first<Ticket>()
    : null;
  if (!t) throw new HttpError(400, 'social_expired');
  return t;
}

/** Leagă contul extern de client și consumă tichetul. */
export async function linkTicket(env: Env, t: Ticket, clientId: string) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO client_identities (provider, subject, client_id, email) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider, subject) DO UPDATE SET client_id = excluded.client_id, email = excluded.email`,
    ).bind(t.provider, t.subject, clientId, t.email),
    env.DB.prepare('DELETE FROM social_tickets WHERE id = ?').bind(t.id),
  ]);
}
