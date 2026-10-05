import type { Env } from './env';
import { HttpError } from './env';
import { getBusiness } from './db';
import { iso, localToUtc, weekdayOf } from './time';

export type Slot = { start: string; end: string; barberId: string };

type Interval = { s: number; e: number }; // ms UTC

function overlaps(a: Interval, b: Interval) {
  return a.s < b.e && b.s < a.e;
}

/** Frizerii activi care fac serviciul (opțional doar unul anume). */
export async function eligibleBarbers(env: Env, serviceId: string, barberId: string | null): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT b.id FROM barbers b JOIN barber_services bs ON bs.barber_id = b.id
     WHERE b.active = 1 AND bs.service_id = ? ${barberId ? 'AND b.id = ?' : ''} ORDER BY b.sort`,
  )
    .bind(...(barberId ? [serviceId, barberId] : [serviceId]))
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/**
 * Orele libere dintr-o zi locală. Pentru „orice frizer”, fiecare oră apare o singură dată,
 * atribuită primului frizer liber (în ordinea din panou).
 */
export async function availability(
  env: Env,
  opts: { serviceId: string; barberId: string | null; day: string; excludeBookingId?: string },
): Promise<Slot[]> {
  const biz = await getBusiness(env);
  const tz = env.TIMEZONE;
  const service = await env.DB.prepare('SELECT duration_min FROM services WHERE id = ? AND active = 1')
    .bind(opts.serviceId)
    .first<{ duration_min: number }>();
  if (!service) throw new HttpError(404, 'service_not_found');

  const barbers = await eligibleBarbers(env, opts.serviceId, opts.barberId);
  if (!barbers.length) return [];

  const dayStart = localToUtc(tz, opts.day, 0);
  const dayEnd = localToUtc(tz, opts.day, 24 * 60);
  const wd = weekdayOf(opts.day);
  const durMs = service.duration_min * 60_000;
  const step = (biz.slotStepMin ?? 15) * 60_000;
  const earliest = Date.now() + (biz.minLeadMin ?? 0) * 60_000;

  const ph = barbers.map(() => '?').join(',');
  const [hours, busy, off] = await Promise.all([
    env.DB.prepare(`SELECT barber_id, start_min, end_min FROM working_hours WHERE weekday = ? AND barber_id IN (${ph})`)
      .bind(wd, ...barbers)
      .all<{ barber_id: string; start_min: number; end_min: number }>(),
    env.DB.prepare(
      `SELECT id, barber_id, starts_at, ends_at FROM bookings
       WHERE status = 'confirmed' AND barber_id IN (${ph}) AND starts_at < ? AND ends_at > ?`,
    )
      .bind(...barbers, iso(dayEnd), iso(dayStart))
      .all<{ id: string; barber_id: string; starts_at: string; ends_at: string }>(),
    env.DB.prepare(
      `SELECT barber_id, starts_at, ends_at FROM time_off
       WHERE (barber_id IS NULL OR barber_id IN (${ph})) AND starts_at < ? AND ends_at > ?`,
    )
      .bind(...barbers, iso(dayEnd), iso(dayStart))
      .all<{ barber_id: string | null; starts_at: string; ends_at: string }>(),
  ]);

  const blocked = new Map<string, Interval[]>(barbers.map((b) => [b, []]));
  for (const b of busy.results) {
    if (b.id === opts.excludeBookingId) continue;
    blocked.get(b.barber_id)!.push({ s: Date.parse(b.starts_at), e: Date.parse(b.ends_at) });
  }
  for (const t of off.results) {
    const iv = { s: Date.parse(t.starts_at), e: Date.parse(t.ends_at) };
    for (const b of t.barber_id ? [t.barber_id] : barbers) blocked.get(b)?.push(iv);
  }

  const byStart = new Map<number, Slot>();
  for (const barber of barbers) {
    for (const h of hours.results.filter((x) => x.barber_id === barber)) {
      const winS = localToUtc(tz, opts.day, h.start_min).getTime();
      const winE = localToUtc(tz, opts.day, h.end_min).getTime();
      for (let s = winS; s + durMs <= winE; s += step) {
        if (s < earliest || byStart.has(s)) continue;
        const slot = { s, e: s + durMs };
        if (blocked.get(barber)!.some((iv) => overlaps(iv, slot))) continue;
        byStart.set(s, { start: iso(new Date(s)), end: iso(new Date(s + durMs)), barberId: barber });
      }
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
