import { newId, timingSafeEqual } from './auth';
import { getSetting, setSetting } from './db';
import { HttpError, onlinePaymentsOn, type Env } from './env';
import { activateGiftCard } from './growth';
import { activateSubscription } from './subscriptions';
import { iso } from './time';

// Plata online cu cardul prin Stripe Checkout: clientul plătește pe pagina Stripe (card, Apple Pay, Google Pay), iar Stripe ne anunță prin webhook.
// Fără STRIPE_SECRET_KEY și STRIPE_WEBHOOK_SECRET plata online e oprită și totul se plătește la salon.
// Fiecare plată primită intră în registrul `online_payments`: păstrată, returnată pe card sau „de returnat” (când Stripe n-a putut singur).

export { onlinePaymentsOn };

export type Kind = 'gift' | 'order' | 'booking' | 'sub';
const KINDS: Kind[] = ['gift', 'order', 'booking', 'sub'];
/** Evenimentele Stripe pe care le ascultăm (se bifează la crearea webhook-ului în Stripe). */
export const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
/** Stripe nu primește plăți mai mici de 2 lei. */
export const MIN_BANI = 200;

/** Adresa publică a serverului: PUBLIC_URL dacă e pusă, altfel adresa la care a venit cererea (ex. …workers.dev). */
export const publicBase = (env: Env, reqUrl: string) => (env.PUBLIC_URL || new URL(reqUrl).origin).replace(/\/+$/, '');
const stripeApi = (env: Env) => (env.STRIPE_MOCK_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const LANGS = ['ro', 'en', 'fr'];

async function stripePost(env: Env, path: string, form: URLSearchParams, idempotencyKey: string) {
  const r = await fetch(`${stripeApi(env)}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey },
    body: form,
  });
  const json = (await r.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
  return { ok: r.ok, status: r.status, json };
}

/** Deschide o sesiune de plată și întoarce adresa paginii Stripe. `base` = adresa publică a serverului (pentru întoarcere). */
export async function createCheckout(
  env: Env,
  p: { kind: Kind; ref: string; amountBani: number; title: string; base: string; clientId: string; email?: string | null; lang?: string | null; meta?: Record<string, string> },
) {
  if (!onlinePaymentsOn(env)) throw new HttpError(409, 'payments_off');
  if (!Number.isInteger(p.amountBani) || p.amountBani < MIN_BANI) throw new HttpError(409, 'amount_too_small');
  const lang = LANGS.includes(p.lang ?? '') ? p.lang! : 'ro';
  const back = (rez: string) => `${p.base}/plata/${rez}?tip=${p.kind}&lang=${lang}`;
  const meta: Record<string, string> = { kind: p.kind, ref: p.ref, client: p.clientId, ...p.meta };
  const form = new URLSearchParams({
    mode: 'payment',
    locale: lang,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'ron',
    'line_items[0][price_data][unit_amount]': String(p.amountBani),
    'line_items[0][price_data][product_data][name]': p.title.slice(0, 250),
    client_reference_id: p.ref,
    success_url: back('gata'),
    cancel_url: back('anulata'),
    // Stripe cere cel puțin 30 de minute până la expirare (socotite la el): lăsăm 35, ca întârzierea rețelei să nu strice cererea.
    // Un card neplătit rămâne „de plătit” și se poate încerca din nou.
    expires_at: String(Math.floor(Date.now() / 1000) + 35 * 60),
  });
  for (const [k, v] of Object.entries(meta)) {
    form.set(`metadata[${k}]`, v);
    form.set(`payment_intent_data[metadata][${k}]`, v);
  }
  if (p.email) form.set('customer_email', p.email);
  // Două apăsări în același minut deschid aceeași sesiune; suma intră în cheie, ca o sumă nouă să nu fie refuzată de Stripe.
  const r = await stripePost(env, '/v1/checkout/sessions', form, `${p.kind}-${p.ref}-${p.amountBani}-${Math.floor(Date.now() / 60000)}`);
  if (!r.ok || !r.json?.url) {
    console.error('stripe checkout', r.status, r.json?.error?.message);
    throw new HttpError(500, 'payment_failed');
  }
  return r.json.url;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Verifică semnătura Stripe-Signature (t=..., v1=...) pe corpul exact primit. Acceptă o abatere de 5 minute. */
export async function verifyStripeSignature(secret: string, body: string, header: string | undefined, now = Date.now()) {
  if (!header) return false;
  const parts = header.split(',').map((x) => x.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some((s) => timingSafeEqual(s, want));
}

type Session = {
  id: string;
  payment_intent?: string | null;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  metadata?: { kind?: string; ref?: string; client?: string; plan?: string };
};
/** Ce s-a întâmplat cu plata: aplicată (păstrăm banii) sau refuzată (se returnează), cu motivul pentru panou. */
type Outcome = { ok: true; result: string; clientId?: string | null } | { ok: false; reason: string; result?: string; clientId?: string | null };

/** Ultimul webhook primit (pentru Setări → Plăți online). */
export async function noteWebhook(env: Env, key: 'stripe_webhook' | 'stripe_webhook_bad', v: Record<string, string>) {
  try {
    await setSetting(env, key, { ...v, at: iso(new Date()) });
  } catch (e) {
    console.error('note webhook', e);
  }
}

/** Ce facem când Stripe confirmă plata. Același eveniment poate veni de mai multe ori, deci totul e idempotent. */
export async function handleStripeEvent(env: Env, ev: { type?: string; data?: { object?: Session } }) {
  const s = ev.data?.object;
  if (!s || !STRIPE_EVENTS.includes(ev.type ?? '')) return 'ignored';
  if (s.payment_status !== 'paid' || s.currency !== 'ron') return 'not_paid';
  const kind = s.metadata?.kind as Kind;
  const ref = s.metadata?.ref ?? '';
  // Plăți făcute altfel în același cont Stripe (ex. linkuri de plată): nu sunt ale aplicației.
  if (!KINDS.includes(kind) || !ref || !s.id) return 'unknown';
  const pi = typeof s.payment_intent === 'string' && s.payment_intent ? s.payment_intent : null;
  const amount = Math.round(Number(s.amount_total) || 0);

  // O sesiune (și o plată Stripe) se trece o singură dată în registru; rândul „ocupă” evenimentul și pentru trimiterile în paralel.
  const seen = await env.DB.prepare('SELECT 1 FROM online_payments WHERE session_id = ?1 OR (?2 IS NOT NULL AND payment_intent = ?2)').bind(s.id, pi).first();
  if (seen) return 'duplicate';
  const id = newId('op');
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO online_payments (id, kind, ref, client_id, session_id, payment_intent, amount_bani, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid')`,
  )
    .bind(id, kind, ref, s.metadata?.client || null, s.id, pi, amount)
    .run();
  if (!claim.meta.changes) return 'duplicate';

  let out: Outcome;
  try {
    out = await applyPayment(env, kind, ref, s, pi, amount);
  } catch (e) {
    // Eroare neașteptată: scoatem rândul, ca Stripe să poată trimite din nou evenimentul (îl retrimite singur la răspuns 500).
    await env.DB.prepare('DELETE FROM online_payments WHERE id = ?').bind(id).run();
    throw e;
  }
  if (out.clientId) await env.DB.prepare('UPDATE online_payments SET client_id = ? WHERE id = ?').bind(out.clientId, id).run();
  if (out.ok) return out.result;
  // Banii nu rămân la noi fără nimic în schimb: returnare automată sau, dacă nu se poate, „de returnat” în panou.
  console.error('stripe: payment refused', kind, ref, out.reason);
  const refunded = await refundPayment(env, id, out.reason);
  return out.result ?? (refunded ? 'refunded' : 'needs_refund');
}

async function applyPayment(env: Env, kind: Kind, ref: string, s: Session, pi: string | null, amount: number): Promise<Outcome> {
  if (kind === 'gift') {
    const g = await env.DB.prepare('SELECT buyer_client_id, amount_bani, status, payment_ref FROM gift_cards WHERE id = ?')
      .bind(ref)
      .first<{ buyer_client_id: string | null; amount_bani: number; status: string; payment_ref: string | null }>();
    if (!g) return { ok: false, reason: 'Cardul cadou nu mai există' };
    const clientId = g.buyer_client_id;
    // Aplicată deja de această plată (eveniment reluat după o eroare).
    if (g.payment_ref === s.id && g.status !== 'pending') return { ok: true, result: 'gift_paid', clientId };
    if (g.status !== 'pending') return { ok: false, reason: g.status === 'cancelled' ? 'Cardul cadou fusese anulat' : 'Cardul cadou era deja plătit', clientId };
    if (amount !== g.amount_bani) return { ok: false, reason: 'Suma plătită nu se potrivește', result: 'amount_mismatch', clientId };
    try {
      await activateGiftCard(env, ref, null, { method: 'online', ref: s.id });
    } catch (e) {
      if (e instanceof HttpError && e.code === 'not_pending') return { ok: false, reason: 'Cardul cadou era deja plătit', clientId };
      throw e;
    }
    return { ok: true, result: 'gift_paid', clientId };
  }

  if (kind === 'order') {
    const o = await env.DB.prepare('SELECT client_id, total_bani, status, paid_at, payment_ref FROM orders WHERE id = ?')
      .bind(ref)
      .first<{ client_id: string; total_bani: number; status: string; paid_at: string | null; payment_ref: string | null }>();
    if (!o) return { ok: false, reason: 'Comanda nu mai există' };
    const clientId = o.client_id;
    if (o.paid_at && o.payment_ref === s.id) return { ok: true, result: 'order_paid', clientId };
    if (o.paid_at) return { ok: false, reason: 'Comanda era deja plătită (plată dublă)', clientId };
    if (amount !== o.total_bani) return { ok: false, reason: 'Suma plătită nu se potrivește', result: 'amount_mismatch', clientId };
    if (o.status !== 'new' && o.status !== 'ready') return { ok: false, reason: 'Comanda fusese anulată', clientId };
    const now = iso(new Date());
    const r = await env.DB.prepare(
      `UPDATE orders SET paid_at = ?, pay_method = 'online', payment_ref = ?, updated_at = ? WHERE id = ? AND paid_at IS NULL AND status IN ('new','ready')`,
    )
      .bind(now, s.id, now, ref)
      .run();
    if (!r.meta.changes) return { ok: false, reason: 'Comanda era deja plătită sau anulată', clientId };
    return { ok: true, result: 'order_paid', clientId };
  }

  if (kind === 'booking') {
    const b = await env.DB.prepare(
      'SELECT client_id, price_bani, status, pay_method, online_paid_bani, online_payment_ref, pay_request_bani FROM bookings WHERE id = ?',
    )
      .bind(ref)
      .first<{ client_id: string; price_bani: number; status: string; pay_method: string | null; online_paid_bani: number | null; online_payment_ref: string | null; pay_request_bani: number | null }>();
    if (!b) return { ok: false, reason: 'Programarea nu mai există' };
    const clientId = b.client_id;
    const myRef = pi ?? s.id;
    if (b.online_paid_bani && b.online_payment_ref === myRef) return { ok: true, result: 'booking_paid', clientId };
    if (b.online_paid_bani) return { ok: false, reason: 'Programarea era deja plătită online (plată dublă)', clientId };
    // Prețul întreg (plată înainte de vizită) sau suma cerută de echipă.
    if (amount !== b.price_bani && amount !== b.pay_request_bani) return { ok: false, reason: 'Suma plătită nu se potrivește', result: 'amount_mismatch', clientId };
    if (b.status === 'cancelled') return { ok: false, reason: 'Programarea fusese anulată', clientId };
    if (b.status === 'completed' && b.pay_method !== 'app') return { ok: false, reason: 'Programarea era deja încasată la salon', clientId };
    if (b.status !== 'confirmed' && b.status !== 'completed') return { ok: false, reason: 'Programarea nu mai putea fi plătită', clientId };
    // Încheiată cu „cere plata în aplicație”: acum e plătită online (registrul o trece la online, nu la numerar sau card).
    const r = await env.DB.prepare(
      `UPDATE bookings SET online_paid_bani = ?, online_payment_ref = ?, pay_method = CASE WHEN status = 'completed' AND pay_method = 'app' THEN 'online' ELSE pay_method END
       WHERE id = ? AND online_paid_bani IS NULL AND status IN ('confirmed','completed')`,
    )
      .bind(amount, myRef, ref)
      .run();
    if (!r.meta.changes) return { ok: false, reason: 'Programarea era deja plătită sau anulată', clientId };
    return { ok: true, result: 'booking_paid', clientId };
  }

  // Abonament cumpărat din aplicație: `ref` e id-ul abonamentului care se creează acum (o singură dată).
  const clientId = s.metadata?.client || null;
  const exists = await env.DB.prepare('SELECT 1 FROM subscriptions WHERE id = ?').bind(ref).first();
  if (exists) return { ok: true, result: 'sub_paid', clientId };
  const plan = await env.DB.prepare('SELECT price_bani FROM plans WHERE id = ?').bind(s.metadata?.plan ?? '').first<{ price_bani: number }>();
  if (!plan || !clientId) return { ok: false, reason: 'Abonamentul nu mai există', clientId };
  if (amount !== plan.price_bani) return { ok: false, reason: 'Suma plătită nu se potrivește (prețul abonamentului s-a schimbat)', result: 'amount_mismatch', clientId };
  try {
    await activateSubscription(env, clientId, s.metadata!.plan!, null, 'Plătit online', false, { id: ref, payMethod: 'online', anyPlan: true });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { ok: false, reason: 'Contul clientului nu mai există', clientId };
    throw e;
  }
  return { ok: true, result: 'sub_paid', clientId };
}

type PaymentRow = {
  id: string;
  kind: Kind;
  ref: string;
  client_id: string | null;
  session_id: string;
  payment_intent: string | null;
  amount_bani: number;
  status: 'paid' | 'refunded' | 'to_refund';
  note: string;
  created_at: string;
  refunded_at: string | null;
  refunded_by: string | null;
  refund_ref: string | null;
};

/** Programarea a cărei plată e aceasta: o marcăm returnată (clientul vede „returnată”). */
async function syncBookingRefund(env: Env, p: PaymentRow, at: string) {
  if (p.kind !== 'booking') return;
  await env.DB.prepare('UPDATE bookings SET online_refunded_at = ? WHERE id = ? AND online_refunded_at IS NULL AND online_payment_ref IN (?, ?)')
    .bind(at, p.ref, p.payment_intent ?? '', p.session_id)
    .run();
}

/** Returnează pe card o plată din registru. Întoarce true dacă Stripe a acceptat; altfel plata rămâne „de returnat”, cu motivul. */
/** `retry`: o nouă încercare din panou folosește altă cheie de idempotență (Stripe păstrează 24 de ore și răspunsurile cu eroare). */
export async function refundPayment(env: Env, id: string, reason: string, retry = false): Promise<boolean> {
  const p = await env.DB.prepare('SELECT * FROM online_payments WHERE id = ?').bind(id).first<PaymentRow>();
  if (!p) return false;
  if (p.status === 'refunded') return true;
  const flag = async () => {
    await env.DB.prepare(`UPDATE online_payments SET status = 'to_refund', note = ? WHERE id = ? AND status != 'refunded'`).bind(reason.slice(0, 300), id).run();
    return false;
  };
  if (!p.payment_intent?.startsWith('pi_') || !env.STRIPE_SECRET_KEY) return flag();
  let r: Awaited<ReturnType<typeof stripePost>>;
  try {
    r = await stripePost(
      env,
      '/v1/refunds',
      new URLSearchParams({ payment_intent: p.payment_intent, 'metadata[payment]': id, 'metadata[kind]': p.kind, 'metadata[ref]': p.ref }),
      retry ? `refund-${id}-${Date.now()}` : `refund-${id}`,
    );
  } catch (e) {
    console.error('stripe refund', id, e);
    return flag();
  }
  if (!r.ok) {
    console.error('stripe refund', id, r.status, r.json?.error?.message);
    return flag();
  }
  const now = iso(new Date());
  await env.DB.prepare(`UPDATE online_payments SET status = 'refunded', note = ?, refunded_at = ?, refunded_by = 'stripe', refund_ref = ? WHERE id = ?`)
    .bind(reason.slice(0, 300), now, r.json?.id ?? null, id)
    .run();
  await syncBookingRefund(env, p, now);
  return true;
}

/** Returnează toate plățile păstrate pentru ceva anulat (programare, comandă). Ce nu se poate returna singur rămâne „de returnat”. */
export async function refundFor(env: Env, kind: Kind, ref: string, reason: string) {
  const r = await env.DB.prepare(`SELECT id FROM online_payments WHERE kind = ? AND ref = ? AND status = 'paid'`).bind(kind, ref).all<{ id: string }>();
  let refunded = 0;
  for (const p of r.results) if (await refundPayment(env, p.id, reason)) refunded++;
  return { refunded, flagged: r.results.length - refunded };
}

/** Returnează plata online a unei programări anulate. Întoarce true dacă totul s-a returnat. */
export async function refundBooking(env: Env, bookingId: string, reason = 'Programare anulată'): Promise<boolean> {
  const r = await refundFor(env, 'booking', bookingId, reason);
  return r.refunded > 0 && r.flagged === 0;
}

/**
 * Anulare din panou a ceva plătit online care s-a putut folosi deja (card cadou, abonament): nefolosit, banii se returnează singuri;
 * folosit parțial, plata apare „de returnat”, iar echipa decide cât returnează (din Stripe) și o marchează returnată.
 */
export async function refundOrFlag(env: Env, kind: Kind, ref: string, reason: string, unused: boolean) {
  if (unused) return refundFor(env, kind, ref, reason);
  const r = await env.DB.prepare(`UPDATE online_payments SET status = 'to_refund', note = ? WHERE kind = ? AND ref = ? AND status = 'paid'`)
    .bind(reason.slice(0, 300), kind, ref)
    .run();
  return { refunded: 0, flagged: r.meta.changes };
}

/** Din panou: o plată „de returnat” a fost returnată de mână (din Stripe sau altfel). */
export async function markRefunded(env: Env, id: string, adminId: string) {
  const p = await env.DB.prepare('SELECT * FROM online_payments WHERE id = ?').bind(id).first<PaymentRow>();
  if (!p) throw new HttpError(404, 'not_found');
  if (p.status !== 'to_refund') throw new HttpError(409, 'not_to_refund');
  const now = iso(new Date());
  await env.DB.prepare(`UPDATE online_payments SET status = 'refunded', refunded_at = ?, refunded_by = ? WHERE id = ? AND status = 'to_refund'`).bind(now, adminId, id).run();
  await syncBookingRefund(env, p, now);
}

/** Din panou: încearcă din nou returnarea automată a unei plăți „de returnat”. */
export async function retryRefund(env: Env, id: string) {
  const p = await env.DB.prepare('SELECT status, note FROM online_payments WHERE id = ?').bind(id).first<{ status: string; note: string }>();
  if (!p) throw new HttpError(404, 'not_found');
  if (p.status !== 'to_refund') throw new HttpError(409, 'not_to_refund');
  return refundPayment(env, id, p.note || 'Returnare din panou', true);
}

const KIND_LABEL: Record<Kind, string> = { booking: 'Programare', order: 'Comandă magazin', gift: 'Card cadou', sub: 'Abonament' };
export const PAY_STATUS: Record<PaymentRow['status'], string> = { paid: 'Plătită', refunded: 'Returnată', to_refund: 'De returnat' };

/** Plățile online dintr-o perioadă (date ISO), cele mai noi primele, cu totaluri. `contacts` = include telefonul clientului. */
export async function listPayments(env: Env, f: { start: string; end: string; status?: string; kind?: string; contacts: boolean }) {
  const where = ['p.created_at >= ?', 'p.created_at < ?'];
  const vals: unknown[] = [f.start, f.end];
  if (f.status && f.status in PAY_STATUS) where.push('p.status = ?'), vals.push(f.status);
  if (f.kind && KINDS.includes(f.kind as Kind)) where.push('p.kind = ?'), vals.push(f.kind);
  const r = await env.DB.prepare(
    `SELECT p.*, c.name AS client_name, c.phone AS client_phone, s.name AS service_name, b.starts_at AS booking_start, sb.name AS sub_name, g.code AS gift_code,
       coalesce(nullif(a.name, ''), a.email) AS refunded_by_name
     FROM online_payments p LEFT JOIN clients c ON c.id = p.client_id
     LEFT JOIN bookings b ON p.kind = 'booking' AND b.id = p.ref LEFT JOIN services s ON s.id = b.service_id
     LEFT JOIN subscriptions sb ON p.kind = 'sub' AND sb.id = p.ref
     LEFT JOIN gift_cards g ON p.kind = 'gift' AND g.id = p.ref
     LEFT JOIN admins a ON a.id = p.refunded_by
     WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 2000`,
  )
    .bind(...vals)
    .all<PaymentRow & { client_name: string | null; client_phone: string | null; service_name: string | null; booking_start: string | null; sub_name: string | null; gift_code: string | null; refunded_by_name: string | null }>();
  const items = r.results.map((p) => ({
    id: p.id,
    kind: p.kind,
    kindLabel: KIND_LABEL[p.kind],
    ref: p.ref,
    what:
      p.kind === 'booking'
        ? (p.service_name ?? 'Programare')
        : p.kind === 'order'
          ? `Comanda ${p.ref.slice(-5).toUpperCase()}`
          : p.kind === 'gift'
            ? `Card cadou${p.gift_code ? ` ${p.gift_code}` : ''}`
            : `Abonament${p.sub_name ? `: ${p.sub_name}` : ''}`,
    bookingStart: p.booking_start,
    clientId: p.client_id,
    clientName: p.client_name ?? '',
    ...(f.contacts && { clientPhone: p.client_phone?.startsWith('deleted:') ? '' : (p.client_phone ?? '') }),
    amount: p.amount_bani / 100,
    status: p.status,
    note: p.note,
    // Referința Stripe: plata (pi_…) dacă o avem, altfel sesiunea (cs_…).
    stripeRef: p.payment_intent ?? p.session_id,
    refundRef: p.refund_ref,
    createdAt: p.created_at,
    refundedAt: p.refunded_at,
    refundedBy: p.refunded_by === 'stripe' ? 'automat (Stripe)' : (p.refunded_by_name ?? (p.refunded_by ? 'echipa' : null)),
  }));
  const sum = (st: string) => items.filter((x) => x.status === st).reduce((n, x) => n + Math.round(x.amount * 100), 0) / 100;
  return {
    items,
    totals: { count: items.length, paid: sum('paid'), refunded: sum('refunded'), toRefund: sum('to_refund'), toRefundCount: items.filter((x) => x.status === 'to_refund').length },
  };
}

/** Starea plăților online pentru Setări: ce lipsește (doar da/nu), modul cheii (test/live, niciodată cheia), adresa webhook-ului. */
export async function paymentsStatus(env: Env, reqUrl: string) {
  const key = env.STRIPE_SECRET_KEY ?? '';
  const mode = !key ? null : /^(sk|rk)_test_/.test(key) ? 'test' : /^(sk|rk)_live_/.test(key) ? 'live' : 'unknown';
  const base = publicBase(env, reqUrl);
  const [last, bad, open] = await Promise.all([
    getSetting<{ at?: string; type?: string; result?: string }>(env, 'stripe_webhook', {}),
    getSetting<{ at?: string }>(env, 'stripe_webhook_bad', {}),
    env.DB.prepare(`SELECT count(*) AS n, coalesce(sum(amount_bani), 0) AS s FROM online_payments WHERE status = 'to_refund'`).first<{ n: number; s: number }>(),
  ]);
  return {
    on: onlinePaymentsOn(env),
    missing: { STRIPE_SECRET_KEY: !env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: !env.STRIPE_WEBHOOK_SECRET, PUBLIC_URL: !env.PUBLIC_URL },
    mode,
    base,
    webhookUrl: `${base}/v1/payments/stripe`,
    events: STRIPE_EVENTS,
    lastWebhookAt: last.at ?? null,
    lastWebhookType: last.type ?? null,
    lastWebhookResult: last.result ?? null,
    lastBadSignatureAt: bad.at ?? null,
    toRefund: { count: open?.n ?? 0, amount: (open?.s ?? 0) / 100 },
  };
}
