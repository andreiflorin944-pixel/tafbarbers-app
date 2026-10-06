import { BOOKING_SELECT } from './bookings';
import { booking, client, type BookingRow, type ClientRow } from './db';
import { HttpError, type Env } from './env';
import { iso } from './time';
import { getOrders, setOrderStatus } from './shop';
import { getIdentity, wipeIdentity } from './identity';
import { getBonuses } from './referrals';
import { getSubscriptions } from './subscriptions';

/** Toate datele unui client, pentru „Descarcă datele mele” (portabilitate, art. 20 GDPR). */
export async function exportClient(env: Env, id: string) {
  const c = await env.DB.prepare('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL').bind(id).first<ClientRow & { terms_accepted_at: string | null }>();
  if (!c) throw new HttpError(404, 'not_found');
  const [bk, msgs, tokens] = await Promise.all([
    env.DB.prepare(`${BOOKING_SELECT} WHERE b.client_id = ? ORDER BY b.starts_at`).bind(id).all<BookingRow>(),
    env.DB.prepare('SELECT channel, kind, created_at, status FROM message_log WHERE recipient = ? OR recipient = ? ORDER BY id').bind(c.phone, c.email ?? '').all(),
    env.DB.prepare('SELECT platform, updated_at FROM push_tokens WHERE client_id = ?').bind(id).all(),
  ]);
  const orders = (await getOrders(env, 'o.client_id = ?', [id], 1000)).map(({ clientName: _n, clientPhone: _p, ...o }) => o);
  const { notes: _internal, ...profile } = client(c);
  const identity = await getIdentity(env, id, false);
  const bonuses = await getBonuses(env, id, false);
  const subscriptions = await getSubscriptions(env, id, false);
  return {
    exportedAt: iso(new Date()),
    profile: { ...profile, termsAcceptedAt: c.terms_accepted_at },
    bookings: bk.results.map((b) => {
      const { clientName: _n, clientPhone: _p, ...rest } = booking(b);
      return rest;
    }),
    messages: msgs.results,
    orders,
    tafIdentity: identity,
    bonuses,
    subscriptions,
    devices: tokens.results,
  };
}

/**
 * Ștergerea contului (art. 17 GDPR): datele de identificare dispar, programările viitoare se anulează,
 * iar istoricul rămâne anonimizat pentru evidența contabilă.
 */
export async function deleteClient(env: Env, id: string) {
  const now = iso(new Date());
  const c = await env.DB.prepare('SELECT phone, email FROM clients WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ phone: string; email: string | null }>();
  if (!c) throw new HttpError(404, 'not_found');
  // Comenzile nepreluate se anulează (stocul revine).
  const open = await env.DB.prepare(`SELECT id FROM orders WHERE client_id = ? AND status IN ('new', 'ready')`).bind(id).all<{ id: string }>();
  for (const o of open.results) await setOrderStatus(env, o.id, 'cancelled', ['new', 'ready']);
  await wipeIdentity(env, id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET note = '' WHERE client_id = ?`).bind(id),
    env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE client_id = ? AND status = 'confirmed' AND starts_at > ?`).bind(now, id, now),
    env.DB.prepare(`UPDATE bookings SET note = '' WHERE client_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM push_tokens WHERE client_id = ?').bind(id),
    env.DB.prepare(`DELETE FROM sessions WHERE kind = 'client' AND subject_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM otp_codes WHERE phone = ?').bind(c.phone),
    env.DB.prepare(`UPDATE message_log SET recipient = 'sters' WHERE recipient = ? OR recipient = ?`).bind(c.phone, c.email ?? '\u0000'),
    env.DB.prepare(
      `UPDATE clients SET phone = ?, name = '', email = NULL, notes = '', marketing_sms = 0, marketing_email = 0, marketing_push = 0, deleted_at = ? WHERE id = ?`,
    ).bind(`deleted:${id}`, now, id),
  ]);
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Previne formulele în Excel și escapează ghilimelele.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function clientsCsv(env: Env) {
  const r = await env.DB.prepare(
    `SELECT c.*,
       (SELECT count(*) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS visits,
       (SELECT max(starts_at) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS last_visit
     FROM clients c WHERE c.deleted_at IS NULL ORDER BY c.created_at`,
  ).all<ClientRow & { visits: number; last_visit: string | null }>();
  const head = ['Nume', 'Telefon', 'E-mail', 'Limba', 'Vizite', 'Ultima vizită', 'Oferte SMS', 'Oferte e-mail', 'Oferte push', 'Notițe', 'Client din'];
  const rows = r.results.map((c) =>
    [c.name, c.phone, c.email, c.lang, c.visits, c.last_visit?.slice(0, 10), c.marketing_sms ? 'da' : 'nu', c.marketing_email ? 'da' : 'nu', c.marketing_push ? 'da' : 'nu', c.notes, c.created_at.slice(0, 10)]
      .map(csvCell)
      .join(';'),
  );
  // BOM ca Excel să citească diacriticele.
  return '﻿' + [head.join(';'), ...rows].join('\r\n');
}
