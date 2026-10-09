import { Hono } from 'hono';
import { getAutomations } from '../growth';
import { renderTemplate } from '../templates';
import { attributeQr, ipHash } from '../qr';
import { accessFor, availability } from '../availability';
import { createSession, deleteSession, normalizePhone, optionalSession, randomCode, sha256, newId, timingSafeEqual, tokenFrom } from '../auth';
import { getPlans } from '../subscriptions';
import { barber, BARBER_SERVICE_COLS, emailTaken, getBusiness, promo, service, type BarberRow, type PromoRow, type ServiceRow } from '../db';
import { HttpError, type AppEnv } from '../env';
import { otpEmail } from '../messages';
import { sendEmail, sendSms } from '../notify';
import { addDays, iso, isDay, localDay } from '../time';
import { DOCS, legalDoc, type Doc } from '../legal';
import { getAppearance } from '../appearance';
import { product, type ProductRow } from '../shop';
import { parseBirthDate } from '../identity';
import { applyReferral } from '../referrals';
import { handleStripeEvent, onlinePaymentsOn, verifyStripeSignature } from '../payments';
import { linkTicket, readTicket, socialConfig, socialSignIn, verifyIdToken, type Provider } from '../socialLogin';

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
  return c.json({ ...biz, hours, appearance, onlinePayments: onlinePaymentsOn(c.env), otpSms: auto.otpSms, social: socialConfig(c.env) });
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
  // Cu cont: membrii TAF Club văd și orele „doar membri” (marcate); panoul le vede pe toate.
  const who = await optionalSession(c);
  const access = who?.kind === 'admin' ? 'staff' : await accessFor(c.env, who?.id);
  return c.json(await availability(c.env, { serviceId, barberId: barberId || null, day, access }));
});

publicRoutes.get('/legal/:doc', async (c) => {
  const doc = c.req.param('doc') as Doc;
  if (!DOCS.includes(doc)) throw new HttpError(404, 'not_found');
  return c.json(await legalDoc(c.env, doc, c.req.query('lang') ?? 'ro'));
});

// --- Login cu cod pe e-mail (principal) sau SMS (alternativă) ---

const OTP_TTL = 10 * 60_000;
/** Câte coduri greșite se acceptă pe un număr într-o oră (și la coduri noi: încercările nu se iau de la capăt la retrimitere). */
const OTP_MAX_TRIES = 8;
/** Câte coduri se pot cere pe zi pentru același număr sau aceeași adresă. */
const OTP_PER_DAY = 10;
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
  // Cont nou: o adresă de e-mail ține de un singur cont (altfel se pot face conturi la nesfârșit cu același e-mail, ex. pentru bonusuri).
  if (!client && email && (await emailTaken(c.env, email, phone))) throw new HttpError(400, 'email_in_use');
  // Protecție contra abuzului: SMS doar spre prefixe europene uzuale și limite zilnice totale pe canal.
  if (channel === 'sms' && !(await getAutomations(c.env)).otpSms) throw new HttpError(400, 'sms_code_off');
  if (channel === 'sms' && !OTP_PREFIXES.some((p) => phone.startsWith(p))) throw new HttpError(400, 'country_not_supported');
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
  const biz = await getBusiness(c.env);
  const lang = c.req.query('lang') ?? 'ro';
  if (review) {
    // fără mesaj: echipa care verifică aplicația știe codul
  } else {
    const t = await renderTemplate(c.env, 'otp', lang, { businessname: biz.name, code });
    if (channel === 'email') {
      const m = otpEmail(lang, biz.name, code, { subject: t.emailSubject, intro: t.emailBody });
      await sendEmail(c.env, { kind: 'otp', recipient: email! }, m.subject, m.html);
    } else {
      await sendSms(c.env, { kind: 'otp', recipient: phone }, t.sms);
    }
  }
  return c.json({ ok: true, phone, channel, newAccount: !client, sentTo: channel === 'email' ? email : phone, ...(c.env.DEV_OTP === '1' && { devCode: code }) });
});

publicRoutes.post('/auth/verify', async (c) => {
  const body = await c.req.json<{ phone?: string; code?: string; name?: string; lang?: string; acceptTerms?: boolean; birthDate?: string; email?: string; ref?: string; marketing?: boolean; qr?: string; socialTicket?: string }>();
  const phone = normalizePhone(body.phone);
  // Încercarea se numără înainte de verificare, în aceeași instrucțiune cu limita: cereri trimise odată nu trec peste ea.
  const row = await c.env.DB.prepare(
    `UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ? AND attempts < ? AND expires_at > ? RETURNING code_hash, email, channel`,
  )
    .bind(phone, OTP_MAX_TRIES, iso(new Date()))
    .first<{ code_hash: string; email: string | null; channel: string | null }>();
  if (!row) {
    const cur = await c.env.DB.prepare('SELECT expires_at FROM otp_codes WHERE phone = ?').bind(phone).first<{ expires_at: string }>();
    throw cur && Date.parse(cur.expires_at) > Date.now() ? new HttpError(429, 'too_many_attempts') : new HttpError(400, 'code_expired');
  }
  const ok = timingSafeEqual(await sha256(`${phone}:${String(body.code ?? '')}`), row.code_hash);
  if (!ok) throw new HttpError(400, 'wrong_code');
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
  if (!client && email && (await emailTaken(c.env, email, phone))) throw new HttpError(400, 'email_in_use');
  // Codul se folosește o singură dată (două cereri odată cu același cod: doar una intră).
  const used = await c.env.DB.prepare('DELETE FROM otp_codes WHERE phone = ? AND code_hash = ?').bind(phone, row.code_hash).run();
  if (!used.meta.changes) throw new HttpError(400, 'code_expired');

  const isNew = !client;
  if (!client) {
    client = { id: newId('cl'), name: (body.name ?? '').trim().slice(0, 80), email };
    // Ofertele se trimit doar cu bifa separată de la creare (GDPR): fără ea, toate canalele de marketing rămân oprite.
    const mk = body.marketing === true ? 1 : 0;
    await c.env.DB.prepare(
      `INSERT INTO clients (id, phone, name, email, lang, terms_accepted_at, birth_date, marketing_push, marketing_email, marketing_sms, marketing_consent_at, phone_unverified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        client.id,
        phone,
        client.name,
        email,
        ['ro', 'en', 'fr'].includes(body.lang ?? '') ? body.lang : 'ro',
        iso(new Date()),
        birthDate,
        mk,
        mk,
        mk,
        mk ? iso(new Date()) : null,
        row.channel === 'email' ? 1 : 0,
      )
      .run();
    await applyReferral(c.env, client.id, body.ref);
  } else {
    // Contul a fost creat cu cod pe e-mail (numărul nu a fost dovedit), iar acum cineva intră cu cod prin SMS pe acel număr:
    // numărul e al lui. Contul trece la el: celelalte sesiuni se închid, iar e-mailul rămâne doar cel scris acum (dacă l-a scris).
    if (row.channel === 'sms') {
      const taken = await c.env.DB.prepare('UPDATE clients SET phone_unverified = 0, email = ? WHERE id = ? AND phone_unverified = 1')
        .bind(row.email, client.id)
        .run();
      if (taken.meta.changes) {
        await c.env.DB.prepare(`DELETE FROM sessions WHERE kind = 'client' AND subject_id = ?`).bind(client.id).run();
        client.email = row.email;
      }
    }
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
  // Prima logare cu Apple / Google, terminată cu codul pe acest număr: legăm contul extern de client.
  if (body.socialTicket) {
    try {
      await linkTicket(c.env, await readTicket(c.env, body.socialTicket), client.id);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('social link', e);
    }
  }
  const token = await createSession(c.env.DB, 'client', client.id);
  return c.json({ token, clientId: client.id });
});

// Logare cu Apple sau Google. Contul extern deja legat intră direct; altfel aplicația cere numărul de telefon.
publicRoutes.post('/auth/social', async (c) => {
  const body = await c.req.json<{ provider?: string; idToken?: string; nonce?: string; name?: string }>().catch(() => ({}) as { provider?: string });
  const provider = body.provider === 'apple' || body.provider === 'google' ? (body.provider as Provider) : null;
  if (!provider) throw new HttpError(400, 'invalid_body');
  const id = await verifyIdToken(c.env, provider, (body as { idToken?: string }).idToken ?? '', (body as { nonce?: string }).nonce);
  return c.json(await socialSignIn(c.env, id, String((body as { name?: string }).name ?? '').trim()));
});

// Prima logare cu Apple / Google: completarea contului cu telefonul (și data nașterii, acordurile).
// E-mailul confirmat de Apple / Google ține loc de cod. Numărul nu e dovedit încă (ca la contul făcut cu cod pe e-mail):
// prima intrare cu cod prin SMS pe acel număr îl confirmă.
publicRoutes.post('/auth/social/complete', async (c) => {
  const body = await c.req.json<{ ticket?: string; phone?: string; name?: string; lang?: string; acceptTerms?: boolean; birthDate?: string; ref?: string; marketing?: boolean; qr?: string }>();
  const t = await readTicket(c.env, body.ticket);
  const phone = normalizePhone(body.phone);
  const existing = await c.env.DB.prepare('SELECT id, email FROM clients WHERE phone = ? AND deleted_at IS NULL').bind(phone).first<{ id: string; email: string | null }>();
  let clientId: string;
  let isNew = false;
  if (existing) {
    // Numărul are deja cont: îl legăm doar dacă e același e-mail confirmat; altfel trebuie codul pe acest număr.
    if (!(t.email_verified && t.email && existing.email?.toLowerCase() === t.email)) throw new HttpError(409, 'phone_has_account');
    clientId = existing.id;
  } else {
    if (!t.email_verified || !t.email) throw new HttpError(400, 'code_required');
    if (body.acceptTerms !== true) throw new HttpError(400, 'terms_required');
    const birthDate = body.birthDate ? parseBirthDate(body.birthDate) : null;
    if (!birthDate) throw new HttpError(400, 'birth_date_required');
    if (await emailTaken(c.env, t.email, phone)) throw new HttpError(400, 'email_in_use');
    clientId = newId('cl');
    isNew = true;
    const mk = body.marketing === true ? 1 : 0;
    await c.env.DB.prepare(
      `INSERT INTO clients (id, phone, name, email, lang, terms_accepted_at, birth_date, marketing_push, marketing_email, marketing_sms, marketing_consent_at, phone_unverified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
      .bind(
        clientId,
        phone,
        (body.name ?? '').trim().slice(0, 80) || t.name,
        t.email,
        ['ro', 'en', 'fr'].includes(body.lang ?? '') ? body.lang : 'ro',
        iso(new Date()),
        birthDate,
        mk,
        mk,
        mk,
        mk ? iso(new Date()) : null,
      )
      .run();
    await applyReferral(c.env, clientId, body.ref);
  }
  await linkTicket(c.env, t, clientId);
  try {
    await attributeQr(c.env, clientId, isNew, body.qr, await ipHash(c.env, c));
  } catch (e) {
    console.error('qr', e);
  }
  const token = await createSession(c.env.DB, 'client', clientId);
  return c.json({ token, clientId });
});

publicRoutes.post('/auth/logout', async (c) => {
  const t = tokenFrom(c);
  if (t) await deleteSession(c.env.DB, t);
  return c.json({ ok: true });
});
