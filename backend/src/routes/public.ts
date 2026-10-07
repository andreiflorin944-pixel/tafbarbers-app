import { Hono } from 'hono';
import { getAutomations } from '../growth';
import { attributeQr, ipHash } from '../qr';
import { availability } from '../availability';
import { createSession, deleteSession, normalizePhone, randomCode, sha256, newId, timingSafeEqual, tokenFrom } from '../auth';
import { getPlans } from '../subscriptions';
import { barber, BARBER_SERVICE_COLS, getBusiness, promo, service, type BarberRow, type PromoRow, type ServiceRow } from '../db';
import { HttpError, type AppEnv } from '../env';
import { msg, otpEmail } from '../messages';
import { sendEmail, sendSms } from '../notify';
import { addDays, iso, isDay, localDay } from '../time';
import { DOCS, legalDoc, type Doc } from '../legal';
import { getAppearance } from '../appearance';
import { product, type ProductRow } from '../shop';
import { parseBirthDate } from '../identity';
import { applyReferral } from '../referrals';
import { handleStripeEvent, onlinePaymentsOn, verifyStripeSignature } from '../payments';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/business', async (c) => {
  const [biz, appearance, auto] = await Promise.all([getBusiness(c.env), getAppearance(c.env), getAutomations(c.env)]);
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
  return c.json({ ...biz, hours, appearance, onlinePayments: onlinePaymentsOn(c.env), otpSms: auto.otpSms });
});

// Stripe ne anunță aici plățile. Semnătura se verifică pe corpul exact, cu secretul webhook-ului.
publicRoutes.post('/payments/stripe', async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(404, 'not_found');
  const body = await c.req.text();
  if (!(await verifyStripeSignature(secret, body, c.req.header('stripe-signature')))) throw new HttpError(400, 'bad_signature');
  let ev: Parameters<typeof handleStripeEvent>[1];
  try {
    ev = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  return c.json({ received: true, result: await handleStripeEvent(c.env, ev) });
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
  const r = await c.env.DB.prepare('SELECT * FROM products WHERE active = 1 AND for_sale = 1 ORDER BY sort, name').all<ProductRow>();
  return c.json(r.results.map(product));
});

publicRoutes.get('/services', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all<ServiceRow>();
  return c.json(r.results.map(service));
});

publicRoutes.get('/barbers', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.*, ${BARBER_SERVICE_COLS}
     FROM barbers b WHERE b.active = 1 ORDER BY b.sort, b.name`,
  ).all<BarberRow>();
  return c.json(r.results.map(barber));
});

publicRoutes.get('/plans', async (c) => c.json(await getPlans(c.env, false)));

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
  if (channel === 'sms' && !(await getAutomations(c.env)).otpSms) throw new HttpError(400, 'sms_code_off');
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

  // Contul demo pentru verificarea Apple / Google: un număr anume primește mereu același cod, fără SMS.
  const [reviewPhone, reviewCode] = (c.env.REVIEW_LOGIN ?? '').split(':');
  let review = false;
  try {
    review = !!reviewPhone && /^\d{4}$/.test(reviewCode ?? '') && normalizePhone(reviewPhone) === phone;
  } catch {
    // REVIEW_LOGIN greșit: contul demo rămâne oprit
  }
  const code = review ? reviewCode! : randomCode();
  await c.env.DB.prepare(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, email) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, email = excluded.email`,
  )
    .bind(phone, await sha256(`${phone}:${code}`), iso(new Date(Date.now() + OTP_TTL)), email)
    .run();
  const biz = await getBusiness(c.env);
  const lang = c.req.query('lang') ?? 'ro';
  if (review) {
    // fără mesaj: echipa care verifică aplicația știe codul
  } else if (channel === 'email') {
    const m = otpEmail(lang, biz.name, code);
    await sendEmail(c.env, { kind: 'otp', recipient: email! }, m.subject, m.html);
  } else {
    await sendSms(c.env, { kind: 'otp', recipient: phone }, msg(lang, 'otp', { shop: biz.name, code }));
  }
  return c.json({ ok: true, phone, channel, newAccount: !client, sentTo: channel === 'email' ? email : phone, ...(c.env.DEV_OTP === '1' && { devCode: code }) });
});

publicRoutes.post('/auth/verify', async (c) => {
  const body = await c.req.json<{ phone?: string; code?: string; name?: string; lang?: string; acceptTerms?: boolean; birthDate?: string; email?: string; ref?: string; marketing?: boolean; qr?: string }>();
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
  // Cont nou: cerem și data nașterii și un e-mail (vine din cererea codului sau din formular).
  const birthDate = body.birthDate ? parseBirthDate(body.birthDate) : null;
  const formEmail = typeof body.email === 'string' && EMAIL_RE.test(body.email.trim()) ? body.email.trim().toLowerCase() : null;
  const email = row.email ?? formEmail;
  if (!client && !birthDate) throw new HttpError(400, 'birth_date_required');
  if (!client && !email) throw new HttpError(400, 'email_required');
  await c.env.DB.prepare('DELETE FROM otp_codes WHERE phone = ?').bind(phone).run();

  const isNew = !client;
  if (!client) {
    client = { id: newId('cl'), name: (body.name ?? '').trim().slice(0, 80), email };
    // Ofertele se trimit doar cu bifa separată de la creare (GDPR): fără ea, toate canalele de marketing rămân oprite.
    const mk = body.marketing === true ? 1 : 0;
    await c.env.DB.prepare(
      `INSERT INTO clients (id, phone, name, email, lang, terms_accepted_at, birth_date, marketing_push, marketing_email, marketing_sms, marketing_consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(client.id, phone, client.name, email, ['ro', 'en', 'fr'].includes(body.lang ?? '') ? body.lang : 'ro', iso(new Date()), birthDate, mk, mk, mk, mk ? iso(new Date()) : null)
      .run();
    await applyReferral(c.env, client.id, body.ref);
  } else {
    if (!client.name && body.name?.trim()) {
      await c.env.DB.prepare('UPDATE clients SET name = ? WHERE id = ?').bind(body.name.trim().slice(0, 80), client.id).run();
    }
    // Cont fără e-mail (ex. adăugat din panou): îl salvăm pe cel scris la intrare.
    if (!client.email && email) {
      await c.env.DB.prepare('UPDATE clients SET email = ? WHERE id = ?').bind(email, client.id).run();
    }
    if (birthDate) {
      await c.env.DB.prepare('UPDATE clients SET birth_date = coalesce(birth_date, ?) WHERE id = ?').bind(birthDate, client.id).run();
    }
    if (body.marketing === true) {
      await c.env.DB.prepare('UPDATE clients SET marketing_push = 1, marketing_email = 1, marketing_sms = 1, marketing_consent_at = ? WHERE id = ?').bind(iso(new Date()), client.id).run();
    }
    // Clienții adăugați din panou își dau acordul la prima intrare în aplicație.
    if (body.acceptTerms === true) {
      await c.env.DB.prepare('UPDATE clients SET terms_accepted_at = coalesce(terms_accepted_at, ?) WHERE id = ?').bind(iso(new Date()), client.id).run();
    }
  }
  // Campaniile QR: codul scanat (îl trimite aplicația) sau o scanare recentă din aceeași rețea.
  try {
    await attributeQr(c.env, client.id, isNew, body.qr, await ipHash(c.env, c));
  } catch (e) {
    console.error('qr', e);
  }
  const token = await createSession(c.env.DB, 'client', client.id);
  return c.json({ token, clientId: client.id });
});

publicRoutes.post('/auth/logout', async (c) => {
  const t = tokenFrom(c);
  if (t) await deleteSession(c.env.DB, t);
  return c.json({ ok: true });
});
