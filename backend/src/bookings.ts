import { newId } from './auth';
import { booking, getBusiness, type BookingRow } from './db';
import { HttpError, onlinePaymentsOn, type Env } from './env';
import { accessFor, availability } from './availability';
import { sendTemplate } from './sendTemplate';
import { addDays, formatLocal, iso, localDay } from './time';
import { MIN_BANI, refundBooking } from './payments';
import type { TplEvent } from './templates';
import { checkWaitlist, closeOnBooking } from './waitlist';
import { locationVars } from './locations';
import { discounted, serviceOffers } from './offers';
import { notifyStaff } from './staffNotify';
import { recordServerError } from './serverErrors';

/** Stările care țin ora ocupată: programările confirmate și cererile încă fără răspuns. */
export const HOLDS_SLOT = `('confirmed','requested')`;

/** Cere aprobare pentru o programare făcută de client la acest frizer? (Setări → Reguli de programare) */
export function needsApproval(biz: { requireApproval?: boolean; approvalBarberIds?: string[] }, barberId: string) {
  if (!biz.requireApproval) return false;
  const only = biz.approvalBarberIds ?? [];
  return !only.length || only.includes(barberId);
}

export const BOOKING_SELECT = `
  SELECT b.*, c.name AS client_name, c.phone AS client_phone, c.birth_date AS client_birth_date, s.name AS service_name, br.name AS barber_name, loc.name AS location_name
  FROM bookings b
  JOIN clients c ON c.id = b.client_id
  JOIN services s ON s.id = b.service_id
  JOIN barbers br ON br.id = b.barber_id
  LEFT JOIN locations loc ON loc.id = b.location_id`;

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
    /** „Orice frizer” dintr-o locație anume (aplicația trimite locația aleasă la primul pas). */
    locationId?: string | null;
    start: string;
    note?: string;
    source: 'app' | 'admin' | 'web';
    skipAvailabilityCheck?: boolean; // adminul poate pune peste program (ex. după ore)
    notify?: boolean;
    maxActive?: number; // din aplicație: câte programări viitoare poate avea clientul (verificat odată cu inserarea)
    adminId?: string | null; // cine a făcut-o din panou (nu primește el anunțul pentru echipă)
    /** Anunțurile (e-mail, SMS, push) pleacă după răspuns, ca butonul „Confirmă” să nu aștepte după ele. */
    defer?: (p: Promise<unknown>) => void;
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
      locationId: input.locationId ?? null,
      day: localDay(env.TIMEZONE, start),
      access: input.source === 'admin' ? 'staff' : await accessFor(env, input.clientId),
      anyTime: input.source === 'admin',
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
  // Reducerea din bannerul activ acum (ex. -15%), pe prețul frizerului sau pe cel standard.
  const offer = (await serviceOffers(env)).get(service.id);
  const price = offer ? discounted(own?.price_bani ?? service.price_bani, offer.percent) : (own?.price_bani ?? service.price_bani);

  const id = newId('bk');
  const end = new Date(start.getTime() + (own?.duration_min ?? service.duration_min) * 60_000);
  const now = iso(new Date());
  // Limita de programări viitoare se verifică în aceeași instrucțiune, ca două rezervări trimise odată să n-o depășească.
  const limit = input.maxActive ? `AND (SELECT count(*) FROM bookings WHERE client_id = ? AND status IN ${HOLDS_SLOT} AND starts_at > ?) < ?` : '';
  const res = await env.DB.prepare(
    `INSERT INTO bookings (id, client_id, barber_id, service_id, starts_at, ends_at, price_bani, source, note, status, location_id)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT location_id FROM barbers WHERE id = ?)
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
  const notify = async () => {
    if (input.notify !== false) await notifyBooking(env, created, requested ? 'booking_request' : 'confirm');
    await notifyStaff(env, created, requested ? 'request' : 'new', input.adminId ?? null);
  };
  if (input.defer) input.defer(notify().catch((e) => recordServerError(env, 'booking_notify', e)));
  else await notify();
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
  await notifyStaff(env, updated, 'cancelled', by === 'admin' ? (adminId ?? null) : null);
  await freedSlot(env, updated.start);
  return updated;
}

type BookingJson = NonNullable<Awaited<ReturnType<typeof getBooking>>>;

export async function notifyBooking(
  env: Env,
  b: BookingJson,
  kind: Extract<TplEvent, 'confirm' | 'cancel' | 'booking_moved' | 'reminder_24h' | 'reminder_2h' | 'booking_request' | 'booking_request_refused' | 'booking_request_expired' | 'pay_request'>,
  extra: Record<string, string> = {},
) {
  const c = await env.DB.prepare('SELECT lang FROM clients WHERE id = ?').bind(b.clientId).first<{ lang: string }>();
  if (!c) return null;
  return sendTemplate(
    env,
    kind,
    b.clientId,
    {
      servicename: b.serviceName ?? '',
      barbername: b.barberName ?? '',
      datetime: formatLocal(env.TIMEZONE, b.start, c.lang),
      ...(await locationVars(env, b.locationId, c.lang)),
      ...extra,
    },
    { bookingId: b.id, data: { bookingId: b.id } },
  );
}

// --- Modificarea programării (panoul și aplicația echipei) ---

/** Jurnalul programării: o linie pentru fiecare schimbare făcută de echipă. */
export async function logBookingEvent(env: Env, bookingId: string, kind: string, detail: Record<string, unknown>, adminId: string | null) {
  await env.DB.prepare('INSERT INTO booking_events (booking_id, kind, detail, admin_id) VALUES (?, ?, ?, ?)')
    .bind(bookingId, kind, JSON.stringify(detail), adminId)
    .run();
}

/**
 * Ce se poate schimba la o programare confirmată: ora (`start`), frizerul, serviciul și prețul în lei (`discount` spune de unde vine
 * reducerea, pentru jurnal). Ora nouă trebuie să fie liberă, ca la o programare nouă din panou; `force` o pune oricum (peste program),
 * doar să nu se suprapună cu altă programare. La mutare clientul primește mesaj (`notify: false` îl oprește).
 */
export type BookingEdit = { start?: string; barberId?: string; serviceId?: string; price?: number | null; discount?: string | null; force?: boolean; notify?: boolean };

export async function editBooking(env: Env, id: string, input: BookingEdit, adminId: string | null) {
  const cur = await getBooking(env, id);
  if (!cur) throw new HttpError(404, 'not_found');
  if (cur.status !== 'confirmed') throw new HttpError(409, 'booking_not_editable');
  const start = new Date(input.start ?? cur.start);
  if (Number.isNaN(start.getTime())) throw new HttpError(400, 'invalid_start');
  const barberId = input.barberId || cur.barberId;
  const serviceId = input.serviceId || cur.serviceId;
  const barberChanged = barberId !== cur.barberId;
  const serviceChanged = serviceId !== cur.serviceId;
  const moved = barberChanged || start.getTime() !== Date.parse(cur.start);

  const service = await env.DB.prepare('SELECT id, name, duration_min, price_bani FROM services WHERE id = ?')
    .bind(serviceId)
    .first<{ id: string; name: string; duration_min: number; price_bani: number }>();
  if (!service) throw new HttpError(404, 'service_not_found');
  if (barberChanged) {
    const br = await env.DB.prepare('SELECT active FROM barbers WHERE id = ?').bind(barberId).first<{ active: number }>();
    if (!br?.active) throw new HttpError(404, 'barber_not_found');
  }
  const own = await env.DB.prepare('SELECT price_bani, duration_min FROM barber_services WHERE barber_id = ? AND service_id = ?')
    .bind(barberId, serviceId)
    .first<{ price_bani: number | null; duration_min: number | null }>();
  // Durata: a serviciului (sau a frizerului) când se schimbă unul dintre ei; altfel rămâne cea de acum.
  const durMs = serviceChanged || barberChanged ? (own?.duration_min ?? service.duration_min) * 60_000 : Date.parse(cur.end) - Date.parse(cur.start);
  const end = new Date(start.getTime() + durMs);

  let price = Math.round(cur.price * 100);
  if (serviceChanged) price = own?.price_bani ?? service.price_bani;
  if (input.price !== undefined && input.price !== null) {
    const p = Math.round(Number(input.price) * 100);
    if (!(p >= 0 && p <= 10_000_000)) throw new HttpError(400, 'invalid_amount');
    price = p;
  }
  const priceChanged = price !== Math.round(cur.price * 100);
  // Plătită online: suma e deja luată de pe card, nu se mai schimbă (se anulează și se returnează, dacă e cazul).
  if (cur.onlinePaid && (priceChanged || serviceChanged)) throw new HttpError(409, 'booking_paid');
  if (!moved && !serviceChanged && !priceChanged) return cur;

  if ((moved || serviceChanged) && !input.force) {
    const slots = await availability(env, { serviceId, barberId, day: localDay(env.TIMEZONE, start), excludeBookingId: id, access: 'staff', anyTime: true });
    if (!slots.some((s) => Date.parse(s.start) === start.getTime() && s.barberId === barberId)) throw new HttpError(409, 'slot_unavailable');
  }
  // Suprapunerea cu altă programare se verifică în aceeași instrucțiune (și cu `force`).
  const r = await env.DB.prepare(
    `UPDATE bookings SET barber_id = ?, service_id = ?, starts_at = ?, ends_at = ?, price_bani = ?,
       location_id = CASE WHEN ? THEN (SELECT location_id FROM barbers WHERE id = ?) ELSE location_id END,
       reminder_24h_at = CASE WHEN ? THEN NULL ELSE reminder_24h_at END, reminder_2h_at = CASE WHEN ? THEN NULL ELSE reminder_2h_at END
     WHERE id = ? AND status = 'confirmed'
       AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.id != ? AND o.barber_id = ? AND o.status IN ${HOLDS_SLOT} AND o.starts_at < ? AND o.ends_at > ?)`,
  )
    .bind(barberId, serviceId, iso(start), iso(end), price, barberChanged ? 1 : 0, barberId, moved ? 1 : 0, moved ? 1 : 0, id, id, barberId, iso(end), iso(start))
    .run();
  if (!r.meta.changes) {
    const now = await env.DB.prepare('SELECT status FROM bookings WHERE id = ?').bind(id).first<{ status: string }>();
    throw new HttpError(409, now?.status !== 'confirmed' ? 'booking_not_editable' : 'slot_unavailable');
  }
  const updated = (await getBooking(env, id))!;
  if (moved) {
    await logBookingEvent(env, id, 'moved', { from: cur.start, to: updated.start, ...(barberChanged && { fromBarber: cur.barberName, toBarber: updated.barberName }) }, adminId);
  }
  if (serviceChanged) await logBookingEvent(env, id, 'service', { from: cur.serviceName, to: updated.serviceName }, adminId);
  if (priceChanged) {
    const why = String(input.discount ?? '').trim().slice(0, 40);
    await logBookingEvent(env, id, 'price', { from: cur.price, to: updated.price, ...(why && { discount: why }) }, adminId);
  }
  if (moved) {
    if (input.notify !== false) await notifyBooking(env, updated, 'booking_moved');
    await notifyStaff(env, updated, 'moved', adminId, { fromStart: cur.start, fromBarberId: cur.barberId });
    // Ora veche s-a eliberat: poate o vrea cineva de pe lista de așteptare.
    await freedSlot(env, cur.start);
  }
  return updated;
}

// --- Cererea de plată în aplicație ---

type PayRow = { status: string; payment: string | null; pay_method: string | null; price_bani: number; paid_bani: number | null; online_paid_bani: number | null; pay_request_bani: number | null; pay_requested_at: string | null };
const payRow = (env: Env, id: string) =>
  env.DB.prepare('SELECT status, payment, pay_method, price_bani, paid_bani, online_paid_bani, pay_request_bani, pay_requested_at FROM bookings WHERE id = ?').bind(id).first<PayRow>();
const leiText = (bani: number) => `${bani % 100 ? (bani / 100).toFixed(2) : bani / 100} lei`;

/**
 * Echipa îi cere clientului să plătească programarea din aplicație (după tunsoare, la confirmare sau oricând înainte).
 * Clientul primește mesajul pe canalele bifate (push, SMS, e-mail) și vede în aplicație „Ai de plătit X lei · Plătește acum”.
 * `amount` în lei; implicit suma încasată la încheiere sau prețul programării. Întoarce pe ce canale a plecat mesajul.
 */
export async function sendPayRequest(env: Env, id: string, adminId: string, amount: number | null | undefined, base: string) {
  if (!onlinePaymentsOn(env)) throw new HttpError(409, 'payments_off');
  const r = await payRow(env, id);
  if (!r) throw new HttpError(404, 'not_found');
  if (r.online_paid_bani) throw new HttpError(409, 'booking_paid');
  // Încheiată cu „plata în aplicație”, sau încă neîncheiată (confirmată). Încasată la salon sau pe abonament: nu mai e nimic de cerut.
  const pending = r.status === 'completed' && r.payment === 'paid' && r.pay_method === 'app';
  if (r.status === 'completed' && !pending) throw new HttpError(409, 'already_paid');
  if (r.status !== 'confirmed' && !pending) throw new HttpError(409, 'not_payable');
  const bani = amount === undefined || amount === null ? (pending ? (r.paid_bani ?? r.price_bani) : (r.pay_request_bani ?? r.price_bani)) : Math.round(Number(amount) * 100);
  if (!(bani >= MIN_BANI && bani <= 10_000_000)) throw new HttpError(400, 'invalid_amount');
  // Două apăsări la rând nu trimit două SMS-uri.
  if (r.pay_requested_at && r.pay_request_bani === bani && Date.now() - Date.parse(r.pay_requested_at) < 60_000) throw new HttpError(429, 'pay_request_recent');
  const now = iso(new Date());
  await env.DB.prepare(
    `UPDATE bookings SET pay_request_bani = ?, pay_requested_at = ?, pay_requested_by = ?, paid_bani = CASE WHEN status = 'completed' AND pay_method = 'app' THEN ? ELSE paid_bani END
     WHERE id = ? AND online_paid_bani IS NULL`,
  )
    .bind(bani, now, adminId, bani, id)
    .run();
  const b = (await getBooking(env, id))!;
  const sent = (await notifyBooking(env, b, 'pay_request', { amount: leiText(bani), paylink: `${base}/plata/deschide` })) ?? { sms: false, push: false, email: false };
  return { booking: b, sent };
}

/** Echipa retrage cererea de plată (ex. clientul a plătit totuși la salon: `payMethod` numerar / card / transfer). */
export async function cancelPayRequest(env: Env, id: string, payMethod: string) {
  const r = await payRow(env, id);
  if (!r) throw new HttpError(404, 'not_found');
  if (r.online_paid_bani) throw new HttpError(409, 'booking_paid');
  if (!r.pay_request_bani && r.pay_method !== 'app') throw new HttpError(409, 'no_pay_request');
  await env.DB.prepare(
    `UPDATE bookings SET pay_request_bani = NULL, pay_requested_at = NULL, pay_requested_by = NULL,
       pay_method = CASE WHEN status = 'completed' AND pay_method = 'app' THEN ? ELSE pay_method END WHERE id = ? AND online_paid_bani IS NULL`,
  )
    .bind(payMethod, id)
    .run();
  return (await getBooking(env, id))!;
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
