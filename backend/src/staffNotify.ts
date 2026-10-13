import type { getBooking } from './bookings';
import type { Env } from './env';
import { sendPush } from './notify';
import { formatLocal, localDay } from './time';

// Anunțurile pe telefon pentru echipă (aplicația echipei): programare nouă, cerere nouă, anulare, mutare.
// Le primesc frizerul programării, proprietarul și administratorul locației, fiecare dacă nu le-a oprit.
// Cine a făcut el însuși schimbarea nu primește anunțul.

type Booking = NonNullable<Awaited<ReturnType<typeof getBooking>>>;
export type StaffEvent = 'new' | 'request' | 'cancelled' | 'moved';

const TITLES: Record<StaffEvent, string> = {
  new: 'Programare nouă',
  request: 'Cerere nouă de programare',
  cancelled: 'Programare anulată',
  moved: 'Programare mutată',
};

/** Nu aruncă niciodată: programarea s-a făcut deja, anunțul e doar în plus. */
export async function notifyStaff(
  env: Env,
  b: Booking,
  ev: StaffEvent,
  actorAdminId: string | null,
  opts: { fromStart?: string; fromBarberId?: string } = {},
): Promise<void> {
  try {
    const barbers = [b.barberId, opts.fromBarberId ?? b.barberId];
    const rows = await env.DB.prepare(
      `SELECT p.token FROM staff_push_tokens p JOIN admins a ON a.id = p.admin_id
       WHERE a.notify_bookings = 1 AND a.id != ?
         AND (a.barber_id IN (?, ?) OR a.role = 'org_admin' OR (a.role = 'location_admin' AND (a.location_id IS NULL OR a.location_id = ?)))`,
    )
      .bind(actorAdminId ?? '', barbers[0], barbers[1], b.locationId ?? '')
      .all<{ token: string }>();
    const tokens = [...new Set(rows.results.map((r) => r.token))];
    if (!tokens.length) return;
    const tz = env.TIMEZONE || 'Europe/Bucharest';
    const when = formatLocal(tz, b.start, 'ro');
    const parts = [b.clientName?.trim() || 'Client', b.serviceName ?? '', `cu ${b.barberName ?? ''}`.trim(), when];
    if (ev === 'moved' && opts.fromStart && opts.fromStart !== b.start) parts.push(`(era ${formatLocal(tz, opts.fromStart, 'ro')})`);
    const body = parts.filter((p) => p && p !== 'cu').join(' · ');
    // Fără bookingId în jurnal: istoricul programării arată doar mesajele către client.
    await sendPush(env, { kind: `staff_${ev}` }, tokens, TITLES[ev], body, {
      staff: '1',
      bookingId: b.id,
      day: localDay(tz, new Date(b.start)),
    });
  } catch (e) {
    console.error('notifyStaff', ev, b.id, e);
  }
}
