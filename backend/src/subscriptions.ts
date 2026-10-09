import { newId } from './auth';
import { redeemGiftCard, refundGiftCard } from './growth';
import { HttpError, type Env } from './env';
import { iso } from './time';
import { sendTemplate } from './sendTemplate';

// Abonamente la tuns: adminul definește planurile, clientul plătește la salon și frizerul
// (sau adminul) îl activează. La fiecare tunsoare finalizată, frizerul confirmă „a plătit X lei”
// sau „pe abonament”; tunsorile pe abonament se scad din abonamentul activ.

export type PlanRow = {
  id: string;
  name: string;
  description: string;
  price_bani: number;
  period_days: number;
  cuts: number | null;
  service_ids: string;
  sort: number;
  active: number;
};
export const plan = (r: PlanRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  price: r.price_bani / 100,
  periodDays: r.period_days,
  cuts: r.cuts,
  serviceIds: r.service_ids ? r.service_ids.split(',') : [],
  sort: r.sort,
  active: !!r.active,
});

export type PlanInput = { name?: string; description?: string; price?: number; periodDays?: number; cuts?: number | null; serviceIds?: string[]; sort?: number; active?: boolean };

/** Valorile unui plan, validate; `partial` pentru editare (doar câmpurile trimise). */
export function planValues(b: PlanInput, partial: boolean) {
  const v: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) {
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'name_required');
    v.name = name;
  }
  if (b.description !== undefined) v.description = String(b.description).trim().slice(0, 500);
  if (!partial || b.price !== undefined) {
    const p = Number(b.price);
    if (!(p > 0 && p <= 100000)) throw new HttpError(400, 'invalid_price');
    v.price_bani = Math.round(p * 100);
  }
  if (!partial || b.periodDays !== undefined) {
    const d = Math.round(Number(b.periodDays));
    if (!(d >= 1 && d <= 3650)) throw new HttpError(400, 'invalid_period');
    v.period_days = d;
  }
  if (!partial || b.cuts !== undefined) {
    if (b.cuts === null || b.cuts === undefined || (b.cuts as unknown) === '') v.cuts = null;
    else {
      const n = Math.round(Number(b.cuts));
      if (!(n >= 1 && n <= 1000)) throw new HttpError(400, 'invalid_cuts');
      v.cuts = n;
    }
  }
  if (b.serviceIds !== undefined) {
    if (!Array.isArray(b.serviceIds)) throw new HttpError(400, 'invalid_body');
    v.service_ids = b.serviceIds.map(String).filter((s) => /^[\w-]+$/.test(s)).join(',');
  }
  if (b.sort !== undefined) v.sort = Math.round(Number(b.sort)) || 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}

export async function getPlans(env: Env, all: boolean) {
  const r = await env.DB.prepare(`SELECT * FROM plans ${all ? '' : 'WHERE active = 1'} ORDER BY sort, price_bani`).all<PlanRow>();
  return r.results.map(plan);
}

type SubRow = {
  id: string;
  client_id: string;
  plan_id: string | null;
  name: string;
  price_bani: number;
  cuts_total: number | null;
  cuts_used: number;
  service_ids: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string;
  created_at: string;
  cancelled_at: string | null;
  created_by_name?: string | null;
};
export const subscription = (r: SubRow) => {
  const now = iso(new Date());
  const state =
    r.status === 'cancelled' ? 'cancelled' : r.starts_at > now ? 'upcoming' : r.ends_at <= now ? 'expired' : r.cuts_total !== null && r.cuts_used >= r.cuts_total ? 'used_up' : 'active';
  return {
    id: r.id,
    planId: r.plan_id,
    name: r.name,
    price: r.price_bani / 100,
    cutsTotal: r.cuts_total,
    cutsUsed: r.cuts_used,
    cutsLeft: r.cuts_total === null ? null : Math.max(0, r.cuts_total - r.cuts_used),
    serviceIds: r.service_ids ? r.service_ids.split(',') : [],
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    state,
    note: r.note,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    ...(r.created_by_name !== undefined && { createdByName: r.created_by_name }),
  };
};
export type Subscription = ReturnType<typeof subscription>;

/** Abonamentele unui client, cele mai noi primele; cu `staff` și numele celui care l-a activat. */
export async function getSubscriptions(env: Env, clientId: string, staff: boolean) {
  const r = await env.DB.prepare(
    `SELECT s.*, ${staff ? 'a.name' : 'NULL'} AS created_by_name FROM subscriptions s LEFT JOIN admins a ON a.id = s.created_by
     WHERE s.client_id = ? ORDER BY s.starts_at DESC LIMIT 100`,
  )
    .bind(clientId)
    .all<SubRow>();
  return r.results.map((x) => {
    const s = subscription(x);
    return staff ? s : { ...s, createdByName: undefined, note: undefined };
  });
}

/** Activează un abonament după plata la salon. Dacă clientul are deja unul activ din același plan, noul începe când se termină acela. */
/** `gift`: pachet oferit cadou (ex. premiu pentru recomandări): nu se încasează, deci prețul salvat e 0. */
export async function activateSubscription(env: Env, clientId: string, planId: string, adminId: string, note: string, gift = false) {
  const p = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(planId).first<PlanRow>();
  if (!p || !p.active) throw new HttpError(404, 'plan_not_found');
  const exists = await env.DB.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').bind(clientId).first();
  if (!exists) throw new HttpError(404, 'not_found');
  const now = iso(new Date());
  const last = await env.DB.prepare(
    `SELECT max(ends_at) AS e FROM subscriptions WHERE client_id = ? AND plan_id = ? AND status = 'active' AND ends_at > ?
       AND (cuts_total IS NULL OR cuts_used < cuts_total)`,
  )
    .bind(clientId, planId, now)
    .first<{ e: string | null }>();
  const start = last?.e && last.e > now ? last.e : now;
  const end = iso(new Date(new Date(start).getTime() + p.period_days * 86_400_000));
  const id = newId('sb');
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, client_id, plan_id, name, price_bani, cuts_total, service_ids, starts_at, ends_at, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, clientId, p.id, p.name, gift ? 0 : p.price_bani, p.cuts, p.service_ids, start, end, note.slice(0, 300), adminId)
    .run();
  const enddate = new Date(end).toLocaleDateString('ro-RO', { timeZone: env.TIMEZONE, day: 'numeric', month: 'long', year: 'numeric' });
  try {
    await sendTemplate(env, 'sub_started', clientId, { membershipplanname: p.name, enddate }, { data: { screen: 'subscriptions' } });
  } catch (e) {
    console.error('sub_started', e);
  }
  return id;
}

/** Abonamentul care poate acoperi tunsoarea: activ acum, cu tunsori rămase și care include serviciul. Cel care expiră primul. */
export async function usableSubscription(env: Env, clientId: string, serviceId: string, at: string = iso(new Date())) {
  const r = await env.DB.prepare(
    `SELECT * FROM subscriptions WHERE client_id = ? AND status = 'active' AND starts_at <= ? AND ends_at > ?
       AND (cuts_total IS NULL OR cuts_used < cuts_total) ORDER BY ends_at LIMIT 20`,
  )
    .bind(clientId, at, at)
    .all<SubRow>();
  const row = r.results.find((s) => !s.service_ids || s.service_ids.split(',').includes(serviceId));
  return row ? subscription(row) : null;
}

/**
 * Frizerul confirmă tunsoarea: „a plătit X lei” sau „pe abonament”, opțional cu un bonus folosit.
 * Programarea se marchează întâi (doar dacă nu e deja confirmată), apoi se scade tunsoarea din
 * abonament; dacă abonamentul nu mai are tunsori, programarea revine cum era.
 */
export async function completeBooking(
  env: Env,
  bookingId: string,
  b: { payment?: string; amount?: number; tip?: number | null; bonusId?: string | null; giftCode?: string | null; giftAmount?: number | null; payMethod?: string | null },
  adminId: string,
) {
  const bk = await env.DB.prepare('SELECT id, client_id, service_id, price_bani, status, payment, online_paid_bani FROM bookings WHERE id = ?')
    .bind(bookingId)
    .first<{ id: string; client_id: string; service_id: string; price_bani: number; status: string; payment: string | null; online_paid_bani: number | null }>();
  if (!bk) throw new HttpError(404, 'not_found');
  if (bk.status === 'cancelled') throw new HttpError(409, 'booking_cancelled');
  // O cerere încă neacceptată nu se poate încheia.
  if (bk.status === 'requested') throw new HttpError(409, 'booking_requested');
  if (bk.payment) throw new HttpError(409, 'already_completed');
  if (b.payment !== 'paid' && b.payment !== 'subscription') throw new HttpError(400, 'invalid_payment');

  let paidBani: number | null = null;
  let sub: Subscription | null = null;
  if (b.payment === 'paid') {
    const amount = b.amount === undefined || b.amount === null ? bk.price_bani / 100 : Number(b.amount);
    if (!(amount >= 0 && amount <= 100000)) throw new HttpError(400, 'invalid_amount');
    paidBani = Math.round(amount * 100);
  } else {
    sub = await usableSubscription(env, bk.client_id, bk.service_id);
    if (!sub) throw new HttpError(409, 'no_active_subscription');
  }

  // Cum s-a plătit suma de la casă (pentru registrul de încasări): numerar implicit, card la POS sau transfer.
  // „online” = plătită din aplicație înainte de vizită (doar dacă plata online chiar a venit).
  const payMethod = paidBani
    ? b.payMethod === 'card' || b.payMethod === 'transfer'
      ? b.payMethod
      : b.payMethod === 'online' && bk.online_paid_bani
        ? 'online'
        : 'cash'
    : null;

  // Bacșișul se notează separat de preț, pentru raportul de bacșișuri pe frizer.
  const tip = b.tip === undefined || b.tip === null || b.tip === 0 ? 0 : Number(b.tip);
  if (!(tip >= 0 && tip <= 10000)) throw new HttpError(400, 'invalid_tip');
  const tipBani = tip ? Math.round(tip * 100) : null;

  let bonusId: string | null = null;
  if (b.bonusId) {
    const bn = await env.DB.prepare(`SELECT id, status, expires_at FROM bonuses WHERE id = ? AND client_id = ?`)
      .bind(b.bonusId, bk.client_id)
      .first<{ id: string; status: string; expires_at: string | null }>();
    if (!bn || bn.status !== 'active' || (bn.expires_at && bn.expires_at < iso(new Date()))) throw new HttpError(409, 'bonus_not_active');
    bonusId = bn.id;
  }

  // Card cadou: se scade din sold suma acoperită (implicit cât acoperă din preț); `amount` rămâne ce s-a plătit în plus, cash sau card.
  let gift: { id: string; take: number } | null = null;
  if (b.giftCode && b.payment === 'paid') {
    const want = b.giftAmount === undefined || b.giftAmount === null ? bk.price_bani : Math.round(Number(b.giftAmount) * 100);
    if (!(want > 0)) throw new HttpError(400, 'invalid_amount');
    gift = await redeemGiftCard(env, b.giftCode, want);
  }

  const now = iso(new Date());
  const claimed = await env.DB.prepare(
    `UPDATE bookings SET status = 'completed', payment = ?, paid_bani = ?, subscription_id = ?, bonus_id = ?, tip_bani = ?, gift_card_id = ?, gift_bani = ?, pay_method = ?, completed_at = ?, completed_by = ?
     WHERE id = ? AND payment IS NULL AND status NOT IN ('cancelled','requested')`,
  )
    .bind(b.payment, paidBani, sub?.id ?? null, bonusId, tipBani, gift?.id ?? null, gift?.take ?? null, payMethod, now, adminId, bookingId)
    .run();
  if (!claimed.meta.changes) {
    if (gift) await refundGiftCard(env, gift.id, gift.take);
    throw new HttpError(409, 'already_completed');
  }

  if (sub) {
    const used = await env.DB.prepare(
      `UPDATE subscriptions SET cuts_used = cuts_used + 1 WHERE id = ? AND status = 'active' AND (cuts_total IS NULL OR cuts_used < cuts_total)`,
    )
      .bind(sub.id)
      .run();
    if (!used.meta.changes) {
      await env.DB.prepare(
        `UPDATE bookings SET status = ?, payment = NULL, paid_bani = NULL, subscription_id = NULL, bonus_id = NULL, tip_bani = NULL, gift_card_id = NULL, gift_bani = NULL, pay_method = NULL, completed_at = NULL, completed_by = NULL WHERE id = ?`,
      )
        .bind(bk.status, bookingId)
        .run();
      throw new HttpError(409, 'no_active_subscription');
    }
  }
  if (bonusId) {
    await env.DB.prepare(`UPDATE bonuses SET status = 'used', used_at = ?, used_by = ? WHERE id = ? AND status = 'active'`).bind(now, adminId, bonusId).run();
  }
}

/** Anulează confirmarea (greșeală): programarea revine la „confirmată”, tunsoarea se întoarce în abonament, bonusul redevine activ. */
export async function undoCompletion(env: Env, bookingId: string) {
  const bk = await env.DB.prepare('SELECT payment, subscription_id, bonus_id, gift_card_id, gift_bani FROM bookings WHERE id = ?')
    .bind(bookingId)
    .first<{ payment: string | null; subscription_id: string | null; bonus_id: string | null; gift_card_id: string | null; gift_bani: number | null }>();
  if (!bk) throw new HttpError(404, 'not_found');
  if (!bk.payment) throw new HttpError(409, 'not_completed');
  const stmts = [
    env.DB.prepare(
      `UPDATE bookings SET status = 'confirmed', payment = NULL, paid_bani = NULL, subscription_id = NULL, bonus_id = NULL, tip_bani = NULL, gift_card_id = NULL, gift_bani = NULL, pay_method = NULL, completed_at = NULL, completed_by = NULL WHERE id = ?`,
    ).bind(bookingId),
  ];
  if (bk.subscription_id) stmts.push(env.DB.prepare('UPDATE subscriptions SET cuts_used = max(0, cuts_used - 1) WHERE id = ?').bind(bk.subscription_id));
  if (bk.bonus_id) stmts.push(env.DB.prepare(`UPDATE bonuses SET status = 'active', used_at = NULL, used_by = NULL WHERE id = ? AND status = 'used'`).bind(bk.bonus_id));
  await env.DB.batch(stmts);
  if (bk.gift_card_id && bk.gift_bani) await refundGiftCard(env, bk.gift_card_id, bk.gift_bani);
}

/** Ce vede clientul: planurile disponibile, abonamentul activ și istoricul lui. */
export async function mySubscriptions(env: Env, clientId: string) {
  const [plans, subs] = await Promise.all([getPlans(env, false), getSubscriptions(env, clientId, false)]);
  return { plans, subscriptions: subs };
}

/**
 * Membru TAF Club: are acum un abonament activ (început, neexpirat, cu tunsori rămase, oricare plan)
 * sau a fost marcat de mână ca membru în fișa lui din panou. Membrii văd și orele „doar membri”.
 */
export async function isClubMember(env: Env, clientId: string | null | undefined) {
  if (!clientId) return false;
  const now = iso(new Date());
  const r = await env.DB.prepare(
    `SELECT c.club_member AS manual,
       EXISTS (SELECT 1 FROM subscriptions s WHERE s.client_id = c.id AND s.status = 'active' AND s.starts_at <= ? AND s.ends_at > ?
               AND (s.cuts_total IS NULL OR s.cuts_used < s.cuts_total)) AS sub
     FROM clients c WHERE c.id = ? AND c.deleted_at IS NULL`,
  )
    .bind(now, now, clientId)
    .first<{ manual: number; sub: number }>();
  return !!r && (!!r.manual || !!r.sub);
}
