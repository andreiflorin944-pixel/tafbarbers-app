import { blocksForDay, blocksTime, BLOCK_LABELS, type BlockKind } from './blocks';
import { extraQuotes } from './bookingExtras';
import { createBooking, getBooking, HOLDS_SLOT, logBookingEvent } from './bookings';
import { HttpError, type Env } from './env';
import { refundBooking } from './payments';
import { barberHours } from './scheduleConflicts';
import { addDays, iso, localDay, localMinutes, localToUtc, weekdayOf } from './time';

// Programări repetate: o programare existentă se repetă în fiecare săptămână (sau la 2, 3, 4 săptămâni), în aceeași zi,
// la aceeași oră, la același frizer, cu aceleași servicii. Prețul și durata se iau ca la o programare nouă (ale frizerului, dacă are).
// Datele care nu se pot (ocupat, liber, concediu, în afara programului) se sar și se spun în panou.
// Nu pleacă niciun mesaj (nici la client, nici la echipă). Calendarul invers (Barberly) le ia singur, ca pe orice programare.

/** Cel mult atâtea repetări odată (un an, săptămânal). */
export const MAX_REPEATS = 52;
/** Cel mult atât de departe (zile de la programarea de pornire). */
const MAX_SPAN_DAYS = 366;

export type SkipReason = 'past' | 'busy' | 'time_off' | 'block' | 'closed';
export type RepeatItem = { start: string; end: string; ok: boolean; reason?: SkipReason; detail?: string; id?: string };

type Opts = { everyWeeks?: unknown; count?: unknown; until?: unknown; dryRun?: boolean };

function plan(env: Env, start: string, o: Opts) {
  const weeks = Number(o.everyWeeks);
  if (![1, 2, 3, 4].includes(weeks)) throw new HttpError(400, 'invalid_interval');
  const tz = env.TIMEZONE;
  const s = new Date(start);
  const day0 = localDay(tz, s);
  const minutes = localMinutes(tz, s);
  let days: string[] = [];
  if (o.until !== undefined && o.until !== null && o.until !== '') {
    const until = String(o.until);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= day0) throw new HttpError(400, 'invalid_until');
    const last = until < addDays(day0, MAX_SPAN_DAYS) ? until : addDays(day0, MAX_SPAN_DAYS);
    for (let k = 1; k <= MAX_REPEATS; k++) {
      const d = addDays(day0, 7 * weeks * k);
      if (d > last) break;
      days.push(d);
    }
  } else {
    const n = Math.floor(Number(o.count));
    if (!Number.isFinite(n) || n < 1 || n > MAX_REPEATS) throw new HttpError(400, 'invalid_count');
    days = Array.from({ length: n }, (_, i) => addDays(day0, 7 * weeks * (i + 1))).filter((d) => d <= addDays(day0, MAX_SPAN_DAYS));
  }
  if (!days.length) throw new HttpError(400, 'invalid_until');
  return { weeks, minutes, days };
}

/**
 * Repetă programarea `sourceId`. Cu `dryRun` doar arată ce date ies și ce date se sar (fără să scrie nimic);
 * fără, face programările pe datele libere și le leagă de programarea de pornire (aceeași serie).
 */
export async function repeatBooking(env: Env, sourceId: string, o: Opts, adminId: string | null) {
  const src = await getBooking(env, sourceId);
  if (!src) throw new HttpError(404, 'not_found');
  if (src.status !== 'confirmed' && src.status !== 'completed') throw new HttpError(409, 'not_repeatable');
  const { weeks, minutes, days } = plan(env, src.start, o);
  const tz = env.TIMEZONE;

  // Durata, ca la o programare nouă: a frizerului pentru serviciu (dacă are), plus serviciile adăugate (cele cu timp).
  const extraIds = (src.extras ?? []).map((e) => e.serviceId);
  const svc = await env.DB.prepare('SELECT duration_min FROM services WHERE id = ?').bind(src.serviceId).first<{ duration_min: number }>();
  if (!svc) throw new HttpError(404, 'service_not_found');
  const own = await env.DB.prepare('SELECT duration_min FROM barber_services WHERE barber_id = ? AND service_id = ?')
    .bind(src.barberId, src.serviceId)
    .first<{ duration_min: number | null }>();
  const extras = await extraQuotes(env, src.barberId, extraIds);
  const durMin = (own?.duration_min ?? svc.duration_min) + extras.reduce((a, x) => a + x.durationMin, 0);

  // Programul frizerului: dacă programarea de pornire a fost pusă dinadins peste program, nu se mai cere încadrarea în program.
  const hours = await barberHours(env, src.barberId);
  const fits = (day: string, sMin: number, eMin: number) => hours.some((h) => h.weekday === weekdayOf(day) && h.start <= sMin && h.end >= eMin);
  const srcDur = Math.round((Date.parse(src.end) - Date.parse(src.start)) / 60_000);
  const checkHours = fits(localDay(tz, new Date(src.start)), minutes, minutes + srcDur);

  const now = Date.now();
  const items: RepeatItem[] = [];
  for (const day of days) {
    const s = localToUtc(tz, day, minutes);
    const e = new Date(s.getTime() + durMin * 60_000);
    const it: RepeatItem = { start: iso(s), end: iso(e), ok: false };
    items.push(it);
    if (s.getTime() <= now) {
      it.reason = 'past';
      continue;
    }
    // Ora locală iese alta (ziua schimbării orei, ora care nu există): se sare.
    if (localMinutes(tz, s) !== minutes || localDay(tz, s) !== day) {
      it.reason = 'closed';
      continue;
    }
    if (checkHours && !fits(day, minutes, minutes + durMin)) {
      it.reason = 'closed';
      continue;
    }
    const off = await env.DB.prepare('SELECT reason FROM time_off WHERE (barber_id IS NULL OR barber_id = ?) AND starts_at < ? AND ends_at > ? LIMIT 1')
      .bind(src.barberId, it.end, it.start)
      .first<{ reason: string }>();
    if (off) {
      it.reason = 'time_off';
      if (off.reason) it.detail = String(off.reason).slice(0, 80);
      continue;
    }
    const blk = (await blocksForDay(env, day, [src.barberId])).find((k) => blocksTime(k.kind) && k.s < e.getTime() && k.e > s.getTime());
    if (blk) {
      it.reason = 'block';
      it.detail = BLOCK_LABELS[blk.kind as BlockKind] ?? '';
      continue;
    }
    const busy = await env.DB.prepare(
      `SELECT c.name FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE b.barber_id = ? AND b.status IN ${HOLDS_SLOT} AND b.starts_at < ? AND b.ends_at > ? LIMIT 1`,
    )
      .bind(src.barberId, it.end, it.start)
      .first<{ name: string | null }>();
    if (busy) {
      it.reason = 'busy';
      it.detail = busy.name || '';
      continue;
    }
    it.ok = true;
  }

  if (o.dryRun) return { dryRun: true, weeks, items, created: 0, skipped: items.filter((x) => !x.ok).length };

  const seriesId = src.seriesId ?? src.id;
  if (!src.seriesId) await env.DB.prepare('UPDATE bookings SET series_id = ? WHERE id = ?').bind(seriesId, src.id).run();
  for (const it of items) {
    if (!it.ok) continue;
    try {
      const b = await createBooking(env, {
        clientId: src.clientId,
        serviceId: src.serviceId,
        extraServiceIds: extraIds,
        barberId: src.barberId,
        start: it.start,
        note: src.note,
        source: 'admin',
        // Verificat mai sus (program, liber, concediu, ocupat); inserarea verifică încă o dată suprapunerea.
        skipAvailabilityCheck: true,
        notify: false,
        quiet: true,
        adminId,
        seriesId,
        ...(src.walkIn && { walkinName: src.clientName ?? '' }),
      });
      it.id = b.id;
      it.end = b.end;
    } catch (e) {
      it.ok = false;
      it.reason = 'busy';
      if (!(e instanceof HttpError)) console.error('repeat booking', sourceId, it.start, e);
    }
  }
  const created = items.filter((x) => x.ok).length;
  if (created) await logBookingEvent(env, src.id, 'repeated', { weeks, created }, adminId);
  return { dryRun: false, weeks, items, created, skipped: items.length - created };
}

/**
 * „Anulează și repetările următoare”: programarea dată și toate cele de după ea din aceeași serie (doar cele încă confirmate, din viitor).
 * Fără mesaje la client; Barberly le anulează singur prin calendarul invers. Plătite online: banii se întorc, ca la o anulare obișnuită.
 */
export async function cancelSeriesFrom(env: Env, bookingId: string, adminId: string | null, scope: { barberId?: string | null; locationId?: string | null } = {}) {
  const b = await getBooking(env, bookingId);
  if (!b || !b.seriesId) throw new HttpError(404, 'not_found');
  const now = iso(new Date());
  const from = b.start > now ? b.start : now;
  const rows = await env.DB.prepare(
    `SELECT id FROM bookings WHERE series_id = ? AND status = 'confirmed' AND starts_at >= ?
       ${scope.barberId ? 'AND barber_id = ?' : ''} ${scope.locationId ? 'AND location_id = ?' : ''} ORDER BY starts_at LIMIT 200`,
  )
    .bind(b.seriesId, from, ...(scope.barberId ? [scope.barberId] : []), ...(scope.locationId ? [scope.locationId] : []))
    .all<{ id: string }>();
  let n = 0;
  for (const r of rows.results) {
    const u = await env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'staff', cancelled_by_admin = ? WHERE id = ? AND status = 'confirmed'`)
      .bind(now, adminId, r.id)
      .run();
    if (!u.meta.changes) continue;
    n++;
    try {
      await refundBooking(env, r.id);
    } catch (e) {
      console.error('refund on series cancel', r.id, e);
    }
  }
  return { cancelled: n };
}
