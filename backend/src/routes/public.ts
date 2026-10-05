import { Hono } from 'hono';
import { availability } from '../availability';
import { createSession, deleteSession, normalizePhone, randomCode, sha256, newId, timingSafeEqual, tokenFrom } from '../auth';
import { barber, getBusiness, promo, service, type BarberRow, type PromoRow, type ServiceRow } from '../db';
import { HttpError, type AppEnv } from '../env';
import { msg, otpEmail } from '../messages';
import { sendEmail, sendSms } from '../notify';
import { addDays, iso, isDay, localDay } from '../time';
import { DOCS, legalDoc, type Doc } from '../legal';
import { getAppearance } from '../appearance';
import { product, type ProductRow } from '../shop';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/business', async (c) => {
  const [biz, appearance] = await Promise.all([getBusiness(c.env), getAppearance(c.env)]);
  // Programul salonului = reuniunea programului frizerilor, pe zile (0 = duminică).
  const rows = await c.env.DB.prepare(
    `SELECT h.weekday, MIN(h.start_min) AS s, MAX(h.end_min) AS e
     FROM working_hours h JOIN barbers b ON b.id = h.barber_id WHERE b.active = 1 GROUP BY h.weekday`,
  ).all<{ weekday: number; s: number; e: number }>();
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const hours = Array.from({ length: 7 }, (_, wd) => {
    const r = rows.results.find((x) => x.weekday === wd);
    return r ? { open: hm(r.s), close: hm(r.e) } : null;
  });
  return c.json({ ...biz, hours, appearance });
});

// Pozele urcate din panou. Id-ul e nou la fiecare urcare, deci se pot ține în cache oricât.
publicRoutes.get('/media/:id', async (c) => {
  const r = await c.env.DB.prepare('SELECT mime, data FROM media WHERE id = ?').bind(c.req.param('id')).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!r) throw new HttpError(404, 'not_found');
  const body = r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data).buffer;
  return c.body(body as ArrayBuffer, 200, {
    'Content-Type': r.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
});

publicRoutes.get('/products', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort, name').all<ProductRow>();
  return c.json(r.results.map(product));
});

publicRoutes.get('/services', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all<ServiceRow>();
  return c.json(r.results.map(service));
});

publicRoutes.get('/barbers', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.*, (SELECT group_concat(service_id) FROM barber_services WHERE barber_id = b.id) AS service_ids
     FROM barbers b WHERE b.active = 1 ORDER BY b.sort, b.name`,
  ).all<BarberRow>();
  return c.json(r.results.map(barber));
});

publicRoutes.get('/promos', async (c) => {
  const now = iso(new Date());
  const lang = c.req.query('lang') ?? 'ro';
  const r = await c.env.DB.prepare(
    `SELECT * FROM promos WHERE active = 1
     AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?) ORDER BY sort`,
  )
    .bind(now, now)
    .all<PromoRow>();
  return c.json(r.results.map((p) => promo(p, lang)));
});

/** GET /availability?serviceId=…&barberId=…&day=YYYY-MM-DD */
publicRoutes.get('/availability', async (c) => {
  const { serviceId, barberId, day } = c.req.query();
  if (!serviceId || !isDay(day)) throw new HttpError(400, 'invalid_query');
  const biz = await getBusiness(c.env);
  const today = localDay(c.env.TIMEZONE, new Date());
  if (day < today || day > addDays(today, biz.maxDaysAhead ?? 30)) return c.json([]);
  return c.json(await availability(c.env, { serviceId, barberId: barberId || null, day }));
});

publicRoutes.get('/legal/:doc', async (c) => {
  const doc = c.req.param('doc') as Doc;
  if (!DOCS.includes(doc)) throw new HttpError(404, 'not_found');
  return c.json(await legalDoc(c.env, doc, c.req.query('lang') ?? 'ro'));
});

// --- Login cu cod pe e-mail (principal) sau SMS (alternativă) ---

const OTP_TTL = 10 * 60_000;
// RO, MD, FR, BE, CH, LU, IT, ES, DE, AT, UK, IE, NL.
const OTP_PREFIXES = ['+40', '+373', '+33', '+32', '+41', '+352', '+39', '+34', '+49', '+43', '+44', '+353', '+31'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

publicRoutes.post('/auth/otp', async (c) => {
  type Body = { phone?: string; email?: string; channel?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const phone = normalizePhone(body.phone);
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const channel = body.channel === 'sms' || (!body.channel && !rawEmail) ? 'sms' : 'email';
  if (rawEmail && (rawEmail.length > 200 || !EMAIL_RE.test(rawEmail))) throw new HttpError(400, 'invalid_email');
  if (channel === 'email' && !rawEmail) throw new HttpError(400, 'invalid_email');
  const email = rawEmail || null;

  const client = await c.env.DB.prepare('SELECT email FROM clients WHERE phone = ?').bind(phone).first<{ email: string | null }>();
  if (channel === 'email' && client) {
    // Contul există deja: codul merge doar pe adresa salvată în el, altfel oricine ar putea
    // intra în contul altcuiva scriind numărul lui și propriul e-mail.
    if (!client.email) throw new HttpError(400, 'email_not_on_account');
    if (client.email.toLowerCase() !== email) throw new HttpError(400, 'email_mismatch');
  }
  // Protecție contra abuzului: SMS doar spre prefixe europene uzuale și limite zilnice totale pe canal.
  if (channel === 'sms' && !OTP_PREFIXES.some((p) => phone.startsWith(p))) throw new HttpError(400, 'country_not_supported');
  const today = await c.env.DB.prepare(`SELECT count(*) AS n FROM message_log WHERE kind = 'otp' AND channel = ? AND created_at > ?`)
    .bind(channel, iso(new Date(Date.now() - 86_400_000)))
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= (channel === 'sms' ? 500 : 2000)) throw new HttpError(429, 'too_many_requests');
  const prev = await c.env.DB.prepare('SELECT expires_at FROM otp_codes WHERE phone = ?')
    .bind(phone)
    .first<{ expires_at: string }>();
  // Cel mult un cod la 45 de secunde pe număr.
  if (prev && Date.parse(prev.expires_at) - OTP_TTL + 45_000 > Date.now()) throw new HttpError(429, 'too_many_requests');

  const code = randomCode();
  await c.env.DB.prepare(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, email) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, email = excluded.email`,
  )
    .bind(phone, await sha256(`${phone}:${code}`), iso(new Date(Date.now() + OTP_TTL)), email)
    .run();
  const biz = await getBusiness(c.env);
  const lang = c.req.query('lang') ?? 'ro';
  if (channel === 'email') {
    const m = otpEmail(lang, biz.name, code);
    await sendEmail(c.env, { kind: 'otp', recipient: email! }, m.subject, m.html);
  } else {
    await sendSms(c.env, { kind: 'otp', recipient: phone }, msg(lang, 'otp', { shop: biz.name, code }));
  }
  return c.json({ ok: true, phone, channel, sentTo: channel === 'email' ? email : phone, ...(c.env.DEV_OTP === '1' && { devCode: code }) });
});

publicRoutes.post('/auth/verify', async (c) => {
  const body = await c.req.json<{ phone?: string; code?: string; name?: string; lang?: string; acceptTerms?: boolean }>();
  const phone = normalizePhone(body.phone);
  const row = await c.env.DB.prepare('SELECT code_hash, expires_at, attempts, email FROM otp_codes WHERE phone = ?')
    .bind(phone)
    .first<{ code_hash: string; expires_at: string; attempts: number; email: string | null }>();
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'code_expired');
  if (row.attempts >= 5) throw new HttpError(429, 'too_many_attempts');
  const ok = timingSafeEqual(await sha256(`${phone}:${String(body.code ?? '')}`), row.code_hash);
  if (!ok) {
    await c.env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').bind(phone).run();
    throw new HttpError(400, 'wrong_code');
  }
  let client = await c.env.DB.prepare('SELECT id, name, email FROM clients WHERE phone = ?')
    .bind(phone)
    .first<{ id: string; name: string; email: string | null }>();
  // Cont nou: acordul pentru termeni și confidențialitate e obligatoriu (codul rămâne valabil).
  if (!client && body.acceptTerms !== true) throw new HttpError(400, 'terms_required');
  await c.env.DB.prepare('DELETE FROM otp_codes WHERE phone = ?').bind(phone).run();

  if (!client) {
    client = { id: newId('cl'), name: (body.name ?? '').trim().slice(0, 80), email: row.email };
    await c.env.DB.prepare('INSERT INTO clients (id, phone, name, email, lang, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(client.id, phone, client.name, row.email, ['ro', 'en', 'fr'].includes(body.lang ?? '') ? body.lang : 'ro', iso(new Date()))
      .run();
  } else {
    if (!client.name && body.name?.trim()) {
      await c.env.DB.prepare('UPDATE clients SET name = ? WHERE id = ?').bind(body.name.trim().slice(0, 80), client.id).run();
    }
    // Cont fără e-mail (ex. adăugat din panou): îl salvăm pe cel scris la intrare.
    if (!client.email && row.email) {
      await c.env.DB.prepare('UPDATE clients SET email = ? WHERE id = ?').bind(row.email, client.id).run();
    }
    // Clienții adăugați din panou își dau acordul la prima intrare în aplicație.
    if (body.acceptTerms === true) {
      await c.env.DB.prepare('UPDATE clients SET terms_accepted_at = coalesce(terms_accepted_at, ?) WHERE id = ?').bind(iso(new Date()), client.id).run();
    }
  }
  const token = await createSession(c.env.DB, 'client', client.id);
  return c.json({ token, clientId: client.id });
});

publicRoutes.post('/auth/logout', async (c) => {
  const t = tokenFrom(c);
  if (t) await deleteSession(c.env.DB, t);
  return c.json({ ok: true });
});
