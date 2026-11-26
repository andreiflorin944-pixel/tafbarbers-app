import { Hono, type Context, type Next } from 'hono';
import { normalizePhone } from './auth';
import { HOLDS_SLOT } from './bookings';
import { getBusiness, getSetting, setSetting } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { seal, unseal } from './social';
import { iso, roLocal } from './time';
import { WALKIN_ID, WALKIN_LABEL, WALKIN_NAME_SQL } from './walkin';

// Calendarul invers, cât timp se lucrează pe ambele: fiecare programare făcută la noi (aplicație, site, panou) se pune și
// în calendarul Barberly, prin API-ul lor de programări (X-Api-Key), ca ora să fie ocupată și acolo. Mutarea la noi o mută
// și acolo, anularea la noi o anulează și acolo. Programările venite din Barberly (barberly_ref) nu se trimit înapoi.
// În Barberly „clientul” e numărul salonului (setat în panou), ca Barberly să nu-i trimită clientului SMS-uri în plus;
// numele clientului real stă în notiță. E-mailul pe care Barberly îl trimite apoi pentru ea e ignorat la import.

export type PushSettings = {
  enabled: boolean;
  keySealed: string | null;
  keyHint: string;
  locationId: string;
  phone: string; // „clientul” din Barberly pentru programările trimise de noi (numărul salonului)
  // Saloanele care cer clienți înregistrați: contul de client Barberly sub care se pun programările (doar id-ul și numele; parola nu se păstrează).
  customerId: string;
  customerName: string;
  barbers: Record<string, string>; // frizerul nostru → membrul echipei din Barberly
  services: Record<string, string>; // serviciul nostru → serviciul din Barberly
};
const KEY = 'barberly_push';
const EMPTY: PushSettings = { enabled: false, keySealed: null, keyHint: '', locationId: '', phone: '', customerId: '', customerName: '', barbers: {}, services: {} };
export const getPushSettings = async (env: Env) => ({ ...EMPTY, ...(await getSetting<Partial<PushSettings>>(env, KEY, {})) });

/** Numărul folosit ca „client” în Barberly: e-mailurile Barberly pentru el sunt programările trimise de noi. */
export async function pushedPhone(env: Env): Promise<string | null> {
  const s = await getPushSettings(env);
  return s.keySealed && s.phone ? s.phone : null;
}

const apiBase = (env: Env) => (env.BARBERLY_API_BASE || 'https://booking-api.barberly.com').replace(/\/+$/, '');

async function bapi<T>(env: Env, apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(apiBase(env) + path, {
    method,
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j: unknown = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = null;
  }
  if (!r.ok) {
    const p = (j ?? {}) as { title?: string; detail?: string; errors?: Record<string, string[]> };
    const errs = p.errors ? Object.values(p.errors).flat().join(' ') : '';
    const why = [p.detail || p.title, errs].filter(Boolean).join(' ') || text.slice(0, 200);
    const account = path.startsWith('/v1/accounts');
    throw new Error(
      (r.status === 401 || r.status === 403) && !account
        ? 'Barberly nu acceptă cheia (verific-o în Barberly → API de rezervare).'
        : account && r.status === 401
          ? 'Parola sau codul nu sunt bune.'
          : `Barberly ${r.status}: ${why}`.slice(0, 300),
    );
  }
  return j as T;
}

type BLocation = { id: string; name: string };
type BTeam = { id: string; firstName: string; lastName?: string | null };
type BService = { id: string; name: string; duration: number };
type BBooking = { id: string; status?: string };

export async function barberlyCatalog(env: Env, apiKey: string, locationId?: string) {
  const locations = await bapi<BLocation[]>(env, apiKey, 'GET', '/v1/locations');
  const loc = locationId && locations.some((l) => l.id === locationId) ? locationId : (locations[0]?.id ?? '');
  if (!loc) return { locations: [], locationId: '', teamMembers: [], services: [] };
  const [team, cats] = await Promise.all([
    bapi<BTeam[]>(env, apiKey, 'POST', `/v1/locations/${loc}/team-members`, {}),
    bapi<Array<{ services?: BService[] | null }>>(env, apiKey, 'POST', `/v1/locations/${loc}/services`, {}),
  ]);
  return {
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
    locationId: loc,
    teamMembers: team.map((t) => ({ id: t.id, name: [t.firstName, t.lastName].filter(Boolean).join(' ') })),
    services: cats.flatMap((c) => c.services ?? []).map((s) => ({ id: s.id, name: s.name, duration: s.duration })),
  };
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Leagă singur frizerii și serviciile cu același nume (după prenume, la frizeri); restul se aleg în panou. */
function autoMatch(ours: Array<{ id: string; name: string }>, theirs: Array<{ id: string; name: string }>, cur: Record<string, string>, firstWord = false) {
  const out = { ...cur };
  for (const o of ours) {
    if (out[o.id] && theirs.some((t) => t.id === out[o.id])) continue;
    const f = fold(o.name);
    const hit =
      theirs.find((t) => fold(t.name) === f) ??
      (firstWord ? theirs.find((t) => fold(t.name).split(' ')[0] === f.split(' ')[0]) : theirs.find((t) => fold(t.name).includes(f) || f.includes(fold(t.name))));
    if (hit) out[o.id] = hit.id;
  }
  return out;
}

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  barber_id: string;
  service_id: string;
  client_name: string;
  barberly_id: string | null;
  tries: number | null;
};

const MAX_TRIES = 5;

async function mark(env: Env, bookingId: string, v: { barberlyId?: string | null; state: 'synced' | 'error' | 'cancelled'; row?: Row; fail?: boolean; detail: string }) {
  await env.DB.prepare(
    `INSERT INTO barberly_outbox (booking_id, barberly_id, state, starts_at, ends_at, barber_id, tries, detail, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(booking_id) DO UPDATE SET barberly_id = coalesce(?2, barberly_id), state = ?3,
       starts_at = coalesce(?4, starts_at), ends_at = coalesce(?5, ends_at), barber_id = coalesce(?6, barber_id),
       tries = CASE WHEN ?10 THEN tries + 1 ELSE 0 END, detail = ?8, updated_at = ?9`,
  )
    .bind(bookingId, v.barberlyId ?? null, v.state, v.fail ? null : (v.row?.starts_at ?? null), v.fail ? null : (v.row?.ends_at ?? null), v.fail ? null : (v.row?.barber_id ?? null), v.fail ? 1 : 0, v.detail.slice(0, 300), iso(new Date()), v.fail ? 1 : 0)
    .run();
}

/**
 * Trimite în Barberly programările noi sau mutate și anulează acolo ce s-a anulat la noi (cel mult `limit` din fiecare).
 * Rulează din cron la 5 minute și din panou („Trimite acum”). null = oprit sau nesetat.
 */
export async function runBarberlyPush(env: Env, now = new Date(), limit = 20) {
  const s = await getPushSettings(env);
  if (!s.enabled || !s.keySealed || !s.locationId || !s.phone) return null;
  const apiKey = await unseal(env, s.keySealed);
  const res = { sent: 0, moved: 0, cancelled: 0, errors: 0 };
  const horizon = iso(new Date(now.getTime() + 90 * 864e5));

  const rows = await env.DB.prepare(
    `SELECT b.id, b.starts_at, b.ends_at, b.barber_id, b.service_id, ${WALKIN_NAME_SQL} AS client_name, o.barberly_id, o.tries
     FROM bookings b JOIN clients c ON c.id = b.client_id LEFT JOIN barberly_outbox o ON o.booking_id = b.id
     WHERE b.status IN ${HOLDS_SLOT} AND b.barberly_ref IS NULL AND b.ends_at > ?4 AND b.starts_at < ?2
       AND (o.booking_id IS NULL
         OR (o.state = 'error' AND o.tries < ${MAX_TRIES})
         OR (o.state = 'synced' AND (o.starts_at IS NOT b.starts_at OR o.ends_at IS NOT b.ends_at OR o.barber_id IS NOT b.barber_id) AND o.tries < ${MAX_TRIES}))
     ORDER BY b.starts_at LIMIT ?3`,
  )
    // Și cele începute deja (ex. clientul fără programare, trecut în calendar când a intrat): restul timpului rămâne ocupat în Barberly.
    .bind(iso(now), horizon, limit, iso(new Date(now.getTime() + 5 * 60_000)))
    .all<Row>();

  for (const r of rows.results) {
    const tm = s.barbers[r.barber_id];
    const svc = s.services[r.service_id] ?? Object.values(s.services)[0];
    if (!tm || !svc) {
      await mark(env, r.id, { state: 'error', row: r, fail: true, detail: !tm ? 'Frizerul nu e legat de unul din Barberly (panou, mai jos).' : 'Niciun serviciu legat de Barberly.' });
      res.errors++;
      continue;
    }
    // Începută deja: în Barberly se trimite de acum (rotunjit la 5 minute) până la final, ca ora să fie în viitor.
    const startMs = Math.max(Date.parse(r.starts_at), Math.ceil(now.getTime() / 300_000) * 300_000);
    const { day, hm } = roLocal(new Date(startMs).toISOString());
    const body = {
      locationId: s.locationId,
      teamMemberId: tm,
      serviceIds: [svc],
      timeSlot: { date: day, startMinutesOfDay: +hm.slice(0, 2) * 60 + +hm.slice(3, 5), durationMinutes: Math.max(5, Math.round((Date.parse(r.ends_at) - startMs) / 60_000)) },
      customer: s.customerId
        ? { customerId: s.customerId, firstName: s.customerName.split(' ')[0] || 'Aplicatia', phoneNumber: s.phone }
        : { firstName: 'Aplicatia', lastName: 'TAF', phoneNumber: s.phone },
      note: `Din aplicatia TAF: ${(r.client_name || 'client').slice(0, 60)}`,
    };
    try {
      const b = r.barberly_id
        ? await bapi<BBooking>(env, apiKey, 'PUT', `/v1/bookings/${r.barberly_id}`, body)
        : await bapi<BBooking>(env, apiKey, 'POST', '/v1/bookings', body);
      await mark(env, r.id, { barberlyId: b?.id ?? r.barberly_id, state: 'synced', row: r, detail: b?.status === 'Unconfirmed' ? 'În Barberly apare neconfirmată.' : '' });
      if (r.barberly_id) res.moved++;
      else res.sent++;
    } catch (e) {
      await mark(env, r.id, { state: 'error', row: r, fail: true, detail: String(e instanceof Error ? e.message : e) });
      res.errors++;
    }
  }

  // Anulate (sau refuzate, expirate) la noi: se anulează și în Barberly. Cele încheiate sau „n-a venit” rămân cum sunt.
  const gone = await env.DB.prepare(
    `SELECT o.booking_id, o.barberly_id FROM barberly_outbox o JOIN bookings b ON b.id = o.booking_id
     WHERE o.barberly_id IS NOT NULL AND o.state IN ('synced', 'error') AND o.tries < ${MAX_TRIES}
       AND b.status = 'cancelled' AND b.starts_at > ? LIMIT ?`,
  )
    .bind(iso(now), limit)
    .all<{ booking_id: string; barberly_id: string }>();
  for (const g of gone.results) {
    try {
      await bapi(env, apiKey, 'POST', `/v1/bookings/${g.barberly_id}/cancel`, { reason: 'Anulata in aplicatia TAF' });
      await mark(env, g.booking_id, { state: 'cancelled', detail: '' });
      res.cancelled++;
    } catch (e) {
      await mark(env, g.booking_id, { state: 'error', fail: true, detail: `Anulare: ${String(e instanceof Error ? e.message : e)}` });
      res.errors++;
    }
  }
  return res;
}

// --- Panoul (doar proprietarul): Aplicații → Programări din Barberly → „Trimite și programările noastre în Barberly” ---

async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}

export const barberlyPushAdmin = new Hono<AppEnv>();
barberlyPushAdmin.use('/barberly/push', ownerOnly);
barberlyPushAdmin.use('/barberly/push/*', ownerOnly);

async function view(env: Env) {
  const s = await getPushSettings(env);
  const [barbers, services, log, counts] = await Promise.all([
    env.DB.prepare('SELECT id, name FROM barbers WHERE active = 1 ORDER BY sort, name').all<{ id: string; name: string }>(),
    env.DB.prepare('SELECT id, name FROM services ORDER BY name').all<{ id: string; name: string }>(),
    env.DB.prepare(
      `SELECT o.booking_id AS bookingId, o.state, o.detail, o.tries, o.updated_at AS updatedAt, b.starts_at AS startsAt, CASE WHEN b.client_id = '${WALKIN_ID}' THEN coalesce(nullif(trim(b.walkin_name), ''), '${WALKIN_LABEL}') ELSE cl.name END AS clientName, br.name AS barberName
       FROM barberly_outbox o JOIN bookings b ON b.id = o.booking_id JOIN clients cl ON cl.id = b.client_id JOIN barbers br ON br.id = b.barber_id
       ORDER BY o.updated_at DESC LIMIT 50`,
    ).all(),
    env.DB.prepare(`SELECT state, count(*) AS n FROM barberly_outbox GROUP BY state`).all<{ state: string; n: number }>(),
  ]);
  let catalog: Awaited<ReturnType<typeof barberlyCatalog>> | null = null;
  let catalogError = '';
  if (s.keySealed) {
    try {
      catalog = await barberlyCatalog(env, await unseal(env, s.keySealed), s.locationId);
    } catch (e) {
      catalogError = String(e instanceof Error ? e.message : e);
    }
  }
  return {
    enabled: s.enabled,
    hasKey: !!s.keySealed,
    keyHint: s.keyHint,
    locationId: s.locationId,
    phone: s.phone,
    customerId: s.customerId,
    customerName: s.customerName,
    barberMap: s.barbers,
    serviceMap: s.services,
    ourBarbers: barbers.results,
    ourServices: services.results,
    catalog,
    catalogError,
    counts: Object.fromEntries(counts.results.map((x) => [x.state, x.n])),
    log: log.results,
  };
}

barberlyPushAdmin.get('/barberly/push', async (c) => c.json(await view(c.env)));

barberlyPushAdmin.put('/barberly/push', async (c) => {
  const b = await c.req.json<{ key?: string | null; enabled?: boolean; locationId?: string; phone?: string; barbers?: Record<string, string>; services?: Record<string, string> }>();
  const s = await getPushSettings(c.env);
  const next: PushSettings = { ...s };
  if (b.key === null) Object.assign(next, { keySealed: null, keyHint: '', enabled: false });
  else if (typeof b.key === 'string' && b.key.trim()) {
    const k = b.key.trim();
    if (k.length < 10 || k.length > 300) throw new HttpError(400, 'invalid_key');
    // Cheia se verifică înainte de salvare; se păstrează doar criptată, iar în panou se arată doar ultimele 4 caractere.
    let cat;
    try {
      cat = await barberlyCatalog(c.env, k, b.locationId ?? s.locationId);
    } catch (e) {
      return c.json({ error: 'barberly_key_rejected', message: String(e instanceof Error ? e.message : e) }, 400);
    }
    const [ourB, ourS] = await Promise.all([
      c.env.DB.prepare('SELECT id, name FROM barbers WHERE active = 1').all<{ id: string; name: string }>(),
      c.env.DB.prepare('SELECT id, name FROM services').all<{ id: string; name: string }>(),
    ]);
    Object.assign(next, {
      keySealed: await seal(c.env, k),
      keyHint: k.slice(-4),
      locationId: cat.locationId,
      barbers: autoMatch(ourB.results, cat.teamMembers, s.barbers, true),
      services: autoMatch(ourS.results, cat.services, s.services),
    });
    if (!next.phone) {
      const biz = await getBusiness(c.env);
      try {
        next.phone = biz.phone ? normalizePhone(biz.phone) : '';
      } catch {
        next.phone = '';
      }
    }
  }
  if (typeof b.locationId === 'string' && b.locationId) next.locationId = b.locationId.slice(0, 64);
  if (typeof b.phone === 'string') next.phone = b.phone.trim() ? normalizePhone(b.phone) : '';
  const clean = (m: unknown) =>
    Object.fromEntries(Object.entries((m ?? {}) as Record<string, unknown>).filter(([k, v]) => typeof v === 'string' && v && k.length <= 64 && (v as string).length <= 64)) as Record<string, string>;
  if (b.barbers) next.barbers = clean(b.barbers);
  if (b.services) next.services = clean(b.services);
  if (typeof b.enabled === 'boolean') {
    if (b.enabled && (!next.keySealed || !next.locationId || !next.phone)) throw new HttpError(400, 'barberly_push_incomplete');
    next.enabled = b.enabled;
  }
  await setSetting(c.env, KEY, next);
  return c.json(await view(c.env));
});

// Contul de client din Barberly (când salonul cere clienți înregistrați). Trei căi, toate pe numărul salonului:
// intrare cu parola, cont nou (cod prin SMS/e-mail) sau parolă nouă (cod). Parola trece doar spre Barberly (Base64, cum cer ei).
type AuthResult = { customer?: { customerId?: string | null; firstName?: string | null; lastName?: string | null; phoneNumber?: string | null } | null };
const b64pw = (p: string) => btoa(String.fromCharCode(...new TextEncoder().encode(p)));

async function linkCustomer(c: Context<AppEnv>, s: PushSettings, r: AuthResult) {
  const cu = r?.customer;
  if (!cu?.customerId) return c.json({ error: 'barberly_account_failed', message: 'Barberly nu a întors contul clientului.' }, 400);
  let phone = s.phone;
  try {
    if (cu.phoneNumber) phone = normalizePhone(cu.phoneNumber);
  } catch {
    /* rămâne numărul salvat */
  }
  await setSetting(c.env, KEY, { ...s, customerId: cu.customerId, customerName: [cu.firstName, cu.lastName].filter(Boolean).join(' ').slice(0, 80), phone });
  // Programările refuzate până acum (fără client înregistrat) se reîncearcă la următoarea trimitere.
  await c.env.DB.prepare(`UPDATE barberly_outbox SET tries = 0 WHERE state = 'error'`).run();
  return c.json(await view(c.env));
}

barberlyPushAdmin.post('/barberly/push/account', async (c) => {
  const b = await c.req.json<{ action?: string; phone?: string; password?: string; email?: string; firstName?: string; code?: string; recipient?: string }>();
  const s = await getPushSettings(c.env);
  if (!s.keySealed) throw new HttpError(400, 'barberly_push_incomplete');
  const apiKey = await unseal(c.env, s.keySealed);
  const phone = normalizePhone(b.phone || s.phone);
  const pw = (b.password ?? '').slice(0, 200);
  try {
    switch (b.action) {
      case 'login':
        if (!pw) throw new HttpError(400, 'invalid_body');
        return await linkCustomer(c, { ...s, phone }, await bapi<AuthResult>(c.env, apiKey, 'POST', '/v1/accounts/login', { phoneNumber: phone, password: b64pw(pw) }));
      case 'register':
        if (!pw || !b.email || !b.firstName) throw new HttpError(400, 'invalid_body');
        await bapi(c.env, apiKey, 'POST', '/v1/accounts/register', { email: b.email.trim().slice(0, 120), firstName: b.firstName.trim().slice(0, 60), lastName: 'TAF', phoneNumber: phone, password: b64pw(pw) });
        return c.json({ codeSent: true, phone });
      case 'register_confirm':
        if (!b.code) throw new HttpError(400, 'invalid_body');
        return await linkCustomer(c, { ...s, phone }, await bapi<AuthResult>(c.env, apiKey, 'POST', '/v1/accounts/register/confirm', { phoneNumber: phone, confirmationCode: b.code.trim() }));
      case 'reset': {
        if (!pw) throw new HttpError(400, 'invalid_body');
        const recipient = (b.recipient ?? '').trim() || phone;
        await bapi(c.env, apiKey, 'POST', '/v1/accounts/password/reset', { recipient, newPassword: b64pw(pw) });
        return c.json({ codeSent: true, recipient });
      }
      case 'reset_confirm': {
        if (!b.code) throw new HttpError(400, 'invalid_body');
        const recipient = (b.recipient ?? '').trim() || phone;
        return await linkCustomer(c, { ...s, phone }, await bapi<AuthResult>(c.env, apiKey, 'POST', '/v1/accounts/password/reset/confirm', { recipient, confirmationCode: b.code.trim() }));
      }
      case 'unlink':
        await setSetting(c.env, KEY, { ...s, customerId: '', customerName: '' });
        return c.json(await view(c.env));
      default:
        throw new HttpError(400, 'invalid_body');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return c.json({ error: 'barberly_account_failed', message: String(e instanceof Error ? e.message : e) }, 400);
  }
});

// „Trimite acum” (fără să aștepte cronul) și „Reîncearcă” pentru cele care au dat eroare de 5 ori.
barberlyPushAdmin.post('/barberly/push/run', async (c) => {
  const b = await c.req.json<{ retry?: boolean }>().catch(() => ({}) as { retry?: boolean });
  if (b.retry) await c.env.DB.prepare(`UPDATE barberly_outbox SET tries = 0 WHERE state = 'error'`).run();
  const r = await runBarberlyPush(c.env);
  if (!r) throw new HttpError(400, 'barberly_push_off');
  return c.json(r);
});
