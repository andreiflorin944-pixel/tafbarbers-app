import { BOOKING_SELECT, HOLDS_SLOT } from './bookings';
import { booking, type BookingRow } from './db';
import type { Env } from './env';
import { iso, localDay, localMinutes, weekdayOf } from './time';

// Programările deja făcute pe care o schimbare de program (zi liberă, bloc, program de lucru nou) le lasă în afara programului.
// Schimbarea nu le anulează singură: panoul le arată și proprietarul alege să le anuleze (clientul e anunțat) sau să le păstreze.

/** Cel mult atâtea programări în avertizare (o zi liberă de o lună la tot salonul încape lejer). */
const MAX = 200;

/** Programările date prin id, cu numele clientului, serviciului și frizerului, în ordinea orei (fără telefon: le vede și frizerul fără dreptul „contacte”). */
export async function bookingsBrief(env: Env, ids: string[]) {
  if (!ids.length) return [];
  const list = ids.slice(0, MAX);
  const r = await env.DB.prepare(`${BOOKING_SELECT} WHERE b.id IN (${list.map(() => '?').join(',')}) ORDER BY b.starts_at`)
    .bind(...list)
    .all<BookingRow>();
  return r.results.map((x) => {
    const { clientPhone: _p, ...b } = booking(x);
    return b;
  });
}

/** Programările viitoare (confirmate sau cereri) care se suprapun cu intervalul dat, la un frizer sau la toți (`barberId` null). */
export async function overlapping(env: Env, start: string, end: string, barberId: string | null): Promise<string[]> {
  const r = await env.DB.prepare(
    `SELECT id FROM bookings WHERE status IN ${HOLDS_SLOT} AND starts_at > ? AND starts_at < ? AND ends_at > ? ${barberId ? 'AND barber_id = ?' : ''}
     ORDER BY starts_at LIMIT ${MAX}`,
  )
    .bind(iso(new Date()), end, start, ...(barberId ? [barberId] : []))
    .all<{ id: string }>();
  return r.results.map((x) => x.id);
}

export type Hours = Array<{ weekday: number; start: number; end: number }>;

export async function barberHours(env: Env, barberId: string): Promise<Hours> {
  const r = await env.DB.prepare('SELECT weekday, start_min AS start, end_min AS end FROM working_hours WHERE barber_id = ?')
    .bind(barberId)
    .all<{ weekday: number; start: number; end: number }>();
  return r.results;
}

/**
 * Programul frizerului s-a schimbat: programările viitoare care încăpeau în programul vechi, dar nu mai încap în cel nou.
 * Cele puse dinadins peste program din panou (care nu încăpeau nici înainte) nu apar.
 */
export async function hoursConflicts(env: Env, barberId: string, before: Hours, after: Hours): Promise<string[]> {
  const r = await env.DB.prepare(`SELECT id, starts_at, ends_at FROM bookings WHERE barber_id = ? AND status IN ${HOLDS_SLOT} AND starts_at > ? ORDER BY starts_at LIMIT 2000`)
    .bind(barberId, iso(new Date()))
    .all<{ id: string; starts_at: string; ends_at: string }>();
  const fits = (hours: Hours, wd: number, s: number, e: number) => hours.some((h) => h.weekday === wd && h.start <= s && h.end >= e);
  const out: string[] = [];
  for (const b of r.results) {
    const start = new Date(b.starts_at);
    const wd = weekdayOf(localDay(env.TIMEZONE, start));
    const s = localMinutes(env.TIMEZONE, start);
    const e = s + Math.round((Date.parse(b.ends_at) - start.getTime()) / 60_000);
    if (fits(before, wd, s, e) && !fits(after, wd, s, e)) out.push(b.id);
    if (out.length >= MAX) break;
  }
  return out;
}
