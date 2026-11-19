import { newId } from './auth';
import { HttpError, type Env } from './env';
import { iso } from './time';

// Rest de plată: clientul a plătit doar o parte la închiderea programării; restul rămâne pe el
// și apare în fișă, în calendar și la încasare, până se încasează (sau îl iartă proprietarul).

export type DebtRow = {
  id: string;
  client_id: string;
  booking_id: string;
  amount_bani: number;
  created_at: string;
  created_by: string | null;
  settled_at: string | null;
  settled_by: string | null;
  settled_method: string | null;
  settled_booking_id: string | null;
  cancelled_at: string | null;
  service_name?: string | null;
  barber_name?: string | null;
  starts_at?: string | null;
  created_by_name?: string | null;
  settled_by_name?: string | null;
};

export const debt = (r: DebtRow) => ({
  id: r.id,
  bookingId: r.booking_id,
  amount: r.amount_bani / 100,
  createdAt: r.created_at,
  createdByName: r.created_by_name ?? null,
  /** Data programării la care a rămas restul, serviciul și frizerul. */
  bookingAt: r.starts_at ?? null,
  serviceName: r.service_name ?? null,
  barberName: r.barber_name ?? null,
  state: (r.cancelled_at ? 'cancelled' : r.settled_at ? 'settled' : 'open') as 'open' | 'settled' | 'cancelled',
  settledAt: r.settled_at,
  settledMethod: r.settled_method,
  settledByName: r.settled_by_name ?? null,
});
export type Debt = ReturnType<typeof debt>;

const SELECT = `SELECT d.*, s.name AS service_name, br.name AS barber_name, b.starts_at,
    coalesce(nullif(a.name, ''), a.email) AS created_by_name, coalesce(nullif(z.name, ''), z.email) AS settled_by_name
  FROM client_debts d LEFT JOIN bookings b ON b.id = d.booking_id LEFT JOIN services s ON s.id = b.service_id LEFT JOIN barbers br ON br.id = b.barber_id
  LEFT JOIN admins a ON a.id = d.created_by LEFT JOIN admins z ON z.id = d.settled_by`;

/** Resturile clientului: întâi cele neîncasate, apoi istoricul (`openOnly`: doar cele neîncasate). */
export async function clientDebts(env: Env, clientId: string, openOnly = false) {
  const r = await env.DB.prepare(
    `${SELECT} WHERE d.client_id = ? ${openOnly ? 'AND d.settled_at IS NULL AND d.cancelled_at IS NULL' : ''}
     ORDER BY (d.settled_at IS NULL AND d.cancelled_at IS NULL) DESC, d.created_at DESC LIMIT 50`,
  )
    .bind(clientId)
    .all<DebtRow>();
  return r.results.map(debt);
}

export async function addDebt(env: Env, clientId: string, bookingId: string, amountBani: number, adminId: string) {
  await env.DB.prepare('INSERT INTO client_debts (id, client_id, booking_id, amount_bani, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(newId('db'), clientId, bookingId, amountBani, adminId)
    .run();
}

const METHODS = ['cash', 'card', 'transfer'];

/** Încasează resturi ale clientului (o singură dată fiecare). `bookingId`: programarea la care s-au încasat. Întoarce suma încasată. */
export async function settleDebts(env: Env, clientId: string, ids: string[], adminId: string, method: string | null | undefined, bookingId: string | null = null) {
  if (!ids.length) return 0;
  const m = METHODS.includes(method ?? '') ? method! : 'cash';
  const now = iso(new Date());
  let total = 0;
  for (const id of [...new Set(ids)].slice(0, 20)) {
    const r = await env.DB.prepare(
      `UPDATE client_debts SET settled_at = ?, settled_by = ?, settled_method = ?, settled_booking_id = ?
       WHERE id = ? AND client_id = ? AND settled_at IS NULL AND cancelled_at IS NULL RETURNING amount_bani`,
    )
      .bind(now, adminId, m, bookingId, id, clientId)
      .first<{ amount_bani: number }>();
    if (!r) throw new HttpError(409, 'debt_not_open');
    total += r.amount_bani;
  }
  return total;
}

/** Iertat de proprietar (sau trecut greșit): nu se mai cere. */
export async function cancelDebt(env: Env, id: string, adminId: string) {
  const r = await env.DB.prepare(`UPDATE client_debts SET cancelled_at = ?, cancelled_by = ? WHERE id = ? AND settled_at IS NULL AND cancelled_at IS NULL`)
    .bind(iso(new Date()), adminId, id)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'debt_not_open');
}

/**
 * Încheierea programării se anulează (greșeală): restul lăsat atunci dispare (dacă nu s-a încasat deja),
 * iar resturile încasate la această programare redevin de încasat.
 */
export function undoDebtStatements(env: Env, bookingId: string) {
  return [
    env.DB.prepare('DELETE FROM client_debts WHERE booking_id = ? AND settled_at IS NULL').bind(bookingId),
    env.DB.prepare('UPDATE client_debts SET settled_at = NULL, settled_by = NULL, settled_method = NULL, settled_booking_id = NULL WHERE settled_booking_id = ?').bind(bookingId),
  ];
}
