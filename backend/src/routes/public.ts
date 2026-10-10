import { Hono } from 'hono';
import { getAutomations } from '../growth';
import { attributeQr, ipHash } from '../qr';
import { accessFor, availability } from '../availability';
import { createSession, deleteSession, hashPassword, normalizePhone, optionalSession, newId, tokenFrom, verifyPassword } from '../auth';
import { clearFailures, DUMMY_HASH, findAccounts, lockedAny, loginKeys, parseIdentifier, recordFailure, validClientPassword } from '../clientPassword';
import { checkCode, issueCode, useCode } from '../otp';
import { getPlans } from '../subscriptions';
import { barber, BARBER_SERVICE_COLS, emailTaken, getBusiness, promo, service, type BarberRow, type PromoRow, type ServiceRow } from '../db';
import { HttpError, type AppEnv } from '../env';
import { addDays, iso, isDay, localDay } from '../time';
import { DOCS, legalDoc, type Doc } from '../legal';
import { recordConsent } from '../consents';
import { localize } from '../contentI18n';
import { activeLocationId, activeLocations } from '../locations';
import { getAppearance } from '../appearance';
import { product, type ProductRow } from '../shop';
import { parseBirthDate } from '../identity';
import { applyReferral } from '../referrals';
import { handleStripeEvent, onlinePaymentsOn, verifyStripeSignature } from '../payments';
import { advisorAvailable } from '../advisor';
import { linkTicket, readTicket, socialConfig, socialSignIn, verifyIdToken, type Provider } from '../socialLogin';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/business', async (c) => {
  const [biz, appearance, auto, advisor] = await Promise.all([getBusiness(c.env), getAppearance(c.env), getAutomations(c.env), advisorAvailable(c.env)]);
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
  // Textele despre salon în limba aplicației (`?lang=en`), unde au fost traduse.
  const [texts] = await localize(c.env, c.req.query('lang'), [biz], ['tagline', 'description', 'cancellationPolicy']);
  return c.json({ ...texts, hours, appearance, onlinePayments: onlinePaymentsOn(c.env), otpSms: auto.otpSms, social: socialConfig(c.env), advisor });
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
  return c.json(await localize(c.env, c.req.query('lang'), r.results.map(product), ['name', 'description']));
});

publicRoutes.get('/services', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all<ServiceRow>();
  return c.json(await localize(c.env, c.req.query('lang'), r.results.map(service), ['name', 'description']));
});

/**
 * GET /next-free?serviceId=… — prima oră liberă (la orice frizer, în orice locație), pentru cardul de pe prima pagină.
 * Fără serviciu: ultimul serviciu programat de client (dacă e logat), altfel primul serviciu din listă.
 * Caută din azi până la limita „cu câte zile înainte” (cel mult 21 de zile). `null` dacă nu e nimic liber.
 */
publicRoutes.get('/next-free', async (c) => {
  const who = await optionalSession(c);
  const access = who?.kind === 'admin' ? 'staff' : await accessFor(c.env, who?.id);
  const asked = c.req.query('serviceId');
  let serviceId: string | null = null;
  if (asked) serviceId = (await c.env.DB.prepare('SELECT id FROM services WHERE id = ? AND active = 1').bind(asked).first<{ id: string }>())?.id ?? null;
  if (!serviceId && who?.kind === 'client') {
    serviceId =
      (
        await c.env.DB.prepare(
          `SELECT b.service_id AS id FROM bookings b JOIN services s ON s.id = b.service_id AND s.active = 1 WHERE b.client_id = ? ORDER BY b.starts_at DESC LIMIT 1`,
        )
          .bind(who.id)
          .first<{ id: string }>()
      )?.id ?? null;
  }
  if (!serviceId) serviceId = (await c.env.DB.prepare('SELECT id FROM services WHERE active = 1 ORDER BY sort, name LIMIT 1').first<{ id: string }>())?.id ?? null;
  if (!serviceId) return c.json(null);
  const biz = await getBusiness(c.env);
  const today = localDay(c.env.TIMEZONE, new Date());
  const days = Math.min(biz.maxDaysAhead ?? 30, 21);
  for (let i = 0; i <= days; i++) {
    const day = addDays(today, i);
    const slot = (await availability(c.env, { serviceId, barberId: null, locationId: null, day, access }))[0];
    if (slot) return c.json({ serviceId, barberId: slot.barberId, start: slot.start, membersOnly: !!slot.membersOnly });
  }
  return c.json(null);
});

// Locațiile active (primul pas la programare). Numele și adresa rămân cum sunt scrise în panou (nume proprii).
publicRoutes.get('/locations', async (c) => c.json(await activeLocations(c.env)));

// Fiecare frizer cu locația lui (`locationId`); frizerii dintr-o locație dezactivată nu mai apar.
publicRoutes.get('/barbers', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.*, ${BARBER_SERVICE_COLS}
     FROM barbers b LEFT JOIN locations l ON l.id = b.location_id
     WHERE b.active = 1 AND (b.location_id IS NULL OR l.active = 1) ORDER BY b.sort, b.name`,
  ).all<BarberRow>();
  return c.json(await localize(c.env, c.req.query('lang'), r.results.map(barber), ['role', 'bio']));
});

publicRoutes.get('/plans', async (c) => c.json(await localize(c.env, c.req.query('lang'), await getPlans(c.env, false), ['name', 'description'])));

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

/** GET /availability?serviceId=…&barberId=…&locationId=…&day=YYYY-MM-DD (fără frizer: orice frizer din locație) */
publicRoutes.get('/availability', async (c) => {
  const { serviceId, barberId, day } = c.req.query();
  const locationId = await activeLocationId(c.env, c.req.query('locationId'));
  if (!serviceId || !isDay(day)) throw new HttpError(400, 'invalid_query');
  const biz = await getBusiness(c.env);
  const today = localDay(c.env.TIMEZONE, new Date());
  if (day < today || day > addDays(today, biz.maxDaysAhead ?? 30)) return c.json([]);
  // Cu cont: membrii TAF Club văd și orele „doar membri” (marcate); panoul le vede pe toate.
  const who = await optionalSession(c);
  const access = who?.kind === 'admin' ? 'staff' : await accessFor(c.env, who?.id);
  return c.json(await availability(c.env, { serviceId, barberId: barberId || null, locationId, day, access }));
});

publicRoutes.get('/legal/:doc', async (c) => {
  const doc = c.req.param('doc') as Doc;
  if (!DOCS.includes(doc)) throw new HttpError(404, 'not_found');
  return c.json(await legalDoc(c.env, doc, c.req.query('lang') ?? 'ro'));
});

// --- Login cu cod pe e-mail (principal) sau SMS (alternativă); limitele și trimiterea codului sunt în otp.ts ---

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
  const { code } = await issueCode(c, { phone, email, channel, lang: c.req.query('lang') ?? 'ro' });
  return c.json({ ok: true, phone, channel, newAccount: !client, sentTo: channel === 'email' ? email : phone, ...(c.env.DEV_OTP === '1' && { devCode: code }) });
});

publicRoutes.post('/auth/verify', async (c) => {
  const body = await c.req.json<{ phone?: string; code?: string; name?: string; lang?: string; acceptTerms?: boolean; birthDate?: string; email?: string; ref?: string; marketing?: boolean; qr?: string; socialTicket?: string; password?: string }>();
  const phone = normalizePhone(body.phone);
  // Parola aleasă la „Creează cont” (opțională aici: conturile din Apple / Google sau din panou nu au una).
  const password = body.password === undefined || body.password === '' ? null : validClientPassword(body.password);
  const row = await checkCode(c.env, phone, body.code);
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
  await useCode(c.env, phone, row);

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
    await recordConsent(c.env, c, client.id, { source: 'register', terms: true, marketing: { push: !!mk, email: !!mk, sms: !!mk }, lang: body.lang });
    await applyReferral(c.env, client.id, body.ref);
  } else {
    // Contul a fost creat cu cod pe e-mail (numărul nu a fost dovedit), iar acum cineva intră cu cod prin SMS pe acel număr:
    // numărul e al lui. Contul trece la el: celelalte sesiuni se închid, iar e-mailul rămâne doar cel scris acum (dacă l-a scris).
    // Parola pusă de cel de dinainte se șterge și ea (altfel ar intra în continuare cu telefonul și parola).
    if (row.channel === 'sms') {
      const taken = await c.env.DB.prepare('UPDATE clients SET phone_unverified = 0, email = ?, password_hash = NULL, password_set_at = NULL WHERE id = ? AND phone_unverified = 1')
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
    // Acordul pentru oferte dat acum (bifa de la „Creează cont” pe un număr care avea deja cont): îl păstrăm ca dovadă doar dacă s-a schimbat ceva.
    let mkChanged = false;
    if (body.marketing === true) {
      const r = await c.env.DB.prepare(
        `UPDATE clients SET marketing_push = 1, marketing_email = 1, marketing_sms = 1, marketing_consent_at = ?
         WHERE id = ? AND NOT (marketing_push = 1 AND marketing_email = 1 AND marketing_sms = 1)`,
      )
        .bind(iso(new Date()), client.id)
        .run();
      mkChanged = !!r.meta.changes;
    }
    // Clienții adăugați din panou își dau acordul la prima intrare în aplicație.
    let firstAccept = false;
    if (body.acceptTerms === true) {
      const r = await c.env.DB.prepare('UPDATE clients SET terms_accepted_at = ? WHERE id = ? AND terms_accepted_at IS NULL').bind(iso(new Date()), client.id).run();
      firstAccept = !!r.meta.changes;
    }
    if (firstAccept || mkChanged) {
      await recordConsent(c.env, c, client.id, {
        source: firstAccept ? 'first_login' : 'login',
        terms: firstAccept,
        marketing: mkChanged ? { push: true, email: true, sms: true } : null,
        lang: body.lang,
      });
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
  // Parola de la crearea contului: se pune doar dacă contul nu are deja una (codul a dovedit e-mailul sau telefonul).
  if (password) {
    await c.env.DB.prepare('UPDATE clients SET password_hash = ?, password_set_at = ? WHERE id = ? AND password_hash IS NULL')
      .bind(await hashPassword(password), iso(new Date()), client.id)
      .run();
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
    // Client adăugat din panou care intră prima dată, cu Apple / Google: acordul îl dă acum.
    if (body.acceptTerms === true) {
      const r = await c.env.DB.prepare('UPDATE clients SET terms_accepted_at = ? WHERE id = ? AND terms_accepted_at IS NULL').bind(iso(new Date()), clientId).run();
      if (r.meta.changes) await recordConsent(c.env, c, clientId, { source: 'first_login', terms: true, marketing: null, lang: body.lang });
    }
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
    await recordConsent(c.env, c, clientId, { source: 'social', terms: true, marketing: { push: !!mk, email: !!mk, sms: !!mk }, lang: body.lang });
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

// --- Intrarea cu e-mail (sau telefon) și parolă; „Am uitat parola” cu cod pe e-mail ---

// Un singur răspuns pentru date greșite, oricare ar fi cauza (cont inexistent, fără parolă, parolă greșită).
publicRoutes.post('/auth/password/login', async (c) => {
  const body = await c.req.json<{ identifier?: string; password?: string }>().catch(() => ({}) as { identifier?: string; password?: string });
  const id = parseIdentifier(body.identifier);
  const password = typeof body.password === 'string' ? body.password : '';
  const accounts = id ? await findAccounts(c.env, id) : [];
  const keys = await loginKeys(c, id, accounts.map((a) => a.id));
  if (await lockedAny(c.env, keys)) throw new HttpError(429, 'login_locked');
  let match: (typeof accounts)[number] | null = null;
  const withPassword = password.length <= 200 ? accounts.filter((a) => a.password_hash) : [];
  // Verificăm o parolă și când nu e niciun cont potrivit, ca timpul de răspuns să nu-l dea de gol.
  if (!withPassword.length) await verifyPassword(password.slice(0, 200), DUMMY_HASH);
  for (const a of withPassword) {
    if (await verifyPassword(password, a.password_hash!)) {
      match = a;
      break;
    }
  }
  if (!match) {
    await recordFailure(c.env, keys);
    throw new HttpError(401, 'wrong_credentials');
  }
  await clearFailures(c.env, [keys.ident, `acct:${match.id}`].filter((x): x is string => !!x));
  const token = await createSession(c.env.DB, 'client', match.id);
  return c.json({ token, clientId: match.id });
});

// Codul de recuperare pleacă pe e-mailul contului (prin SMS doar dacă contul nu are e-mail).
// Răspunsul e mereu același, fie că există contul, fie că nu (și când o limită oprește trimiterea).
publicRoutes.post('/auth/password/forgot', async (c) => {
  const body = await c.req.json<{ identifier?: string }>().catch(() => ({}) as { identifier?: string });
  const id = parseIdentifier(body.identifier);
  if (!id) throw new HttpError(400, 'invalid_identifier');
  const [acct] = await findAccounts(c.env, id);
  let devCode: string | undefined;
  if (acct) {
    try {
      const r = await issueCode(c, { phone: acct.phone, email: acct.email, channel: acct.email ? 'email' : 'sms', lang: c.req.query('lang') ?? 'ro', purpose: 'reset' });
      devCode = r.code;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
    }
  }
  return c.json({ ok: true, ...(c.env.DEV_OTP === '1' && devCode && { devCode }) });
});

// Codul + parola nouă: parola se pune, toate celelalte sesiuni se închid, iar clientul intră în cont.
publicRoutes.post('/auth/password/reset', async (c) => {
  const body = await c.req.json<{ identifier?: string; code?: string; password?: string; acceptTerms?: boolean; lang?: string }>();
  const password = validClientPassword(body.password);
  const id = parseIdentifier(body.identifier);
  const [acct] = id ? await findAccounts(c.env, id) : [];
  if (!acct) throw new HttpError(400, 'code_expired');
  const row = await checkCode(c.env, acct.phone, body.code);
  await useCode(c.env, acct.phone, row);
  // Cod prin SMS pe un cont făcut cu cod pe e-mail (numărul nedovedit): ca la intrarea cu cod, contul trece la cel cu telefonul.
  const takeover = row.channel === 'sms' && !!acct.phone_unverified;
  const now = iso(new Date());
  await c.env.DB.batch([
    takeover
      ? c.env.DB.prepare('UPDATE clients SET password_hash = ?, password_set_at = ?, phone_unverified = 0, email = ? WHERE id = ?').bind(await hashPassword(password), now, row.email, acct.id)
      : c.env.DB.prepare('UPDATE clients SET password_hash = ?, password_set_at = ? WHERE id = ?').bind(await hashPassword(password), now, acct.id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE kind = 'client' AND subject_id = ?`).bind(acct.id),
  ]);
  const keys = await loginKeys(c, id, [acct.id]);
  await clearFailures(c.env, [keys.ident, ...keys.accounts].filter((x): x is string => !!x));
  // Client adăugat din panou care intră prima dată: acordul e cel din textul de pe ecranul de intrare.
  if (body.acceptTerms === true && !acct.terms_accepted_at) {
    const r = await c.env.DB.prepare('UPDATE clients SET terms_accepted_at = ? WHERE id = ? AND terms_accepted_at IS NULL').bind(now, acct.id).run();
    if (r.meta.changes) await recordConsent(c.env, c, acct.id, { source: 'first_login', terms: true, marketing: null, lang: body.lang });
  }
  const token = await createSession(c.env.DB, 'client', acct.id);
  return c.json({ token, clientId: acct.id });
});

publicRoutes.post('/auth/logout', async (c) => {
  const t = tokenFrom(c);
  if (t) await deleteSession(c.env.DB, t);
  return c.json({ ok: true });
});
