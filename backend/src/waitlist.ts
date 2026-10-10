// Lista de așteptare: clientul care nu găsește oră liberă într-o zi cere să fie anunțat dacă se eliberează un loc.
// Când se eliberează o oră în ziua aceea (anulare, refuz, cerere expirată, program schimbat), primii înscriși primesc
// un mesaj („waitlist_slot”) cu linkul de programare. Nu se face nicio programare automată.
import { Hono } from 'hono';
import { newId } from './auth';
import { accessFor, availability, eligibleBarbers, type Access, type Slot } from './availability';
import { getBusiness } from './db';
import { activeLocationId, locationVars } from './locations';
import { HttpError, type AppEnv, type Env } from './env';
import { openAppPage } from './qr';
import { channelsFor } from './growth';
import { sendTemplate } from './sendTemplate';
import { addDays, formatLocal, iso, isDay, localDay, localMinutes, weekdayOf } from './time';

export type Part = 'any' | 'morning' | 'afternoon' | 'evening';
export const PARTS: Part[] = ['any', 'morning', 'afternoon', 'evening'];

/** De câte ori, cel mult, e anunțată o înscriere în total. */
export const MAX_NOTICES = 3;
/** Câți oameni primesc odată aceeași oră liberă (primii din listă). */
export const PER_SLOT = 3;
/** După câte minute, dacă ora e tot liberă, o primesc următorii din listă. */
export const WAVE_MIN = 10;
/** Câte înscrieri active poate avea un client odată. */
export const MAX_ACTIVE = 5;
/** Câte ore libere se trec, cel mult, într-un mesaj. */
const TIMES_IN_MSG = 3;

/** Stările în care înscrierea încă poate primi mesaje (dacă n-a atins limita). */
const OPEN = `('waiting','notified')`;

export type WaitlistRow = {
  id: string;
  client_id: string;
  service_id: string;
  barber_id: string | null;
  location_id?: string | null;
  day: string;
  part: Part;
  status: 'waiting' | 'notified' | 'booked' | 'expired' | 'removed';
  notify_count: number;
  last_notified_at: string | null;
  last_slot: string | null;
  removed_by: 'client' | 'staff' | null;
  closed_at: string | null;
  created_at: string;
  service_name?: string;
  barber_name?: string | null;
  location_name?: string | null;
  client_name?: string;
  client_phone?: string;
};

export const WAITLIST_SELECT = `
  SELECT w.*, s.name AS service_name, br.name AS barber_name, loc.name AS location_name, c.name AS client_name, c.phone AS client_phone
  FROM waitlist w
  JOIN services s ON s.id = w.service_id
  JOIN clients c ON c.id = w.client_id
  LEFT JOIN barbers br ON br.id = w.barber_id
  LEFT JOIN locations loc ON loc.id = w.location_id`;

export function waitlistEntry(r: WaitlistRow, withClient = false) {
  return {
    id: r.id,
    serviceId: r.service_id,
    serviceName: r.service_name ?? '',
    barberId: r.barber_id,
    barberName: r.barber_name ?? null,
    // „Orice frizer” din această locație (NULL = oricare locație, la înscrierile de dinaintea locațiilor).
    locationId: r.location_id ?? null,
    locationName: r.location_name ?? null,
    day: r.day,
    part: r.part,
    status: r.status,
    notifyCount: r.notify_count,
    maxNotices: MAX_NOTICES,
    // Încă poate primi mesaje: deschisă și sub limită.
    active: (r.status === 'waiting' || r.status === 'notified') && r.notify_count < MAX_NOTICES,
    lastNotifiedAt: r.last_notified_at,
    lastSlot: r.last_slot,
    removedBy: r.removed_by,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    ...(withClient && { clientId: r.client_id, clientName: r.client_name ?? '', clientPhone: (r.client_phone ?? '').startsWith('deleted:') ? '' : (r.client_phone ?? '') }),
  };
}

/** Intervalul din zi, după ora locală de început (ca în aplicație: dimineața < 12, după-amiaza < 17, seara). */
function inPart(env: Env, part: Part, start: string) {
  if (part === 'any') return true;
  const h = localMinutes(env.TIMEZONE, new Date(start)) / 60;
  return part === 'morning' ? h < 12 : part === 'afternoon' ? h >= 12 && h < 17 : h >= 17;
}

const hm = (env: Env, start: string) => {
  const m = localMinutes(env.TIMEZONE, new Date(start));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Linkul din mesaj: deschide aplicația direct la alegerea orei, pe ziua și serviciul din listă. */
export function bookLink(env: Env, id: string) {
  // Fără adresa publică a serverului rămâne doar legătura directă spre aplicație.
  return env.PUBLIC_URL ? `${env.PUBLIC_URL.replace(/\/+$/, '')}/w/${id}` : 'tafbarbers://book';
}

/** Adresa din aplicație pentru o înscriere: alegerea orei, cu serviciul, frizerul (sau locația) și ziua deja puse. */
export function appBookUrl(w: { service_id: string; barber_id: string | null; location_id?: string | null; day: string }) {
  const q = new URLSearchParams({
    serviceId: w.service_id,
    day: w.day,
    ...(w.barber_id && { barberId: w.barber_id }),
    ...(w.location_id && { locationId: w.location_id }),
  });
  return `tafbarbers://book?${q.toString()}`;
}

/** Clientul se înscrie pe lista de așteptare a unei zile. Aceeași înscriere trimisă de două ori o întoarce pe cea existentă. */
export async function joinWaitlist(env: Env, clientId: string, b: { serviceId?: unknown; barberId?: unknown; locationId?: unknown; day?: unknown; part?: unknown }) {
  const serviceId = typeof b.serviceId === 'string' ? b.serviceId : '';
  const barberId = typeof b.barberId === 'string' && b.barberId ? b.barberId : null;
  // Locația: a frizerului ales sau, pentru „orice frizer”, cea aleasă în aplicație.
  let locationId = barberId ? null : await activeLocationId(env, b.locationId);
  const part: Part = PARTS.includes(b.part as Part) ? (b.part as Part) : 'any';
  if (!serviceId || !isDay(b.day)) throw new HttpError(400, 'invalid_body');
  const day = b.day;
  const today = localDay(env.TIMEZONE, new Date());
  const biz = await getBusiness(env);
  if (day < today) throw new HttpError(400, 'day_passed');
  if (day > addDays(today, biz.maxDaysAhead ?? 30)) throw new HttpError(400, 'too_far_ahead');

  const svc = await env.DB.prepare('SELECT id FROM services WHERE id = ? AND active = 1').bind(serviceId).first();
  if (!svc) throw new HttpError(404, 'service_not_found');
  const barbers = await eligibleBarbers(env, serviceId, barberId, locationId);
  if (!barbers.length) throw new HttpError(404, 'barber_not_found');
  if (barberId) locationId = (await env.DB.prepare('SELECT location_id FROM barbers WHERE id = ?').bind(barberId).first<{ location_id: string | null }>())?.location_id ?? null;
  // O zi în care nimeni nu lucrează (salon închis) nu are ce elibera.
  const ph = barbers.map(() => '?').join(',');
  const works = await env.DB.prepare(`SELECT 1 FROM working_hours WHERE weekday = ? AND barber_id IN (${ph}) LIMIT 1`)
    .bind(weekdayOf(day), ...barbers)
    .first();
  if (!works) throw new HttpError(409, 'day_closed');

  const same = await env.DB.prepare(
    `${WAITLIST_SELECT} WHERE w.client_id = ? AND w.service_id = ? AND w.day = ? AND w.part = ? AND w.barber_id IS ? AND w.location_id IS ? AND w.status IN ${OPEN} AND w.notify_count < ?`,
  )
    .bind(clientId, serviceId, day, part, barberId, locationId, MAX_NOTICES)
    .first<WaitlistRow>();
  if (same) return { entry: waitlistEntry(same), created: false };

  // Dacă sunt deja ore libere în intervalul ales, clientul se programează direct.
  const free = (await availability(env, { serviceId, barberId, locationId, day, access: await accessFor(env, clientId) })).filter((s) => inPart(env, part, s.start));
  if (free.length) throw new HttpError(409, 'slots_available');

  const n = await env.DB.prepare(`SELECT count(*) AS n FROM waitlist WHERE client_id = ? AND status IN ${OPEN} AND notify_count < ? AND day >= ?`)
    .bind(clientId, MAX_NOTICES, today)
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_ACTIVE) throw new HttpError(409, 'waitlist_limit');

  const id = newId('wl');
  await env.DB.prepare('INSERT INTO waitlist (id, client_id, service_id, barber_id, location_id, day, part) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, clientId, serviceId, barberId, locationId, day, part)
    .run();
  const row = await env.DB.prepare(`${WAITLIST_SELECT} WHERE w.id = ?`).bind(id).first<WaitlistRow>();
  return { entry: waitlistEntry(row!), created: true };
}

/** Înscrierile clientului de azi încolo (cele deschise și cele închise de curând, ca să vadă ce s-a întâmplat). */
export async function myWaitlist(env: Env, clientId: string) {
  const today = localDay(env.TIMEZONE, new Date());
  const r = await env.DB.prepare(`${WAITLIST_SELECT} WHERE w.client_id = ? AND w.day >= ? AND w.status != 'removed' ORDER BY w.day, w.created_at, w.rowid LIMIT 50`)
    .bind(clientId, today)
    .all<WaitlistRow>();
  return r.results.map((x) => waitlistEntry(x));
}

/** Scoate o înscriere de pe listă (clientul pe a lui, echipa pe oricare la care are acces). */
export async function removeWaitlist(env: Env, id: string, by: 'client' | 'staff', opts: { clientId?: string; barberId?: string | null } = {}) {
  const row = await env.DB.prepare('SELECT client_id, barber_id, status FROM waitlist WHERE id = ?').bind(id).first<{ client_id: string; barber_id: string | null; status: string }>();
  if (!row || (opts.clientId && row.client_id !== opts.clientId)) throw new HttpError(404, 'not_found');
  // Frizerul fără „toate programările” scoate doar de pe lista lui (sau „orice frizer”).
  if (opts.barberId && row.barber_id && row.barber_id !== opts.barberId) throw new HttpError(404, 'not_found');
  const r = await env.DB.prepare(`UPDATE waitlist SET status = 'removed', removed_by = ?, closed_at = ? WHERE id = ? AND status IN ${OPEN}`)
    .bind(by, iso(new Date()), id)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'waitlist_closed');
}

/** Clientul și-a făcut programare în ziua aceea pentru serviciul respectiv: nu mai are nevoie de anunț. */
export async function closeOnBooking(env: Env, clientId: string, serviceId: string, start: string) {
  await env.DB.prepare(`UPDATE waitlist SET status = 'booked', closed_at = ? WHERE client_id = ? AND service_id = ? AND day = ? AND status IN ${OPEN}`)
    .bind(iso(new Date()), clientId, serviceId, localDay(env.TIMEZONE, new Date(start)))
    .run();
}

/**
 * Caută locuri libere pentru înscrierile deschise (toate zilele sau doar `day`) și anunță primii din listă.
 * Rulează din cron (prinde și schimbările de program) și imediat după o anulare / un refuz.
 * Fiecare înscriere se marchează înainte de mesaj, ca o rulare suprapusă să n-o anunțe de două ori.
 */
export async function checkWaitlist(env: Env, opts: { day?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const today = localDay(env.TIMEZONE, now);
  // Zilele trecute se închid.
  await env.DB.prepare(`UPDATE waitlist SET status = 'expired', closed_at = ? WHERE status IN ${OPEN} AND day < ?`).bind(iso(now), today).run();

  // Mesajul oprit din Notificări (sau pornit, dar fără niciun canal bifat): nu consumăm anunțurile;
  // înscrierile rămân pe listă pentru când pleacă din nou.
  const ch = await channelsFor(env, 'waitlist_slot');
  if (!ch || !(ch.sms || ch.push || ch.email)) return 0;

  const rows = await env.DB.prepare(
    `${WAITLIST_SELECT} WHERE w.status IN ${OPEN} AND w.notify_count < ? AND w.day >= ? ${opts.day ? 'AND w.day = ?' : ''} AND c.deleted_at IS NULL
     ORDER BY w.created_at, w.rowid LIMIT 500`,
  )
    .bind(...(opts.day ? [MAX_NOTICES, today, opts.day] : [MAX_NOTICES, today]))
    .all<WaitlistRow>();
  if (!rows.results.length) return 0;

  // Orele libere, calculate o singură dată pe (serviciu, frizer, zi, membru sau nu): orele „doar membri” se anunță doar membrilor.
  const cache = new Map<string, Slot[]>();
  const accessOf = new Map<string, Access>();
  const slotsFor = async (w: WaitlistRow) => {
    if (!accessOf.has(w.client_id)) accessOf.set(w.client_id, await accessFor(env, w.client_id));
    const access = accessOf.get(w.client_id)!;
    // „Orice frizer”: doar frizerii din locația înscrierii (fără locație = din oricare).
    const loc = w.barber_id ? null : (w.location_id ?? null);
    const k = `${w.service_id}|${w.barber_id ?? ''}|${loc ?? ''}|${w.day}|${access}`;
    if (!cache.has(k)) {
      let s: Slot[] = [];
      try {
        s = await availability(env, { serviceId: w.service_id, barberId: w.barber_id, locationId: loc, day: w.day, access });
      } catch {
        // serviciu scos între timp: nu are ce anunța
      }
      cache.set(k, s);
    }
    return cache.get(k)!;
  };

  // Același client, același serviciu și aceeași zi: înscrierile lui (oricâte) contează ca una singură.
  const whoOf = (w: { client_id: string; service_id: string; day: string }) => `${w.client_id}|${w.service_id}|${w.day}`;

  // Orele deja anunțate fiecărui client (pe serviciu și zi, din oricare înscriere a lui), citite o singură dată.
  const offered = new Map<string, Set<string>>();
  const known = await env.DB.prepare(
    `SELECT w.client_id, w.service_id, w.day, o.slot_start FROM waitlist_offers o JOIN waitlist w ON w.id = o.entry_id
     WHERE w.day >= ? ${opts.day ? 'AND w.day = ?' : ''}`,
  )
    .bind(...(opts.day ? [today, opts.day] : [today]))
    .all<{ client_id: string; service_id: string; day: string; slot_start: string }>();
  for (const x of known.results) offered.set(whoOf(x), (offered.get(whoOf(x)) ?? new Set()).add(x.slot_start));

  // Cine are deja o cerere de programare care așteaptă răspuns în ziua aceea nu primește anunțuri cât timp așteaptă.
  const waitingAnswer = new Set<string>();
  const req = await env.DB.prepare(`SELECT client_id, service_id, starts_at FROM bookings WHERE status = 'requested' AND starts_at > ?`)
    .bind(iso(now))
    .all<{ client_id: string; service_id: string; starts_at: string }>();
  for (const b of req.results) waitingAnswer.add(whoOf({ ...b, day: localDay(env.TIMEZONE, new Date(b.starts_at)) }));

  // Câți oameni au primit deja ora în valul curent (ultimele WAVE_MIN minute), citit o dată pe rulare. E doar o primă
  // trecere: anunțul se înregistrează numai dacă tot mai e loc în val, ca două verificări simultane să nu treacă peste PER_SLOT.
  const since = iso(new Date(now.getTime() - WAVE_MIN * 60_000));
  const wave = new Map<string, number>();
  const waveFull = async (start: string, barberId: string) => {
    const k = `${start}|${barberId}`;
    if (!wave.has(k)) {
      const r = await env.DB.prepare('SELECT count(*) AS n FROM waitlist_offers WHERE slot_start = ? AND barber_id = ? AND sent_at > ?')
        .bind(start, barberId, since)
        .first<{ n: number }>();
      wave.set(k, r?.n ?? 0);
    }
    return wave.get(k)! >= PER_SLOT;
  };

  let sent = 0;
  for (const w of rows.results) {
    const who = whoOf(w);
    if (waitingAnswer.has(who)) continue;
    const free = (await slotsFor(w)).filter((s) => inPart(env, w.part, s.start));
    if (!free.length) continue;
    const seen = offered.get(who) ?? new Set<string>();
    // Orele noi pentru el (nu i le-am mai anunțat), la care mai e loc în valul curent.
    // „Orice frizer”: un mesaj numește un singur frizer, deci orele din el sunt toate ale aceluiași frizer.
    const fresh = free.filter((s) => !seen.has(s.start));
    const pick: Slot[] = [];
    for (const s of fresh) {
      if (pick.length && s.barberId !== pick[0].barberId) continue;
      if (await waveFull(s.start, s.barberId)) continue;
      pick.push(s);
      if (pick.length >= TIMES_IN_MSG) break;
    }
    if (!pick.length) continue;

    const claimed = await env.DB.prepare(
      `UPDATE waitlist SET status = 'notified', notify_count = notify_count + 1, last_notified_at = ?, last_slot = ?
       WHERE id = ? AND notify_count = ? AND status IN ${OPEN}`,
    )
      .bind(iso(now), pick[0].start, w.id, w.notify_count)
      .run();
    if (!claimed.meta.changes) continue;
    // Fiecare oră se înregistrează doar dacă valul ei nu s-a umplut între timp (verificare și scriere în aceeași instrucțiune).
    const ins = await env.DB.batch(
      pick.map((s) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO waitlist_offers (entry_id, slot_start, barber_id, sent_at)
           SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM waitlist_offers WHERE slot_start = ? AND barber_id = ? AND sent_at > ?) < ?`,
        ).bind(w.id, s.start, s.barberId, iso(now), s.start, s.barberId, since, PER_SLOT),
      ),
    );
    const got = pick.filter((_, i) => ins[i].meta.changes);
    // Valurile pline (de altă verificare, între timp) nu se mai încearcă în rularea asta.
    pick.forEach((s, i) => !ins[i].meta.changes && wave.set(`${s.start}|${s.barberId}`, PER_SLOT));
    const undo = async () => {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM waitlist_offers WHERE entry_id = ? AND sent_at = ? AND slot_start IN (${pick.map(() => '?').join(',')})`).bind(
          w.id,
          iso(now),
          ...pick.map((s) => s.start),
        ),
        env.DB.prepare('UPDATE waitlist SET status = ?, notify_count = ?, last_notified_at = ?, last_slot = ? WHERE id = ? AND notify_count = ?').bind(
          w.status,
          w.notify_count,
          w.last_notified_at,
          w.last_slot,
          w.id,
          w.notify_count + 1,
        ),
      ]);
    };
    if (!got.length) {
      await undo();
      continue;
    }

    let delivered = false;
    try {
      delivered = await notifyEntry(env, w, got);
    } catch (e) {
      console.error('waitlist notify', w.id, e);
    }
    // Nu a plecat nimic (SMS-ul a dat eroare, nicio aplicație, niciun e-mail): anunțul nu se socotește; se reîncearcă la următoarea verificare.
    if (!delivered) {
      await undo();
      continue;
    }
    // Restul orelor libere de acum din intervalul lui: le vede oricum în aplicație când deschide linkul, deci nu i le mai anunțăm
    // ca „loc nou” la următoarea verificare. Se trec cu o oră veche, ca să nu ocupe valul altor clienți.
    const rest = fresh.filter((s) => !got.includes(s));
    if (rest.length) {
      await env.DB.batch(
        rest.map((s) => env.DB.prepare('INSERT OR IGNORE INTO waitlist_offers (entry_id, slot_start, barber_id, sent_at) VALUES (?, ?, ?, ?)').bind(w.id, s.start, s.barberId, SEEN_AT)),
      );
    }
    for (const s of got) wave.set(`${s.start}|${s.barberId}`, (wave.get(`${s.start}|${s.barberId}`) ?? 0) + 1);
    for (const s of fresh) seen.add(s.start);
    offered.set(who, seen);
    sent++;
  }
  return sent;
}

/** Ora pusă pe orele „văzute” (libere odată cu un anunț, dar netrecute în mesaj): mereu în afara valului curent. */
const SEEN_AT = '1970-01-01T00:00:00Z';

/** Trimite anunțul; întoarce true dacă a plecat pe cel puțin un canal. */
async function notifyEntry(env: Env, w: WaitlistRow, slots: Slot[]) {
  const c = await env.DB.prepare('SELECT lang FROM clients WHERE id = ?').bind(w.client_id).first<{ lang: string }>();
  if (!c) return false;
  // „Orice frizer”: în mesaj apare frizerul orelor anunțate (toate sunt ale lui).
  const br = await env.DB.prepare('SELECT name, location_id FROM barbers WHERE id = ?').bind(slots[0].barberId).first<{ name: string; location_id: string | null }>();
  const barberName = w.barber_name ?? br?.name ?? '';
  const r = await sendTemplate(
    env,
    'waitlist_slot',
    w.client_id,
    {
      servicename: w.service_name ?? '',
      barbername: barberName,
      datetime: formatLocal(env.TIMEZONE, slots[0].start, c.lang),
      times: slots.map((s) => hm(env, s.start)).join(', '),
      booklink: bookLink(env, w.id),
      // Locația frizerului orelor anunțate (cu mai multe locații, mesajul spune unde).
      ...(await locationVars(env, br?.location_id ?? w.location_id, c.lang)),
    },
    { data: { screen: 'book', serviceId: w.service_id, barberId: w.barber_id ?? '', locationId: w.location_id ?? '', day: w.day } },
  );
  return r.sms || r.push || r.email;
}

/** Lista pentru panou: înscrierile pe zile (doar pentru un frizer, dacă e dat: ale lui și cele pentru „orice frizer”). */
export async function adminWaitlist(env: Env, q: { from?: string; to?: string; all?: boolean; barberId?: string | null }) {
  const today = localDay(env.TIMEZONE, new Date());
  const from = isDay(q.from) ? q.from : today;
  const to = isDay(q.to) ? q.to : addDays(today, 60);
  const where = ['w.day >= ?', 'w.day <= ?'];
  const vals: unknown[] = [from, to];
  if (!q.all) where.push(`w.status IN ${OPEN}`);
  if (q.barberId) where.push('(w.barber_id = ? OR w.barber_id IS NULL)'), vals.push(q.barberId);
  const r = await env.DB.prepare(`${WAITLIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY w.day, w.created_at, w.rowid LIMIT 1000`)
    .bind(...vals)
    .all<WaitlistRow>();
  return r.results.map((x) => waitlistEntry(x, true));
}

// --- Linkul din mesaj (public): /w/<id> deschide aplicația la alegerea orei ---

export const waitlistPublic = new Hono<AppEnv>();

waitlistPublic.get('/w/:id', async (c) => {
  const w = await c.env.DB.prepare('SELECT service_id, barber_id, location_id, day FROM waitlist WHERE id = ?')
    .bind(c.req.param('id').slice(0, 40))
    .first<{ service_id: string; barber_id: string | null; location_id: string | null; day: string }>();
  // Un link necunoscut tot deschide aplicația, la programare.
  return c.html(await openAppPage(c.env, w ? appBookUrl(w) : 'tafbarbers://book'));
});
