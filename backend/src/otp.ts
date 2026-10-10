import type { Context } from 'hono';
import { normalizePhone, randomCode, sha256, timingSafeEqual } from './auth';
import { getBusiness } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { getAutomations } from './growth';
import { otpEmail, resetEmail } from './messages';
import { sendEmail, sendSms } from './notify';
import { renderTemplate } from './templates';
import { iso } from './time';

// Codurile de 6 cifre (intrare în cont, parolă uitată, schimbarea parolei): un singur cod activ pe număr de telefon,
// cu aceleași limite oriunde se cere.

export const OTP_TTL = 10 * 60_000;
/** Câte coduri greșite se acceptă pe un număr într-o oră (și la coduri noi: încercările nu se iau de la capăt la retrimitere). */
export const OTP_MAX_TRIES = 8;
/** Câte coduri se pot cere pe zi pentru același număr sau aceeași adresă. */
const OTP_PER_DAY = 10;
// RO, MD, FR, BE, CH, LU, IT, ES, DE, AT, UK, IE, NL.
const OTP_PREFIXES = ['+40', '+373', '+33', '+32', '+41', '+352', '+39', '+34', '+49', '+43', '+44', '+353', '+31'];

/**
 * Trimite un cod nou pe e-mail sau SMS, după toate limitele (prefixe SMS, totaluri zilnice, pe număr / adresă, 45 de secunde
 * între coduri, prea multe greșeli în ultima oră). `purpose: 'reset'` schimbă doar textul e-mailului (parolă nouă).
 */
export async function issueCode(
  c: Context<AppEnv>,
  o: { phone: string; email: string | null; channel: 'email' | 'sms'; lang: string; purpose?: 'login' | 'reset' },
): Promise<{ code: string }> {
  const { phone, email, channel, lang } = o;
  // Protecție contra abuzului: SMS doar spre prefixe europene uzuale și limite zilnice totale pe canal.
  if (channel === 'sms' && !(await getAutomations(c.env)).otpSms) throw new HttpError(400, 'sms_code_off');
  if (channel === 'sms' && !OTP_PREFIXES.some((p) => phone.startsWith(p))) throw new HttpError(400, 'country_not_supported');
  if (channel === 'email' && !email) throw new HttpError(400, 'invalid_email');
  const today = await c.env.DB.prepare(`SELECT count(*) AS n FROM message_log WHERE kind = 'otp' AND channel = ? AND created_at > ?`)
    .bind(channel, iso(new Date(Date.now() - 86_400_000)))
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= (channel === 'sms' ? 500 : 2000)) throw new HttpError(429, 'too_many_requests');
  // Și pe fiecare număr / adresă: cel mult OTP_PER_DAY coduri pe zi.
  const mine = await c.env.DB.prepare(`SELECT count(*) AS n FROM message_log WHERE kind = 'otp' AND recipient IN (?, ?) AND created_at > ?`)
    .bind(phone, email ?? phone, iso(new Date(Date.now() - 86_400_000)))
    .first<{ n: number }>();
  if ((mine?.n ?? 0) >= OTP_PER_DAY) throw new HttpError(429, 'too_many_requests');
  const prev = await c.env.DB.prepare('SELECT expires_at, attempts FROM otp_codes WHERE phone = ?')
    .bind(phone)
    .first<{ expires_at: string; attempts: number }>();
  // Cel mult un cod la 45 de secunde pe număr.
  if (prev && Date.parse(prev.expires_at) - OTP_TTL + 45_000 > Date.now()) throw new HttpError(429, 'too_many_requests');
  // Prea multe coduri greșite în ultima oră: nici un cod nou până nu trece ora.
  const recent = iso(new Date(Date.now() - 3_600_000 + OTP_TTL));
  if (prev && prev.expires_at > recent && prev.attempts >= OTP_MAX_TRIES) throw new HttpError(429, 'too_many_attempts');

  // Contul demo pentru verificarea Apple / Google: un număr anume primește mereu același cod, fără SMS.
  const [reviewPhone, reviewCode] = (c.env.REVIEW_LOGIN ?? '').split(':');
  let review = false;
  try {
    review = !!reviewPhone && /^\d{6}$/.test(reviewCode ?? '') && normalizePhone(reviewPhone) === phone;
  } catch {
    // REVIEW_LOGIN greșit: contul demo rămâne oprit
  }
  const code = review ? reviewCode! : randomCode();
  // Încercările greșite din ultima oră rămân socotite și la codul nou (altfel retrimiterea ar da mereu încercări noi).
  await c.env.DB.prepare(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, email, channel) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = CASE WHEN otp_codes.expires_at > ? THEN otp_codes.attempts ELSE 0 END, email = excluded.email, channel = excluded.channel`,
  )
    .bind(phone, await sha256(`${phone}:${code}`), iso(new Date(Date.now() + OTP_TTL)), email, channel, recent)
    .run();
  if (review) return { code }; // fără mesaj: echipa care verifică aplicația știe codul
  const biz = await getBusiness(c.env);
  const t = await renderTemplate(c.env, 'otp', lang, { businessname: biz.name, code });
  if (channel === 'email') {
    const m = o.purpose === 'reset' ? resetEmail(lang, biz.name, code) : otpEmail(lang, biz.name, code, { subject: t.emailSubject, intro: t.emailBody });
    await sendEmail(c.env, { kind: 'otp', recipient: email! }, m.subject, m.html);
  } else {
    await sendSms(c.env, { kind: 'otp', recipient: phone }, t.sms);
  }
  return { code };
}

export type CodeRow = { code_hash: string; email: string | null; channel: string | null };

/**
 * Verifică un cod fără să-l consume (un cod greșit se numără). Încercarea se numără înainte de verificare, în aceeași
 * instrucțiune cu limita: cereri trimise odată nu trec peste ea. Codul se consumă apoi cu `useCode`.
 */
export async function checkCode(env: Env, phone: string, code: unknown): Promise<CodeRow> {
  const row = await env.DB.prepare(
    `UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ? AND attempts < ? AND expires_at > ? RETURNING code_hash, email, channel`,
  )
    .bind(phone, OTP_MAX_TRIES, iso(new Date()))
    .first<CodeRow>();
  if (!row) {
    const cur = await env.DB.prepare('SELECT expires_at FROM otp_codes WHERE phone = ?').bind(phone).first<{ expires_at: string }>();
    throw cur && Date.parse(cur.expires_at) > Date.now() ? new HttpError(429, 'too_many_attempts') : new HttpError(400, 'code_expired');
  }
  const ok = timingSafeEqual(await sha256(`${phone}:${String(code ?? '')}`), row.code_hash);
  if (!ok) throw new HttpError(400, 'wrong_code');
  return row;
}

/** Codul se folosește o singură dată (două cereri odată cu același cod: doar una trece). */
export async function useCode(env: Env, phone: string, row: CodeRow) {
  const used = await env.DB.prepare('DELETE FROM otp_codes WHERE phone = ? AND code_hash = ?').bind(phone, row.code_hash).run();
  if (!used.meta.changes) throw new HttpError(400, 'code_expired');
}
