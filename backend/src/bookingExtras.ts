import { newId } from './auth';
import { availability } from './availability';
import { getBooking, HOLDS_SLOT, logBookingEvent } from './bookings';
import { HttpError, type Env } from './env';
import { discounted, serviceOffers } from './offers';
import { notifyStaff } from './staffNotify';
import { iso, localDay } from './time';

// Servicii adăugate la o programare (ex. Tuns & Barbă + Vopsit barbă). Serviciul principal rămâne în bookings.service_id;
// cele adăugate stau în booking_extras, iar durata și prețul lor sunt incluse în ends_at și price_bani ale programării.

/** Câte servicii se pot adăuga la aceeași programare (pe lângă cel principal). */
export const MAX_EXTRAS = 3;

/** Lista curată: fără repetări, fără serviciul principal, cel mult MAX_EXTRAS. */
export function cleanExtraIds(raw: unknown, mainServiceId: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'invalid_extras');
  const ids = [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))].filter((x) => x !== mainServiceId);
  if (ids.length > MAX_EXTRAS) throw new HttpError(400, 'too_many_extras');
  return ids;
}

export type ExtraQuote = { serviceId: string; durationMin: number; priceBani: number };

/**
 * Durata și prețul serviciilor adăugate la frizerul ales: ale lui (Frizeri → servicii), altfel cele standard,
 * cu reducerea din bannerul activ, ca la serviciul principal. Frizerul trebuie să facă serviciul.
 */
export async function extraQuotes(env: Env, barberId: string, ids: string[]): Promise<ExtraQuote[]> {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT s.id, s.duration_min, s.price_bani, bs.duration_min AS own_min, bs.price_bani AS own_bani, bs.barber_id AS has
     FROM services s LEFT JOIN barber_services bs ON bs.service_id = s.id AND bs.barber_id = ?
     WHERE s.active = 1 AND s.id IN (${ph})`,
  )
    .bind(barberId, ...ids)
    .all<{ id: string; duration_min: number; price_bani: number; own_min: number | null; own_bani: number | null; has: string | null }>();
  const offers = await serviceOffers(env);
  return ids.map((sid) => {
    const r = rows.results.find((x) => x.id === sid);
    if (!r) throw new HttpError(404, 'service_not_found');
    if (!r.has) throw new HttpError(409, 'barber_no_service');
    const base = r.own_bani ?? r.price_bani;
    const offer = offers.get(sid);
    return { serviceId: sid, durationMin: r.own_min ?? r.duration_min, priceBani: offer ? discounted(base, offer.percent) : base };
  });
}

export async function insertExtras(env: Env, bookingId: string, extras: ExtraQuote[]) {
  if (!extras.length) return;
  await env.DB.batch(
    extras.map((x) =>
      env.DB.prepare('INSERT INTO booking_extras (id, booking_id, service_id, duration_min, price_bani) VALUES (?, ?, ?, ?, ?)').bind(
        newId('bx'),
        bookingId,
        x.serviceId,
        x.durationMin,
        x.priceBani,
      ),
    ),
  );
}

type Who = { adminId: string } | { clientId: string };

async function editable(env: Env, id: string, who: Who) {
  const b = await getBooking(env, id);
  if (!b || ('clientId' in who && b.clientId !== who.clientId)) throw new HttpError(404, 'booking_not_found');
  if (b.status !== 'confirmed' && b.status !== 'requested') throw new HttpError(409, 'booking_not_editable');
  // Plătită online: suma e deja luată de pe card și nu se mai schimbă.
  if (b.onlinePaid) throw new HttpError(409, 'booking_paid');
  // Clientul adaugă doar înainte de ora programării.
  if ('clientId' in who && Date.parse(b.start) <= Date.now()) throw new HttpError(409, 'booking_started');
  return b;
}

/**
 * Adaugă un serviciu la o programare: se prelungește cu durata lui și prețul crește cu prețul lui (la frizerul programării).
 * Timpul în plus trebuie să fie liber (după programare, în programul frizerului). Din panou, `force` îl pune oricum,
 * doar să nu se suprapună cu altă programare.
 */
export async function addExtra(env: Env, id: string, serviceIdRaw: unknown, who: Who, opts: { force?: boolean; defer?: (p: Promise<unknown>) => void } = {}) {
  const serviceId = String(serviceIdRaw ?? '').trim();
  if (!serviceId) throw new HttpError(400, 'service_required');
  const b = await editable(env, id, who);
  const have = b.extras.map((e) => e.serviceId);
  if (serviceId === b.serviceId || have.includes(serviceId)) throw new HttpError(409, 'service_already_added');
  if (have.length >= MAX_EXTRAS) throw new HttpError(409, 'too_many_extras');
  const [q] = await extraQuotes(env, b.barberId, [serviceId]);
  const isAdmin = 'adminId' in who;
  const start = new Date(b.start);
  const end = new Date(Date.parse(b.end) + q.durationMin * 60_000);

  if (!(isAdmin && opts.force)) {
    const slots = await availability(env, {
      serviceId: b.serviceId,
      barberId: b.barberId,
      day: localDay(env.TIMEZONE, start),
      excludeBookingId: id,
      access: 'staff',
      anyTime: true,
      extraServiceIds: [...have, serviceId],
    });
    if (!slots.some((s) => Date.parse(s.start) === start.getTime() && s.barberId === b.barberId)) throw new HttpError(409, 'no_time_for_extra');
  }
  const r = await env.DB.prepare(
    `UPDATE bookings SET ends_at = ?, price_bani = price_bani + ?
     WHERE id = ? AND status IN ${HOLDS_SLOT} AND online_paid_bani IS NULL AND ends_at = ?
       AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.id != ? AND o.barber_id = ? AND o.status IN ${HOLDS_SLOT} AND o.starts_at < ? AND o.ends_at > ?)`,
  )
    .bind(iso(end), q.priceBani, id, b.end, id, b.barberId, iso(end), b.end)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'no_time_for_extra');
  await insertExtras(env, id, [q]);
  const updated = (await getBooking(env, id))!;
  const name = updated.extras.find((e) => e.serviceId === serviceId)?.name ?? '';
  await logBookingEvent(env, id, 'extra_added', { service: name, price: q.priceBani / 100, minutes: q.durationMin, by: isAdmin ? 'staff' : 'client' }, isAdmin ? who.adminId : null);
  const send = notifyStaff(env, updated, 'extra', isAdmin ? who.adminId : null, { extraName: name });
  if (opts.defer) opts.defer(send);
  else await send;
  return updated;
}

/** Scoate un serviciu adăugat: programarea se scurtează și prețul scade cu cât a crescut la adăugare. */
export async function removeExtra(env: Env, id: string, extraId: string, who: Who) {
  const b = await editable(env, id, who);
  const x = b.extras.find((e) => e.id === extraId);
  if (!x) throw new HttpError(404, 'extra_not_found');
  const end = new Date(Math.max(Date.parse(b.start) + 5 * 60_000, Date.parse(b.end) - x.durationMin * 60_000));
  const bani = Math.round(x.price * 100);
  const res = await env.DB.prepare(`UPDATE bookings SET ends_at = ?, price_bani = max(0, price_bani - ?) WHERE id = ? AND ends_at = ? AND online_paid_bani IS NULL`)
    .bind(iso(end), bani, id, b.end)
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'booking_changed');
  await env.DB.prepare('DELETE FROM booking_extras WHERE id = ? AND booking_id = ?').bind(extraId, id).run();
  const isAdmin = 'adminId' in who;
  await logBookingEvent(env, id, 'extra_removed', { service: x.name, price: x.price, by: isAdmin ? 'staff' : 'client' }, isAdmin ? who.adminId : null);
  return (await getBooking(env, id))!;
}
