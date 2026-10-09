import { newId } from './auth';
import { booking, getBusiness, type BookingRow } from './db';
import { HttpError, type Env } from './env';
import { accessFor, availability } from './availability';
import { sendTemplate } from './sendTemplate';
import { addDays, formatLocal, iso, localDay } from './time';
import { refundBooking } from './payments';
import type { TplEvent } from './templates';
import { checkWaitlist, closeOnBooking } from './waitlist';

/** Stările care țin ora ocupată: programările confirmate și cererile încă fără răspuns. */
export const HOLDS_SLOT = `('confirmed','requested')`;

/** Cere aprobare pentru o programare făcută de client la acest frizer? (Setări → Reguli de programare) */
export function needsApproval(biz: { requireApproval?: boolean; approvalBarberIds?: string[] }, barberId: string) {
  if (!biz.requireApproval) return false;
  const only = biz.approvalBarberIds ?? [];
  return !only.length || only.includes(barberId);
}

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
    maxActive?: number; // din aplicație: câte programări viitoare poate avea clientul (verificat odată cu inserarea)
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
    // Pe zile, ca în lista orelor libere și la lista de așteptare: ultima zi permisă se poate rezerva toată.
    if (localDay(env.TIMEZONE, start) > addDays(localDay(env.TIMEZONE, new Date()), maxDays)) throw new HttpError(400, 'too_far_ahead');
    // Orele „doar membri” se verifică din nou aici: un client fără abonament nu le poate lua nici trimițând ora direct.
    const slots = await availability(env, {
      serviceId: input.serviceId,
      barberId: input.barberId,
      day: localDay(env.TIMEZONE, start),
      access: input.source === 'admin' ? 'staff' : await accessFor(env, input.clientId),
    });
    const slot = slots.find((s) => Date.parse(s.start) === start.getTime());
    if (!slot) throw new HttpError(409, 'slot_unavailable');
    barberId = slot.barberId;
  }
  if (!barberId) throw new HttpError(400, 'barber_required');
  // Programările făcute de client (nu cele din panou) pot intra ca cereri, dacă proprietarul a pornit aprobarea.
  const requested = input.source !== 'admin' && needsApproval(await getBusiness(env), barberId);

  // Prețul propriu al frizerului, dacă are unul pentru acest serviciu.
  const own = await env.DB.prepare('SELECT price_bani, duration_min FROM barber_services WHERE barber_id = ? AND service_id = ?')
    .bind(barberId, service.id)
    .first<{ price_bani: number | null; duration_min: number | null }>();
  const price = own?.price_bani ?? service.price_bani;

  const id = newId('bk');
  const end = new Date(start.getTime() + (own?.duration_min ?? service.duration_min) * 60_000);
  const now = iso(new Date());
  // Limita de programări viitoare se verifică în aceeași instrucțiune, ca două rezervări trimise odată să n-o depășească.
  const limit = input.maxActive ? `AND (SELECT count(*) FROM bookings WHERE client_id = ? AND status IN ${HOLDS_SLOT} AND starts_at > ?) < ?` : '';
  const res = await env.DB.prepare(
    `INSERT INTO bookings (id, client_id, barber_id, service_id, starts_at, ends_at, price_bani, source, note, status)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM bookings WHERE barber_id = ? AND status IN ${HOLDS_SLOT} AND starts_at < ? AND ends_at > ?
     ) ${limit}`,
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
      requested ? 'requested' : 'confirmed',
      barberId,
      iso(end),
      iso(start),
      ...(input.maxActive ? [input.clientId, now, input.maxActive] : []),
    )
    .run();
  if (!res.meta.changes) {
    if (input.maxActive) {
      const n = await env.DB.prepare(`SELECT count(*) AS n FROM bookings WHERE client_id = ? AND status IN ${HOLDS_SLOT} AND starts_at > ?`)
        .bind(input.clientId, now)
        .first<{ n: number }>();
      if ((n?.n ?? 0) >= input.maxActive) throw new HttpError(409, 'too_many_active_bookings');
    }
    throw new HttpError(409, 'slot_unavailable');
  }

  const created = (await getBooking(env, id))!;
  // Clientul are acum programare confirmată în ziua aceea: iese de pe lista de așteptare pentru serviciul ăsta.
  // O cerere încă neconfirmată nu-l scoate: dacă e refuzată, expiră sau o retrage, rămâne pe listă (se închide la acceptare).
  if (!requested) await closeOnBooking(env, input.clientId, service.id, iso(start));
  if (input.notify !== false) await notifyBooking(env, created, requested ? 'booking_request' : 'confirm');
  return created;
}

export async function cancelBooking(env: Env, id: string, by: 'client' | 'admin', clientId?: string, adminId?: string) {
  const b = await getBooking(env, id);
  if (!b || (clientId && b.clientId !== clientId)) throw new HttpError(404, 'booking_not_found');
  if (b.status !== 'confirmed' && b.status !== 'requested') throw new HttpError(409, 'not_cancellable');
  // O cerere încă neconfirmată se poate retrage oricând; din panou, anularea unei cereri e un refuz.
  if (b.status === 'requested' && by === 'admin') return refuseRequest(env, id, adminId ?? null, '');
  if (by === 'client' && b.status === 'confirmed') {
    const biz = await getBusiness(env);
    if (Date.parse(b.start) - Date.now() < biz.cancelHours * 3_600_000) throw new HttpError(409, 'too_late_to_cancel');
  }
  const r = await env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancelled_by_admin = ? WHERE id = ? AND status IN ${HOLDS_SLOT}`)
    .bind(iso(new Date()), by === 'client' ? 'client' : 'staff', adminId ?? null, id)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'not_cancellable');
  // Plătită online: banii se întorc singuri pe card.
  try {
    await refundBooking(env, id);
  } catch (e) {
    console.error('refund on cancel', id, e);
  }
  const updated = (await getBooking(env, id))!;
  if (by === 'admin') await notifyBooking(env, updated, 'cancel');
  await freedSlot(env, updated.start);
  return updated;
}

type BookingJson = NonNullable<Awaited<ReturnType<typeof getBooking>>>;

export async function notifyBooking(
  env: Env,
  b: BookingJson,
  kind: Extract<TplEvent, 'confirm' | 'cancel' | 'reminder_24h' | 'reminder_2h' | 'booking_request' | 'booking_request_refused' | 'booking_request_expired'>,
  extra: Record<string, string> = {},
) {
  const c = await env.DB.prepare('SELECT lang FROM clients WHERE id = ?').bind(b.clientId).first<{ lang: string }>();
  if (!c) return null;
  return sendTemplate(
    env,
    kind,
    b.clientId,
    { servicename: b.serviceName ?? '', barbername: b.barberName ?? '', datetime: formatLocal(env.TIMEZONE, b.start, c.lang), ...extra },
    { bookingId: b.id, data: { bookingId: b.id } },
  );
}

// --- Cereri de programare (când programările din aplicație cer aprobare) ---

/** Cererile încă fără răspuns, cele mai apropiate primele (doar ale frizerului, dacă e dat). */
export async function pendingRequests(env: Env, barberId: string | null) {
  const r = await env.DB.prepare(
    `${BOOKING_SELECT} WHERE b.status = 'requested' AND b.starts_at > ? ${barberId ? 'AND b.barber_id = ?' : ''} ORDER BY b.starts_at LIMIT 200`,
  )
    .bind(...(barberId ? [iso(new Date()), barberId] : [iso(new Date())]))
    .all<BookingRow>();
  return r.results.map(booking);
}

/** Acceptă o cerere: devine programare confirmată și clientul primește confirmarea obișnuită. */
export async function acceptRequest(env: Env, id: string, adminId: string | null) {
  const now = iso(new Date());
  const r = await env.DB.prepare(
    `UPDATE bookings SET status = 'confirmed', request_outcome = 'accepted', request_answered_at = ?, request_answered_by = ?
     WHERE id = ? AND status = 'requested' AND starts_at > ?`,
  )
    .bind(now, adminId, id, now)
    .run();
  if (!r.meta.changes) throw new HttpError(409, await whyNotPending(env, id));
  const b = (await getBooking(env, id))!;
  await closeOnBooking(env, b.clientId, b.serviceId, b.start);
  await notifyBooking(env, b, 'confirm');
  return b;
}

/** Refuză o cerere: se anulează (ora se eliberează) și clientul primește motivul. */
export async function refuseRequest(env: Env, id: string, adminId: string | null, reason: string) {
  const now = iso(new Date());
  let why = String(reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  // Motivul intră în mijlocul mesajului: îl încheiem cu punct, ca propoziția următoare să se lege.
  if (why && !/[.!?]$/.test(why)) why += '.';
  const r = await env.DB.prepare(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'staff', cancelled_by_admin = ?,
       request_outcome = 'refused', request_answered_at = ?, request_answered_by = ?, refuse_reason = ?
     WHERE id = ? AND status = 'requested'`,
  )
    .bind(now, adminId, now, adminId, why || null, id)
    .run();
  if (!r.meta.changes) throw new HttpError(409, await whyNotPending(env, id));
  const b = (await getBooking(env, id))!;
  await notifyBooking(env, b, 'booking_request_refused', { reason: why });
  await freedSlot(env, b.start);
  return b;
}

/** S-a eliberat o oră: anunțăm pe loc lista de așteptare a zilei (cron-ul o verifică oricum la 5 minute). */
export async function freedSlot(env: Env, start: string) {
  try {
    await checkWaitlist(env, { day: localDay(env.TIMEZONE, new Date(start)) });
  } catch (e) {
    console.error('waitlist check', e);
  }
}

async function whyNotPending(env: Env, id: string) {
  const b = await env.DB.prepare('SELECT status, starts_at FROM bookings WHERE id = ?').bind(id).first<{ status: string; starts_at: string }>();
  if (!b) return 'booking_not_found';
  if (b.status === 'requested') return 'request_expired';
  return 'request_already_answered';
}

/**
 * Cererile la care nu a răspuns nimeni până la ora programării se anulează singure (din cron).
 * Fiecare se marchează înainte de mesaj, ca o rulare suprapusă să nu-l trimită de două ori.
 */
export async function expireRequests(env: Env, now = new Date()) {
  const due = await env.DB.prepare(`${BOOKING_SELECT} WHERE b.status = 'requested' AND b.starts_at <= ? LIMIT 200`)
    .bind(iso(now))
    .all<BookingRow>();
  let n = 0;
  for (const row of due.results) {
    const r = await env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, request_outcome = 'expired', request_answered_at = ? WHERE id = ? AND status = 'requested'`,
    )
      .bind(iso(now), iso(now), row.id)
      .run();
    if (!r.meta.changes) continue;
    n++;
    try {
      await notifyBooking(env, { ...booking(row), status: 'cancelled' }, 'booking_request_expired');
    } catch (e) {
      console.error('request expired notify', row.id, e);
    }
  }
  return n;
}
