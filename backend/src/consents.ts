import type { Context } from 'hono';
import type { AppEnv, Env } from './env';
import { HttpError } from './env';
import { legalHash, legalVersions } from './legal';
import { iso } from './time';

// Dovada acordurilor („semnătura”, GDPR art. 7 alin. 1): de fiecare dată când clientul acceptă termenii și
// politica de confidențialitate sau își dă / își retrage acordul pentru oferte, păstrăm un rând cu ce a acceptat,
// versiunea documentelor în acel moment, data, adresa IP, dispozitivul (user agent), limba și de unde (aplicație / web).

export type ConsentSource = 'register' | 'social' | 'first_login' | 'login' | 'profile' | 'sign';
/** Semnătura de la derularea documentelor: numele scris și versiunile pe care le-a avut clientul pe ecran. */
export type Signature = { signature: string; termsVersion: string; privacyVersion: string };
type Marketing = { push: boolean; email: boolean; sms: boolean };

type ConsentRow = {
  id: number;
  source: string;
  terms: number;
  privacy: number;
  marketing: number | null;
  channels: string;
  terms_version: string | null;
  privacy_version: string | null;
  ip: string | null;
  user_agent: string | null;
  lang: string | null;
  channel: string | null;
  anonymized_at: string | null;
  signature: string | null;
  doc_hash: string | null;
  read_full: number | null;
  created_at: string;
};

export const marketingChannels = (m: Marketing) => (['push', 'email', 'sms'] as const).filter((ch) => m[ch]).join(',');

/**
 * Salvează un acord. `terms` = a acceptat acum termenii și confidențialitatea; `marketing` = starea ofertelor după acest
 * pas (null când ofertele nu s-au schimbat aici). Aplicația pe telefon nu trimite antetul Origin, browserul îl trimite.
 */
export async function recordConsent(
  env: Env,
  c: Context<AppEnv>,
  clientId: string,
  x: { source: ConsentSource; terms: boolean; marketing: Marketing | null; lang?: string | null; sign?: Signature | null },
) {
  const v = await legalVersions(env);
  const lang = ['ro', 'en', 'fr'].includes(x.lang ?? '') ? x.lang! : null;
  const channels = x.marketing ? marketingChannels(x.marketing) : '';
  const sign = x.terms && x.sign ? x.sign : null;
  if (sign) assertCurrent(v, sign);
  await env.DB.prepare(
    `INSERT INTO client_consents (client_id, source, terms, privacy, marketing, channels, terms_version, privacy_version, ip, user_agent, lang, channel, signature, doc_hash, read_full, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      clientId,
      x.source,
      x.terms ? 1 : 0,
      x.terms ? 1 : 0,
      x.marketing ? (channels ? 1 : 0) : null,
      channels,
      v.terms,
      v.privacy,
      c.req.header('CF-Connecting-IP') ?? null,
      (c.req.header('User-Agent') ?? '').slice(0, 400) || null,
      lang,
      c.req.header('Origin') ? 'web' : 'app',
      sign ? sign.signature : null,
      sign ? await legalHash(env, lang ?? 'ro') : null,
      sign ? 1 : null,
      iso(new Date()),
    )
    .run();
}

/** Lista acordurilor unui client, cele mai noi primele (fișa din panou și „Descarcă datele mele”). */
export async function listConsents(env: Env, clientId: string) {
  const r = await env.DB.prepare('SELECT * FROM client_consents WHERE client_id = ? ORDER BY id DESC LIMIT 500').bind(clientId).all<ConsentRow>();
  return r.results.map((x) => ({
    id: x.id,
    at: x.created_at,
    source: x.source,
    terms: !!x.terms,
    privacy: !!x.privacy,
    marketing: x.marketing === null ? null : !!x.marketing,
    channels: x.channels ? x.channels.split(',') : [],
    termsVersion: x.terms_version,
    privacyVersion: x.privacy_version,
    ip: x.ip,
    userAgent: x.user_agent,
    lang: x.lang,
    channel: x.channel,
    anonymized: !!x.anonymized_at,
    signature: x.signature,
    docHash: x.doc_hash,
    readFull: !!x.read_full,
  }));
}

/** Clientul a semnat ce avea pe ecran: dacă între timp s-au schimbat documentele, trebuie să citească versiunea nouă. */
function assertCurrent(v: { terms: string; privacy: string }, sign: Signature) {
  if (sign.termsVersion !== v.terms || sign.privacyVersion !== v.privacy) throw new HttpError(409, 'legal_changed');
}

/** Verificarea de mai sus înainte de a crea contul (ca să nu rămână un cont fără dovada semnăturii). */
export async function checkSignature(env: Env, sign: Signature | null) {
  if (sign) assertCurrent(await legalVersions(env), sign);
}

/** Semnătura curată: numele scris, cel puțin 3 litere, fără spații în plus. Aruncă `signature_required` altfel. */
export function cleanSignature(raw: unknown, termsVersion: unknown, privacyVersion: unknown): Signature {
  const signature = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if ((signature.match(/\p{L}/gu) ?? []).length < 3) throw new HttpError(400, 'signature_required');
  if (typeof termsVersion !== 'string' || typeof privacyVersion !== 'string') throw new HttpError(400, 'signature_required');
  return { signature, termsVersion, privacyVersion };
}

/** Semnătura opțională din cererile de creare a contului (aplicațiile vechi nu o trimit). */
export function signatureFrom(b: { signature?: unknown; termsVersion?: unknown; privacyVersion?: unknown }): Signature | null {
  return b.signature === undefined || b.signature === null || b.signature === '' ? null : cleanSignature(b.signature, b.termsVersion, b.privacyVersion);
}

/**
 * Clientul trebuie să semneze: nu are o semnătură pentru versiunile de acum ale termenilor și politicii
 * (cont vechi, client adăugat din panou, sau documentele s-au schimbat de la ultima semnare).
 */
export async function legalPending(env: Env, clientId: string) {
  const v = await legalVersions(env);
  const r = await env.DB.prepare(
    'SELECT 1 AS ok FROM client_consents WHERE client_id = ? AND terms = 1 AND signature IS NOT NULL AND terms_version = ? AND privacy_version = ? LIMIT 1',
  )
    .bind(clientId, v.terms, v.privacy)
    .first<{ ok: number }>();
  return !r;
}

/**
 * La ștergerea contului NU ștergem rândurile: păstrăm doar o evidență anonimă (data, ce a acceptat, versiunea
 * documentelor), ca dovadă că acest cont a existat și și-a dat acordul. Adresa IP și dispozitivul (user agent)
 * se șterg (și semnătura, care e numele), iar contul rămas nu mai are nume, telefon sau e-mail, deci rândurile nu mai duc la o persoană.
 */
export function anonymizeConsents(env: Env, clientId: string, now: string) {
  return env.DB.prepare('UPDATE client_consents SET ip = NULL, user_agent = NULL, signature = NULL, anonymized_at = ? WHERE client_id = ?').bind(now, clientId);
}
