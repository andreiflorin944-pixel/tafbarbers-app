import { newId } from './auth';
import { booking, getBusiness, type BookingRow } from './db';
import { HttpError, type Env } from './env';
import { availability } from './availability';
import { emailHtml } from './campaigns';
import { channelsFor } from './growth';
import { sendEmail, sendPush, sendSms } from './notify';
import { formatLocal, iso, localDay } from './time';
import { msg } from './messages';

export const BOOKING_SELECT = `
  SELECT b.*, c.name AS client_name, c.phone AS client_phone, c.birth_date AS client_birth_date, s.name AS service_name, br.name AS barber_name
  FROM bookings b
  JOIN clients c ON c.id = b.client_id
  JOIN services s ON s.id = b.service_id
  JOIN barbers br ON br.id = b.barber_id`;

export async function getBooking(env: Env, id: string) {
  const r = await env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<BookingRow>();
  return r ? booking(r) : null;
}

/**
 * Creează o programare. Ora trebuie să fie una dintre orele libere calculate; inserarea
 * verifică încă o dată suprapunerea în aceeași instrucțiune, ca două rezervări simultane
 * pe aceeași oră să nu treacă amândouă.
 */
export async function createBooking(
  env: Env,
  input: {
    clientId: string;
    serviceId: string;
    barberId: string | null;
    start: string;
    note?: string;
    source: 'app' | 'admin' | 'web';
    skipAvailabilityCheck?: boolean; // adminul poate pune peste program (ex. după ore)
    notify?: boolean;
  },
) {
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new HttpError(400, 'invalid_start');
  const service = await env.DB.prepare('SELECT id, duration_min, price_bani FROM services WHERE id = ?')
    .bind(input.serviceId)
    .first<{ id: string; duration_min: number; price_bani: number }>();
  if (!service) throw new HttpError(404, 'service_not_found');

  let barberId = input.barberId;
  if (!input.skipAvailabilityCheck) {
    const biz = await getBusiness(env);
    const maxDays = biz.maxDaysAhead ?? 30;
    if (start.getTime() > Date.now() + maxDays * 86_400_000) throw new HttpError(400, 'too_far_ahead');
    const slots = await availability(env, {
      serviceId: input.serviceId,
      barberId: input.barberId,
      day: localDay(env.TIMEZONE, start),
    });
    const slot = slots.find((s) => Date.parse(s.start) === start.getTime());
    if (!slot) throw new HttpError(409, 'slot_unavailable');
    barberId = slot.barberId;
  }
  if (!barberId) throw new HttpError(400, 'barber_required');

  // Prețul propriu al frizerului, dacă are unul pentru acest serviciu.
  const own = await env.DB.prepare('SELECT price_bani, duration_min FROM barber_services WHERE barber_id = ? AND service_id = ?')
    .bind(barberId, service.id)
    .first<{ price_bani: number | null; duration_min: number | null }>();
  const price = own?.price_bani ?? service.price_bani;

  const id = newId('bk');
  const end = new Date(start.getTime() + (own?.duration_min ?? service.duration_min) * 60_000);
  const res = await env.DB.prepare(
    `INSERT INTO bookings (id, client_id, barber_id, service_id, starts_at, ends_at, price_bani, source, note)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM bookings WHERE barber_id = ? AND status = 'confirmed' AND starts_at < ? AND ends_at > ?
     )`,
  )
    .bind(
      id,
      input.clientId,
      barberId,
      service.id,
      iso(start),
      iso(end),
      price,
      input.source,
      (input.note ?? '').slice(0, 500),
      barberId,
      iso(end),
      iso(start),
    )
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'slot_unavailable');

  const created = (await getBooking(env, id))!;
  if (input.notify !== false) await notifyBooking(env, created, 'confirm');
  return created;
}

export async function cancelBooking(env: Env, id: string, by: 'client' | 'admin', clientId?: string, adminId?: string) {
  const b = await getBooking(env, id);
  if (!b || (clientId && b.clientId !== clientId)) throw new HttpError(404, 'booking_not_found');
  if (b.status !== 'confirmed') throw new HttpError(409, 'not_cancellable');
  if (by === 'client') {
    const biz = await getBusiness(env);
    if (Date.parse(b.start) - Date.now() < biz.cancelHours * 3_600_000) throw new HttpError(409, 'too_late_to_cancel');
  }
  await env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancelled_by_admin = ? WHERE id = ?`)
    .bind(iso(new Date()), by === 'client' ? 'client' : 'staff', adminId ?? null, id)
    .run();
  const updated = (await getBooking(env, id))!;
  if (by === 'admin') await notifyBooking(env, updated, 'cancel');
  return updated;
}

type BookingJson = NonNullable<Awaited<ReturnType<typeof getBooking>>>;

export async function notifyBooking(
  env: Env,
  b: BookingJson,
  kind: 'confirm' | 'cancel' | 'reminder_24h' | 'reminder_2h',
) {
  const ch = await channelsFor(env, kind);
  if (!ch) return;
  const c = await env.DB.prepare('SELECT phone, email, lang FROM clients WHERE id = ?')
    .bind(b.clientId)
    .first<{ phone: string; email: string | null; lang: string }>();
  if (!c || c.phone.startsWith('deleted:')) return;
  const biz = await getBusiness(env);
  const when = formatLocal(env.TIMEZONE, b.start, c.lang);
  const text = msg(c.lang, kind, { when, shop: biz.name, barber: b.barberName ?? '', service: b.serviceName ?? '' });
  if (ch.sms) await sendSms(env, { kind, recipient: c.phone, bookingId: b.id }, text);
  const title = PUSH_TITLES[kind];
  if (ch.push) {
    const tokens = await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(b.clientId).all<{ token: string }>();
    if (tokens.results.length)
      await sendPush(env, { kind, bookingId: b.id }, tokens.results.map((t) => t.token), title, `${b.serviceName} cu ${b.barberName}, ${formatLocal(env.TIMEZONE, b.start)}`, {
        bookingId: b.id,
      });
  }
  if (ch.email && c.email) await sendEmail(env, { kind, recipient: c.email, bookingId: b.id }, `${title} · ${biz.name}`, emailHtml(biz.name, title, text));
}

const PUSH_TITLES = { confirm: 'Programare confirmată', cancel: 'Programare anulată', reminder_24h: 'Programare mâine', reminder_2h: 'Programare în curând' };
