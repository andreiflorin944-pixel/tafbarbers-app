import type { Env } from './env';
import { HttpError } from './env';
import { getBusiness } from './db';
import { iso, localToUtc, weekdayOf } from './time';
import { blocksForDay, blocksTime } from './blocks';
import { isClubMember } from './subscriptions';

/** `membersOnly`: ora cade în intervalul „Doar membri TAF Club” (o văd doar membrii și echipa). */
export type Slot = { start: string; end: string; barberId: string; membersOnly?: boolean };

/**
 * Cine cere orele: `public` (fără cont sau client fără abonament) nu vede orele „doar membri”,
 * `member` le vede marcate, `staff` (panoul) le vede pe toate, marcate.
 */
export type Access = 'public' | 'member' | 'staff';
export const accessFor = async (env: Env, clientId: string | null | undefined): Promise<Access> =>
  (await isClubMember(env, clientId)) ? 'member' : 'public';

type Interval = { s: number; e: number }; // ms UTC

function overlaps(a: Interval, b: Interval) {
  return a.s < b.e && b.s < a.e;
}

/**
 * Frizerii activi care fac serviciul (opțional doar unul anume, sau doar cei dintr-o locație).
 * Frizerii dintr-o locație dezactivată nu mai primesc programări.
 */
export async function eligibleBarbers(env: Env, serviceId: string, barberId: string | null, locationId: string | null = null): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT b.id FROM barbers b JOIN barber_services bs ON bs.barber_id = b.id LEFT JOIN locations l ON l.id = b.location_id
     WHERE b.active = 1 AND bs.service_id = ? AND (b.location_id IS NULL OR l.active = 1)
     ${barberId ? 'AND b.id = ?' : ''} ${locationId ? 'AND b.location_id = ?' : ''} ORDER BY b.sort`,
  )
    .bind(serviceId, ...(barberId ? [barberId] : []), ...(locationId ? [locationId] : []))
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/**
 * Orele libere dintr-o zi locală. Pentru „orice frizer”, fiecare oră apare o singură dată,
 * atribuită primului frizer liber (în ordinea din panou). Cu `locationId`, „orice frizer” înseamnă orice frizer din acea locație.
 */
export async function availability(
  env: Env,
  opts: { serviceId: string; barberId: string | null; locationId?: string | null; day: string; excludeBookingId?: string; access?: Access },
): Promise<Slot[]> {
  const access = opts.access ?? 'public';
  const biz = await getBusiness(env);
  const tz = env.TIMEZONE;
  const service = await env.DB.prepare('SELECT duration_min FROM services WHERE id = ? AND active = 1')
    .bind(opts.serviceId)
    .first<{ duration_min: number }>();
  if (!service) throw new HttpError(404, 'service_not_found');

  const barbers = await eligibleBarbers(env, opts.serviceId, opts.barberId, opts.locationId ?? null);
  if (!barbers.length) return [];

  const dayStart = localToUtc(tz, opts.day, 0);
  const dayEnd = localToUtc(tz, opts.day, 24 * 60);
  const wd = weekdayOf(opts.day);
  const step = (biz.slotStepMin ?? 15) * 60_000;
  const earliest = Date.now() + (biz.minLeadMin ?? 0) * 60_000;

  const ph = barbers.map(() => '?').join(',');
  const [own, hours, busy, off, blocks] = await Promise.all([
    env.DB.prepare(`SELECT barber_id, duration_min FROM barber_services WHERE service_id = ? AND duration_min IS NOT NULL AND barber_id IN (${ph})`)
      .bind(opts.serviceId, ...barbers)
      .all<{ barber_id: string; duration_min: number }>(),
    env.DB.prepare(`SELECT barber_id, start_min, end_min FROM working_hours WHERE weekday = ? AND barber_id IN (${ph})`)
      .bind(wd, ...barbers)
      .all<{ barber_id: string; start_min: number; end_min: number }>(),
    env.DB.prepare(
      `SELECT id, barber_id, starts_at, ends_at FROM bookings
       WHERE status IN ('confirmed','requested') AND barber_id IN (${ph}) AND starts_at < ? AND ends_at > ?`,
    )
      .bind(...barbers, iso(dayEnd), iso(dayStart))
      .all<{ id: string; barber_id: string; starts_at: string; ends_at: string }>(),
    env.DB.prepare(
      `SELECT barber_id, starts_at, ends_at FROM time_off
       WHERE (barber_id IS NULL OR barber_id IN (${ph})) AND starts_at < ? AND ends_at > ?`,
    )
      .bind(...barbers, iso(dayEnd), iso(dayStart))
      .all<{ barber_id: string | null; starts_at: string; ends_at: string }>(),
    blocksForDay(env, opts.day, barbers),
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
  // Blocurile din program: pauza, liberul, cursul etc. scot orele; „doar membri” le lasă doar pentru membri.
  const members = new Map<string, Interval[]>(barbers.map((b) => [b, []]));
  for (const k of blocks) {
    const iv = { s: k.s, e: k.e };
    for (const b of k.barberId ? [k.barberId] : barbers) (blocksTime(k.kind) ? blocked : members).get(b)?.push(iv);
  }

  const byStart = new Map<number, Slot>();
  for (const barber of barbers) {
    // Fiecare frizer cu durata lui pentru serviciu, dacă are una; altfel durata standard.
    const durMs = (own.results.find((o) => o.barber_id === barber)?.duration_min ?? service.duration_min) * 60_000;
    for (const h of hours.results.filter((x) => x.barber_id === barber)) {
      const winS = localToUtc(tz, opts.day, h.start_min).getTime();
      const winE = localToUtc(tz, opts.day, h.end_min).getTime();
      for (let s = winS; s + durMs <= winE; s += step) {
        const prev = byStart.get(s);
        // Ora e deja luată de un frizer liber pentru toți; una „doar membri” se poate înlocui cu una obișnuită.
        if (s < earliest || (prev && !prev.membersOnly)) continue;
        const slot = { s, e: s + durMs };
        if (blocked.get(barber)!.some((iv) => overlaps(iv, slot))) continue;
        const membersOnly = members.get(barber)!.some((iv) => overlaps(iv, slot));
        if (membersOnly && (access === 'public' || prev)) continue;
        byStart.set(s, { start: iso(new Date(s)), end: iso(new Date(s + durMs)), barberId: barber, ...(membersOnly && { membersOnly: true }) });
      }
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
