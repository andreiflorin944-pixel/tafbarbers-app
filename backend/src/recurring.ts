import { newId } from './auth';
import { HttpError, onlinePaymentsOn, type Env } from './env';
import { CHECKOUT_EVENTS, handleStripeEvent, MIN_BANI, recordPayment, stripeCall, type Outcome, type Session } from './payments';
import { sendTemplate } from './sendTemplate';
import { activateSubscription, recurringInterval, type PlanRow } from './subscriptions';
import { iso } from './time';

// Abonamente cu plată recurentă: clientul plătește prima dată pe pagina Stripe (card, Apple Pay, Google Pay), apoi Stripe îl taxează singur
// la fiecare perioadă (ex. la 30 de zile) și ne anunță prin webhook. Fiecare perioadă plătită devine un rând nou în `subscriptions`,
// cu tunsorile ei, legat de abonamentul Stripe prin `recurring_id`. Reînnoirea se poate opri și porni din aplicație sau din panou.

const LANGS = ['ro', 'en', 'fr'];
const DAY = 86_400_000;
/** Stripe cere ca o perioadă de probă (aici: până se termină abonamentul deja plătit) să se termine la cel puțin 48 de ore după cumpărare. */
const MIN_TRIAL_MS = 49 * 3600_000;

type RecRow = {
  id: string;
  client_id: string;
  plan_id: string | null;
  name: string;
  price_bani: number;
  cuts: number | null;
  service_ids: string;
  interval_days: number;
  customer_id: string | null;
  auto_renew: number;
  status: 'active' | 'past_due' | 'ended';
  current_period_end: string | null;
  failed_invoice: string | null;
  stopped_by: string | null;
  event_at: number;
};
type Meta = { kind?: string; ref?: string; client?: string; plan?: string; recurring?: string };
/** Factura Stripe, cu câmpurile din versiunile vechi și noi ale API-ului (abonamentul și metadatele s-au mutat sub `parent`). */
type Invoice = {
  id?: string;
  billing_reason?: string;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  customer?: string | null;
  subscription?: string | null;
  payment_intent?: string | null;
  subscription_details?: { metadata?: Meta } | null;
  parent?: { subscription_details?: { subscription?: string | null; metadata?: Meta } | null } | null;
  lines?: { data?: Array<{ period?: { start?: number; end?: number }; metadata?: Meta }> };
};
type StripeSub = {
  id?: string;
  status?: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
  metadata?: Meta;
};

const unixIso = (t: unknown) => (typeof t === 'number' && t > 0 ? iso(new Date(t * 1000)) : null);
const invoiceSub = (inv: Invoice) => (typeof inv.subscription === 'string' && inv.subscription) || inv.parent?.subscription_details?.subscription || null;
const invoiceMeta = (inv: Invoice): Meta => inv.parent?.subscription_details?.metadata ?? inv.subscription_details?.metadata ?? inv.lines?.data?.[0]?.metadata ?? {};
const subPeriodEnd = (s: StripeSub) => unixIso(s.current_period_end ?? s.items?.data?.[0]?.current_period_end);
const getRec = (env: Env, id: string) => env.DB.prepare('SELECT * FROM recurring_subs WHERE id = ?').bind(id).first<RecRow>();
const fmtDate = (env: Env, at: string) => new Date(at).toLocaleDateString('ro-RO', { timeZone: env.TIMEZONE, day: 'numeric', month: 'long', year: 'numeric' });
const leiText = (bani: number) => `${Math.round(bani) / 100} lei`;

/** Clientul în Stripe (cus_…), creat o singură dată și refolosit. `fresh`: cel salvat nu mai există în Stripe, se face altul. */
async function ensureCustomer(env: Env, clientId: string, fresh = false): Promise<string> {
  const c = await env.DB.prepare('SELECT name, email, stripe_customer_id FROM clients WHERE id = ? AND deleted_at IS NULL')
    .bind(clientId)
    .first<{ name: string; email: string | null; stripe_customer_id: string | null }>();
  if (!c) throw new HttpError(404, 'not_found');
  if (c.stripe_customer_id && !fresh) return c.stripe_customer_id;
  // Doar ce trebuie pentru chitanță: numele și e-mailul (telefonul nu pleacă la Stripe).
  const form = new URLSearchParams({ 'metadata[client]': clientId });
  if (c.name) form.set('name', c.name.slice(0, 200));
  if (c.email) form.set('email', c.email);
  const r = await stripeCall(env, 'POST', '/v1/customers', form, `customer-${clientId}${fresh ? `-${Date.now()}` : ''}`);
  if (!r.ok || !r.json?.id) {
    console.error('stripe customer', r.status, r.json?.error?.message);
    throw new HttpError(500, 'payment_failed');
  }
  await env.DB.prepare('UPDATE clients SET stripe_customer_id = ? WHERE id = ?').bind(r.json.id, clientId).run();
  return r.json.id;
}

/**
 * Deschide pagina Stripe pentru un abonament cu plată recurentă și întoarce adresa ei, sau null dacă planul nu se poate reînnoi prin Stripe
 * (perioadă de peste un an): atunci se cumpără cu o plată o singură dată, ca înainte.
 * Dacă clientul are deja o perioadă plătită din același plan, prima plată se face când se termină aceea (perioadă de probă Stripe), ca să nu plătească de două ori.
 */
export async function createRecurringCheckout(
  env: Env,
  p: { clientId: string; plan: Pick<PlanRow, 'id' | 'name' | 'price_bani' | 'period_days'>; title: string; base: string; lang?: string | null },
): Promise<string | null> {
  if (!onlinePaymentsOn(env)) throw new HttpError(409, 'payments_off');
  const iv = recurringInterval(p.plan.period_days);
  if (!iv) return null;
  if (p.plan.price_bani < MIN_BANI) throw new HttpError(409, 'amount_too_small');
  const busy = await env.DB.prepare(`SELECT 1 FROM recurring_subs WHERE client_id = ? AND plan_id = ? AND status != 'ended'`).bind(p.clientId, p.plan.id).first();
  if (busy) throw new HttpError(409, 'already_recurring');
  const now = iso(new Date());
  const last = await env.DB.prepare(
    `SELECT max(ends_at) AS e FROM subscriptions WHERE client_id = ? AND plan_id = ? AND status = 'active' AND ends_at > ?
       AND (cuts_total IS NULL OR cuts_used < cuts_total)`,
  )
    .bind(p.clientId, p.plan.id, now)
    .first<{ e: string | null }>();
  const trialEnd = last?.e && new Date(last.e).getTime() - Date.now() > MIN_TRIAL_MS ? Math.floor(new Date(last.e).getTime() / 1000) : null;

  const lang = LANGS.includes(p.lang ?? '') ? p.lang! : 'ro';
  const back = (rez: string) => `${p.base}/plata/${rez}?tip=sub&lang=${lang}`;
  const ref = newId('sb');
  const meta: Record<string, string> = { kind: 'sub', ref, client: p.clientId, plan: p.plan.id, recurring: '1' };
  const build = (customer: string) => {
    const form = new URLSearchParams({
      mode: 'subscription',
      locale: lang,
      customer,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'ron',
      'line_items[0][price_data][unit_amount]': String(p.plan.price_bani),
      'line_items[0][price_data][product_data][name]': p.title.slice(0, 250),
      'line_items[0][price_data][recurring][interval]': iv.interval,
      'line_items[0][price_data][recurring][interval_count]': String(iv.count),
      client_reference_id: ref,
      success_url: back('gata'),
      cancel_url: back('anulata'),
      expires_at: String(Math.floor(Date.now() / 1000) + 35 * 60),
    });
    for (const [k, v] of Object.entries(meta)) {
      form.set(`metadata[${k}]`, v);
      form.set(`subscription_data[metadata][${k}]`, v);
    }
    if (trialEnd) form.set('subscription_data[trial_end]', String(trialEnd));
    return form;
  };
  const idem = `sub-${p.clientId}-${p.plan.id}-${p.plan.price_bani}-${Math.floor(Date.now() / 60000)}`;
  let r = await stripeCall(env, 'POST', '/v1/checkout/sessions', build(await ensureCustomer(env, p.clientId)), idem);
  // Clientul Stripe salvat a fost șters din Stripe între timp: facem altul și mai încercăm o dată.
  if (!r.ok && r.json?.error?.code === 'resource_missing' && r.json.error.param === 'customer') {
    r = await stripeCall(env, 'POST', '/v1/checkout/sessions', build(await ensureCustomer(env, p.clientId, true)), `${idem}-new`);
  }
  if (!r.ok || !r.json?.url) {
    console.error('stripe sub checkout', r.status, r.json?.error?.message);
    throw new HttpError(500, 'payment_failed');
  }
  return r.json.url;
}

/** Oprește imediat abonamentul din Stripe (fără alte plăți). O eroare „nu mai există” înseamnă că e deja oprit. */
async function stripeCancelNow(env: Env, subId: string) {
  if (!env.STRIPE_SECRET_KEY) return false;
  try {
    const r = await stripeCall(env, 'DELETE', `/v1/subscriptions/${encodeURIComponent(subId)}`, undefined, `cancel-${subId}`);
    if (!r.ok && r.json?.error?.code !== 'resource_missing') console.error('stripe cancel', subId, r.status, r.json?.error?.message);
    return r.ok || r.json?.error?.code === 'resource_missing';
  } catch (e) {
    console.error('stripe cancel', subId, e);
    return false;
  }
}

/** Marchează abonamentul recurent încheiat (perioada plătită rămâne valabilă până la capăt). */
async function markEnded(env: Env, subId: string, by: string) {
  const now = iso(new Date());
  await env.DB.prepare(
    `UPDATE recurring_subs SET status = 'ended', auto_renew = 0, ended_at = coalesce(ended_at, ?), stopped_by = coalesce(stopped_by, ?), updated_at = ?, event_at = max(event_at, ?) WHERE id = ?`,
  )
    .bind(now, by, now, Math.floor(Date.now() / 1000), subId)
    .run();
}

/**
 * Prima plată a unui abonament recurent (din sesiunea Stripe sau din prima factură, care pot veni în orice ordine): activează abonamentul o singură dată.
 * Cu perioadă de probă (avea deja o perioadă plătită), nu se plătește nimic acum: doar se ține minte abonamentul Stripe, iar prima plată vine la final.
 */
async function startRecurring(
  env: Env,
  x: { subId: string | null; customerId: string | null; invoiceId: string | null; sessionId: string; amount: number; pi: string | null; meta: Meta; paid: boolean },
): Promise<string> {
  const m = x.meta;
  if (m.kind !== 'sub' || !m.ref || !m.client || !m.plan || !x.subId) return 'unknown';
  const clientId = m.client;
  // Aceeași primă plată, venită a doua oară (sesiunea și factura): completăm doar referințele care lipseau.
  const known = await env.DB.prepare(`SELECT id FROM online_payments WHERE kind = 'sub' AND ref = ?`).bind(m.ref).first<{ id: string }>();
  if (known) {
    await env.DB.prepare('UPDATE online_payments SET invoice_id = coalesce(invoice_id, ?), payment_intent = coalesce(payment_intent, ?) WHERE id = ?')
      .bind(x.invoiceId, x.pi, known.id)
      .run()
      .catch(() => undefined);
    return 'duplicate';
  }
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(m.plan).first<PlanRow>();
  const client = await env.DB.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').bind(clientId).first();
  const iv = plan ? recurringInterval(plan.period_days) : null;
  const remember = (priceBani: number, periodEnd: string | null) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO recurring_subs (id, client_id, plan_id, name, price_bani, cuts, service_ids, interval_days, customer_id, current_period_end, event_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(x.subId, clientId, plan!.id, plan!.name, priceBani, plan!.cuts, plan!.service_ids, iv!.count, x.customerId, periodEnd, Math.floor(Date.now() / 1000))
      .run();

  if (!x.paid) {
    // Perioadă de probă: nimic de plătit acum. Fără plan sau client, abonamentul Stripe se oprește înainte de prima plată.
    if (!plan || !client || !iv) {
      await stripeCancelNow(env, x.subId);
      return 'unknown';
    }
    if (await getRec(env, x.subId)) return 'duplicate';
    const last = await env.DB.prepare(`SELECT max(ends_at) AS e FROM subscriptions WHERE client_id = ? AND plan_id = ? AND status = 'active'`)
      .bind(clientId, plan.id)
      .first<{ e: string | null }>();
    await remember(plan.price_bani, last?.e ?? null);
    // Perioada deja plătită devine „perioada curentă” a abonamentului recurent: clientul vede pe ea „se reînnoiește automat pe …”.
    if (last?.e) {
      await env.DB.prepare(
        `UPDATE subscriptions SET recurring_id = ? WHERE id = (SELECT id FROM subscriptions WHERE client_id = ? AND plan_id = ? AND status = 'active'
           AND (recurring_id IS NULL OR recurring_id IN (SELECT id FROM recurring_subs WHERE status = 'ended')) ORDER BY ends_at DESC LIMIT 1)`,
      )
        .bind(x.subId, clientId, plan.id)
        .run();
    }
    return 'sub_scheduled';
  }

  return recordPayment(env, { kind: 'sub', ref: m.ref, clientId, sessionId: x.invoiceId ?? x.sessionId, invoiceId: x.invoiceId, pi: x.pi, amount: x.amount }, async (): Promise<Outcome> => {
    const refuse = async (reason: string, result?: string): Promise<Outcome> => {
      // Plata se returnează; abonamentul Stripe se oprește, ca să nu mai taxeze nimic.
      await stripeCancelNow(env, x.subId!);
      if (await getRec(env, x.subId!)) await markEnded(env, x.subId!, 'stripe');
      return { ok: false, reason, result, clientId };
    };
    if (await env.DB.prepare('SELECT 1 FROM subscriptions WHERE id = ?').bind(m.ref).first()) return { ok: true, result: 'sub_paid', clientId };
    if (!plan || !iv) return refuse('Abonamentul nu mai există');
    if (!client) return refuse('Contul clientului nu mai există');
    if (x.amount !== plan.price_bani) return refuse('Suma plătită nu se potrivește (prețul abonamentului s-a schimbat)', 'amount_mismatch');
    await remember(x.amount, null);
    try {
      await activateSubscription(env, clientId, plan.id, null, 'Plătit online · se reînnoiește automat', false, { id: m.ref, payMethod: 'online', anyPlan: true, recurringId: x.subId! });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return refuse('Contul clientului nu mai există');
      throw e;
    }
    const row = await env.DB.prepare('SELECT ends_at FROM subscriptions WHERE id = ?').bind(m.ref).first<{ ends_at: string }>();
    await env.DB.prepare(`UPDATE recurring_subs SET current_period_end = ?, status = 'active', updated_at = ? WHERE id = ?`).bind(row?.ends_at ?? null, iso(new Date()), x.subId).run();
    return { ok: true, result: 'sub_paid', clientId };
  });
}

/** Stripe a încasat o factură a abonamentului: prima plată (activare) sau o reînnoire (perioadă nouă, tunsorile de la zero). */
async function invoicePaid(env: Env, inv: Invoice): Promise<string> {
  const subId = invoiceSub(inv);
  if (!inv.id || !subId) return 'unknown';
  if (inv.currency && inv.currency !== 'ron') return 'unknown';
  const amount = Math.round(Number(inv.amount_paid) || 0);
  const pi = typeof inv.payment_intent === 'string' && inv.payment_intent ? inv.payment_intent : null;
  // Factura trecută deja (de obicei prima, venită după sesiune): completăm doar plata Stripe, pentru returnări.
  const known = await env.DB.prepare('SELECT id FROM online_payments WHERE invoice_id = ?1 OR session_id = ?1').bind(inv.id).first<{ id: string }>();
  if (known) {
    if (pi) await env.DB.prepare('UPDATE online_payments SET payment_intent = coalesce(payment_intent, ?) WHERE id = ?').bind(pi, known.id).run();
    return 'duplicate';
  }
  const rec = await getRec(env, subId);
  // Prima factură de 0 lei (perioadă de probă): nimic de încasat.
  if (inv.billing_reason === 'subscription_create' && amount <= 0) return 'not_paid';
  if (inv.billing_reason === 'subscription_create' && rec) return 'duplicate';
  if (inv.billing_reason === 'subscription_create' || (!rec && invoiceMeta(inv).kind === 'sub')) {
    // Prima factură: 0 lei cu perioadă de probă (nimic de făcut), altfel activarea, dacă sesiunea n-a făcut-o deja.
    if (amount <= 0) return 'not_paid';
    return startRecurring(env, { subId, customerId: inv.customer ?? null, invoiceId: inv.id, sessionId: inv.id, amount, pi, meta: invoiceMeta(inv), paid: true });
  }
  if (!rec) return 'unknown';
  if (amount <= 0) return 'not_paid';

  const ref = newId('sb');
  return recordPayment(env, { kind: 'sub', ref, clientId: rec.client_id, sessionId: inv.id, invoiceId: inv.id, pi, amount, renewal: true }, async (): Promise<Outcome> => {
    const clientId = rec.client_id;
    const client = await env.DB.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').bind(clientId).first();
    if (!client) {
      await stripeCancelNow(env, rec.id);
      await markEnded(env, rec.id, 'gdpr');
      return { ok: false, reason: 'Contul clientului nu mai există (abonamentul Stripe a fost oprit)', clientId };
    }
    // Mai puțin decât prețul (ex. o reducere pusă din Stripe) se acceptă; mai mult nu.
    if (amount > rec.price_bani) return { ok: false, reason: 'Suma reînnoirii e mai mare decât prețul abonamentului', result: 'amount_mismatch', clientId };
    // Perioada plătită: cea din factură (Stripe ține aceeași zi de plată chiar dacă plata a reușit după câteva reîncercări);
    // fără ea, de unde s-a terminat perioada trecută.
    const line = inv.lines?.data?.[0]?.period;
    let start = unixIso(line?.start);
    let end = unixIso(line?.end);
    if (!start || !end || end <= start) {
      const prev = await env.DB.prepare(`SELECT max(ends_at) AS e FROM subscriptions WHERE recurring_id = ? AND status = 'active'`).bind(rec.id).first<{ e: string | null }>();
      start = prev?.e ?? rec.current_period_end ?? iso(new Date());
      end = iso(new Date(new Date(start).getTime() + rec.interval_days * DAY));
    }
    const now = iso(new Date());
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO subscriptions (id, client_id, plan_id, name, price_bani, cuts_total, service_ids, starts_at, ends_at, note, created_by, pay_method, recurring_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'online', ?)`,
      ).bind(ref, clientId, rec.plan_id, rec.name, amount, rec.cuts, rec.service_ids, start, end, 'Reînnoit automat (card)', rec.id),
      // Plata a trecut: dacă era „plata a căzut”, revine la normal.
      env.DB.prepare(`UPDATE recurring_subs SET status = CASE WHEN status = 'ended' THEN 'ended' ELSE 'active' END, current_period_end = ?, updated_at = ? WHERE id = ?`).bind(
        end,
        now,
        rec.id,
      ),
    ]);
    try {
      await sendTemplate(env, 'sub_renewed', clientId, { membershipplanname: rec.name, enddate: fmtDate(env, end), amount: leiText(amount) }, { data: { screen: 'subscriptions' } });
    } catch (e) {
      console.error('sub_renewed', e);
    }
    return { ok: true, result: 'sub_renewed', clientId };
  });
}

/** Plata cu cardul a căzut: clientul e anunțat o singură dată pe factură să-și actualizeze cardul; Stripe reîncearcă singur. */
async function invoiceFailed(env: Env, inv: Invoice, base: string): Promise<string> {
  const subId = invoiceSub(inv);
  if (!inv.id || !subId) return 'unknown';
  const rec = await getRec(env, subId);
  if (!rec) return 'unknown';
  const now = iso(new Date());
  const r = await env.DB.prepare(
    `UPDATE recurring_subs SET status = CASE WHEN status = 'ended' THEN 'ended' ELSE 'past_due' END, failed_invoice = ?, last_failed_at = ?, updated_at = ?
     WHERE id = ? AND (failed_invoice IS NULL OR failed_invoice != ?)`,
  )
    .bind(inv.id, now, now, subId, inv.id)
    .run();
  if (!r.meta.changes) return 'duplicate';
  try {
    await sendTemplate(
      env,
      'sub_payment_failed',
      rec.client_id,
      { membershipplanname: rec.name, amount: leiText(Number(inv.amount_due) || rec.price_bani), paylink: `${base}/plata/deschide?tip=sub` },
      { data: { screen: 'subscriptions' } },
    );
  } catch (e) {
    console.error('sub_payment_failed', e);
  }
  return 'payment_failed';
}

/** Abonamentul s-a schimbat în Stripe: reînnoire oprită / pornită (din aplicație, panou sau portalul Stripe), plată căzută, încheiat. */
async function subscriptionChanged(env: Env, type: string, s: StripeSub, created: number): Promise<string> {
  if (!s.id) return 'unknown';
  const rec = await getRec(env, s.id);
  if (!rec) return 'unknown';
  if (type === 'customer.subscription.deleted' || s.status === 'canceled' || s.status === 'incomplete_expired') {
    await markEnded(env, s.id, 'stripe');
    return 'renewal_ended';
  }
  // Evenimentele pot veni în altă ordine: unul mai vechi decât ultima schimbare aplicată nu o mai strică.
  if (created && created < rec.event_at) return 'stale';
  if (rec.status === 'ended') return 'renewal_ended';
  const off = !!s.cancel_at_period_end || !!s.cancel_at;
  const status = s.status === 'past_due' || s.status === 'unpaid' || s.status === 'incomplete' ? 'past_due' : 'active';
  await env.DB.prepare(
    `UPDATE recurring_subs SET auto_renew = ?1, status = ?2, current_period_end = coalesce(?3, current_period_end),
       stopped_by = CASE WHEN ?1 = 0 THEN coalesce(stopped_by, 'client') ELSE NULL END, event_at = max(event_at, ?4), updated_at = ?5 WHERE id = ?6`,
  )
    .bind(off ? 0 : 1, status, subPeriodEnd(s), created || 0, iso(new Date()), s.id)
    .run();
  return off ? 'renewal_off' : 'renewal_on';
}

/** Toate evenimentele Stripe: plățile o singură dată merg ca până acum, cele ale abonamentelor recurente aici. */
export async function handleAnyStripeEvent(env: Env, ev: { type?: string; created?: number; data?: { object?: unknown } }, base: string): Promise<string> {
  const type = ev.type ?? '';
  const obj = ev.data?.object as Record<string, unknown> | undefined;
  if (!obj) return 'ignored';
  if (CHECKOUT_EVENTS.includes(type)) {
    const s = obj as Session;
    if (s.mode !== 'subscription') return handleStripeEvent(env, ev as { type?: string; data?: { object?: Session } });
    if (s.currency && s.currency !== 'ron') return 'not_paid';
    const paid = s.payment_status === 'paid';
    if (!paid && s.payment_status !== 'no_payment_required') return 'not_paid';
    return startRecurring(env, {
      subId: typeof s.subscription === 'string' ? s.subscription : null,
      customerId: typeof s.customer === 'string' ? s.customer : null,
      invoiceId: typeof s.invoice === 'string' && s.invoice ? s.invoice : null,
      sessionId: s.id,
      amount: Math.round(Number(s.amount_total) || 0),
      pi: null,
      meta: s.metadata ?? {},
      paid: paid && Number(s.amount_total) > 0,
    });
  }
  if (type === 'invoice.paid') return invoicePaid(env, obj as Invoice);
  if (type === 'invoice.payment_failed') return invoiceFailed(env, obj as Invoice, base);
  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') return subscriptionChanged(env, type, obj as StripeSub, Number(ev.created) || 0);
  return 'ignored';
}

/**
 * Oprește sau pornește reînnoirea automată a unei perioade (din aplicație: `clientId`; din panou: `adminId`).
 * Oprită: Stripe nu mai taxează, perioada plătită rămâne valabilă până la capăt. Pornită înainte de final: se anulează oprirea în Stripe.
 * Fără un abonament Stripe care să mai poată fi repornit (ex. plătit la salon sau încheiat), clientul primește o pagină de plată nouă,
 * cu prima plată la finalul perioadei deja plătite; din panou nu se poate (cardul îl pune doar clientul).
 */
export async function setRenewal(
  env: Env,
  subRowId: string,
  on: boolean,
  who: { clientId?: string; adminId?: string },
  checkout?: { base: string; lang?: string | null; title: (planName: string) => Promise<string> },
): Promise<{ ok: true; on: boolean; url?: string }> {
  if (!onlinePaymentsOn(env)) throw new HttpError(409, 'payments_off');
  const row = await env.DB.prepare(`SELECT id, client_id, plan_id, recurring_id, status FROM subscriptions WHERE id = ? ${who.clientId ? 'AND client_id = ?' : ''}`)
    .bind(...(who.clientId ? [subRowId, who.clientId] : [subRowId]))
    .first<{ id: string; client_id: string; plan_id: string | null; recurring_id: string | null; status: string }>();
  if (!row) throw new HttpError(404, 'not_found');
  if (row.status === 'cancelled') throw new HttpError(409, 'subscription_cancelled');
  const by = who.clientId ? 'client' : (who.adminId ?? 'admin');
  const rec = row.recurring_id ? await getRec(env, row.recurring_id) : null;
  const nowUnix = Math.floor(Date.now() / 1000);

  if (rec && rec.status !== 'ended') {
    if (!!rec.auto_renew === on) return { ok: true, on };
    const r = await stripeCall(
      env,
      'POST',
      `/v1/subscriptions/${encodeURIComponent(rec.id)}`,
      new URLSearchParams({ cancel_at_period_end: on ? 'false' : 'true' }),
      `renewal-${rec.id}-${on ? 'on' : 'off'}-${Date.now()}`,
    );
    if (r.ok) {
      await env.DB.prepare(
        `UPDATE recurring_subs SET auto_renew = ?, stopped_by = ?, current_period_end = coalesce(?, current_period_end), event_at = max(event_at, ?), updated_at = ? WHERE id = ?`,
      )
        .bind(on ? 1 : 0, on ? null : by, subPeriodEnd((r.json ?? {}) as StripeSub), nowUnix, iso(new Date()), rec.id)
        .run();
      return { ok: true, on };
    }
    // Abonamentul nu mai există în Stripe (ex. oprit după plăți căzute): îl marcăm încheiat.
    if (r.json?.error?.code === 'resource_missing' || /cancel/i.test(r.json?.error?.message ?? '')) await markEnded(env, rec.id, 'stripe');
    else {
      console.error('stripe renewal', rec.id, r.status, r.json?.error?.message);
      throw new HttpError(500, 'payment_failed');
    }
  }
  // Nimic de repornit.
  if (!on) {
    if (rec) return { ok: true, on: false };
    throw new HttpError(409, 'not_recurring');
  }
  if (!who.clientId || !checkout) throw new HttpError(409, 'renewal_needs_client');
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').bind(row.plan_id ?? '').first<PlanRow>();
  if (!plan) throw new HttpError(404, 'plan_not_found');
  const url = await createRecurringCheckout(env, { clientId: who.clientId, plan, title: await checkout.title(plan.name), base: checkout.base, lang: checkout.lang });
  if (!url) throw new HttpError(409, 'renewal_unavailable');
  return { ok: true, on: false, url };
}

/** Panoul a anulat o perioadă: dacă e ultima a abonamentului recurent, Stripe nu mai taxează (oprire imediată). */
export async function stopRecurringFor(env: Env, subRowId: string, adminId: string) {
  const row = await env.DB.prepare('SELECT recurring_id, ends_at FROM subscriptions WHERE id = ?').bind(subRowId).first<{ recurring_id: string | null; ends_at: string }>();
  if (!row?.recurring_id) return false;
  const latest = await env.DB.prepare('SELECT max(ends_at) AS e FROM subscriptions WHERE recurring_id = ?').bind(row.recurring_id).first<{ e: string | null }>();
  if (latest?.e && latest.e > row.ends_at) return false;
  const rec = await getRec(env, row.recurring_id);
  if (!rec || rec.status === 'ended') return false;
  await stripeCancelNow(env, rec.id);
  await markEnded(env, rec.id, adminId);
  return true;
}

/** Planul scos de la vânzare, iar proprietarul a ales să oprească și reînnoirile: abonații păstrează perioada plătită, fără plăți noi. */
export async function stopPlanRenewals(env: Env, planId: string, adminId: string) {
  const r = await env.DB.prepare(`SELECT id FROM recurring_subs WHERE plan_id = ? AND status != 'ended' AND auto_renew = 1`).bind(planId).all<{ id: string }>();
  let stopped = 0;
  for (const x of r.results) {
    const row = await env.DB.prepare('SELECT id FROM subscriptions WHERE recurring_id = ? ORDER BY ends_at DESC LIMIT 1').bind(x.id).first<{ id: string }>();
    if (!row) continue;
    try {
      await setRenewal(env, row.id, false, { adminId });
      stopped++;
    } catch (e) {
      console.error('stop plan renewal', x.id, e);
    }
  }
  return stopped;
}

/** Ștergerea contului (GDPR): abonamentele recurente se opresc imediat în Stripe, iar clientul Stripe (nume, e-mail) se șterge. */
export async function cancelClientRecurring(env: Env, clientId: string) {
  const r = await env.DB.prepare(`SELECT id FROM recurring_subs WHERE client_id = ? AND status != 'ended'`).bind(clientId).all<{ id: string }>();
  for (const x of r.results) {
    await stripeCancelNow(env, x.id);
    // Chiar dacă Stripe n-a răspuns acum, o reînnoire venită totuși pentru un cont șters se returnează și oprește abonamentul.
    await markEnded(env, x.id, 'gdpr');
  }
  const c = await env.DB.prepare('SELECT stripe_customer_id FROM clients WHERE id = ?').bind(clientId).first<{ stripe_customer_id: string | null }>();
  if (c?.stripe_customer_id && env.STRIPE_SECRET_KEY) {
    try {
      const d = await stripeCall(env, 'DELETE', `/v1/customers/${encodeURIComponent(c.stripe_customer_id)}`, undefined, `delcust-${c.stripe_customer_id}`);
      if (!d.ok && d.json?.error?.code !== 'resource_missing') console.error('stripe delete customer', d.status, d.json?.error?.message);
    } catch (e) {
      console.error('stripe delete customer', e);
    }
  }
  await env.DB.prepare('UPDATE clients SET stripe_customer_id = NULL WHERE id = ?').bind(clientId).run();
  return r.results.length;
}

/** „Schimbă cardul”: pagina Stripe unde clientul își schimbă cardul pentru plățile următoare (portalul de facturare din Stripe). */
export async function cardPortalUrl(env: Env, clientId: string, base: string, lang?: string | null) {
  if (!onlinePaymentsOn(env)) throw new HttpError(409, 'payments_off');
  const c = await env.DB.prepare('SELECT stripe_customer_id FROM clients WHERE id = ? AND deleted_at IS NULL').bind(clientId).first<{ stripe_customer_id: string | null }>();
  const live = await env.DB.prepare(`SELECT 1 FROM recurring_subs WHERE client_id = ? AND status != 'ended'`).bind(clientId).first();
  if (!c?.stripe_customer_id || !live) throw new HttpError(409, 'not_recurring');
  const form = new URLSearchParams({ customer: c.stripe_customer_id, return_url: `${base}/plata/deschide?tip=sub` });
  const l = LANGS.includes(lang ?? '') ? lang! : 'ro';
  form.set('locale', l);
  const r = await stripeCall(env, 'POST', '/v1/billing_portal/sessions', form, `portal-${clientId}-${Date.now()}`);
  if (!r.ok || !r.json?.url) {
    // De obicei: portalul nu e salvat încă în Stripe (Settings → Billing → Customer portal).
    console.error('stripe portal', r.status, r.json?.error?.message);
    throw new HttpError(409, 'card_change_off');
  }
  return r.json.url;
}
