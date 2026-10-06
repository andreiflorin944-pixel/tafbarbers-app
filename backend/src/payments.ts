import { timingSafeEqual } from './auth';
import { HttpError, type Env } from './env';
import { activateGiftCard } from './growth';
import { iso } from './time';

// Plata online cu cardul prin Stripe Checkout: clientul plătește pe pagina Stripe, iar Stripe ne anunță prin webhook.
// Fără STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET și PUBLIC_URL plata online e oprită și totul se plătește la salon.

export const onlinePaymentsOn = (env: Env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.PUBLIC_URL);

type Kind = 'gift' | 'order';

/** Deschide o sesiune de plată și întoarce adresa paginii Stripe. */
export async function createCheckout(env: Env, p: { kind: Kind; ref: string; amountBani: number; title: string; email?: string | null }) {
  if (!onlinePaymentsOn(env)) throw new HttpError(409, 'payments_off');
  const base = env.PUBLIC_URL!.replace(/\/+$/, '');
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'ron',
    'line_items[0][price_data][unit_amount]': String(p.amountBani),
    'line_items[0][price_data][product_data][name]': p.title,
    'metadata[kind]': p.kind,
    'metadata[ref]': p.ref,
    'payment_intent_data[metadata][kind]': p.kind,
    'payment_intent_data[metadata][ref]': p.ref,
    client_reference_id: p.ref,
    success_url: `${base}/plata/gata?tip=${p.kind}`,
    cancel_url: `${base}/plata/anulata?tip=${p.kind}`,
    // Sesiunea expiră după 30 de minute; un card neplătit rămâne „de plătit” și se poate încerca din nou.
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
  });
  if (p.email) form.set('customer_email', p.email);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `${p.ref}-${Math.floor(Date.now() / 60000)}` },
    body: form,
  });
  const j = (await r.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
  if (!r.ok || !j?.url) {
    console.error('stripe checkout', r.status, j?.error?.message);
    throw new HttpError(500, 'payment_failed');
  }
  return j.url;
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

type Session = { id: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: { kind?: string; ref?: string } };

/** Ce facem când Stripe confirmă plata. Se poate primi de mai multe ori același eveniment, deci totul e idempotent. */
export async function handleStripeEvent(env: Env, ev: { type?: string; data?: { object?: Session } }) {
  const s = ev.data?.object;
  if (!s || !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type ?? '')) return 'ignored';
  if (s.payment_status !== 'paid' || s.currency !== 'ron') return 'not_paid';
  const ref = s.metadata?.ref ?? '';
  if (s.metadata?.kind === 'gift') {
    const g = await env.DB.prepare('SELECT amount_bani, status, payment_ref FROM gift_cards WHERE id = ?').bind(ref).first<{ amount_bani: number; status: string; payment_ref: string | null }>();
    if (!g) return 'unknown';
    if (g.payment_ref === s.id) return 'duplicate';
    if (s.amount_total !== g.amount_bani) return 'amount_mismatch';
    if (g.status !== 'pending') {
      // Plătit online după ce a fost anulat sau încasat la salon: păstrăm plata ca să se vadă în panou și să se poată returna.
      await env.DB.prepare('UPDATE gift_cards SET payment_ref = ? WHERE id = ? AND payment_ref IS NULL').bind(s.id, ref).run();
      console.error('stripe: gift card already', g.status, ref);
      return 'needs_refund';
    }
    await activateGiftCard(env, ref, null, { method: 'online', ref: s.id });
    return 'gift_paid';
  }
  if (s.metadata?.kind === 'order') {
    const o = await env.DB.prepare('SELECT total_bani, status, paid_at FROM orders WHERE id = ?').bind(ref).first<{ total_bani: number; status: string; paid_at: string | null }>();
    if (!o) return 'unknown';
    if (o.paid_at) return 'duplicate';
    if (s.amount_total !== o.total_bani) return 'amount_mismatch';
    await env.DB.prepare(`UPDATE orders SET paid_at = ?, pay_method = 'online', payment_ref = ?, updated_at = ? WHERE id = ? AND paid_at IS NULL`)
      .bind(iso(new Date()), s.id, iso(new Date()), ref)
      .run();
    return o.status === 'cancelled' ? 'needs_refund' : 'order_paid';
  }
  return 'unknown';
}
