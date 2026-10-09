import { Hono } from 'hono';
import { normalizePhone, requireClient } from '../auth';
import { createGiftCard, getAutomations, giftCard, type GiftCardRow } from '../growth';
import { BOOKING_SELECT, cancelBooking, createBooking } from '../bookings';
import { booking, client, emailTaken, getBusiness, type BookingRow, type ClientRow } from '../db';
import { createCheckout } from '../payments';
import { HttpError, type AppEnv } from '../env';
import { iso } from '../time';
import { attributeQr } from '../qr';
import { deleteClient, exportClient } from '../gdpr';
import { createOrder, getOrder, getOrders, notifyOrder, setOrderStatus } from '../shop';
import { myReferrals } from '../referrals';
import { mySubscriptions } from '../subscriptions';
import { joinWaitlist, myWaitlist, removeWaitlist } from '../waitlist';
import { addPhoto, deleteMediaUrl, deletePhoto, getIdentity, mediaUrl, parseBirthDate, saveMedia } from '../identity';

export const clientRoutes = new Hono<AppEnv>();
// Pe căi anume: rutele publice sunt montate tot sub /v1.
for (const p of ['/me', '/me/*', '/bookings', '/bookings/*', '/orders', '/orders/*', '/push-tokens']) clientRoutes.use(p, requireClient);

clientRoutes.get('/me', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(c.get('client').clientId).first<ClientRow>();
  if (!r) throw new HttpError(401, 'unauthorized');
  return c.json(client(r));
});

/** Clientul deja în cont a deschis aplicația dintr-un cod QR. */
clientRoutes.post('/me/qr', async (c) => {
  const b = await c.req.json<{ code?: string }>();
  await attributeQr(c.env, c.get('client').clientId, false, b.code, null);
  return c.json({ ok: true });
});

clientRoutes.patch('/me', async (c) => {
  const b = await c.req.json<{
    name?: string;
    email?: string | null;
    lang?: string;
    birthDate?: string | null;
    marketing?: { sms?: boolean; email?: boolean; push?: boolean };
  }>();
  const id = c.get('client').clientId;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.name === 'string') sets.push('name = ?'), vals.push(b.name.trim().slice(0, 80));
  if (b.email !== undefined) {
    if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw new HttpError(400, 'invalid_email');
    const me = await c.env.DB.prepare('SELECT phone, email FROM clients WHERE id = ?').bind(id).first<{ phone: string; email: string | null }>();
    // Adresa altui cont nu se poate lua (cu ea se intră în cont).
    if (b.email && b.email.toLowerCase() !== (me?.email ?? '').toLowerCase() && (await emailTaken(c.env, b.email, me?.phone ?? ''))) throw new HttpError(400, 'email_in_use');
    sets.push('email = ?'), vals.push(b.email || null);
  }
  if (b.lang && ['ro', 'en', 'fr'].includes(b.lang)) sets.push('lang = ?'), vals.push(b.lang);
  if (b.birthDate !== undefined) {
    // Data nașterii (de ea ține cadoul de ziua clientului) se pune o singură dată; o schimbare o face salonul, din panou.
    const bd = parseBirthDate(b.birthDate);
    const cur = await c.env.DB.prepare('SELECT birth_date FROM clients WHERE id = ?').bind(id).first<{ birth_date: string | null }>();
    if (cur?.birth_date && bd !== cur.birth_date) throw new HttpError(409, 'birth_date_locked');
    if (!cur?.birth_date && bd) sets.push('birth_date = ?'), vals.push(bd);
  }
  for (const ch of ['sms', 'email', 'push'] as const) {
    if (typeof b.marketing?.[ch] === 'boolean') sets.push(`marketing_${ch} = ?`), vals.push(b.marketing[ch] ? 1 : 0);
  }
  // Dovada acordului (GDPR): data ultimei schimbări a preferințelor pentru oferte.
  if (b.marketing && Object.values(b.marketing).some((v) => typeof v === 'boolean')) sets.push('marketing_consent_at = ?'), vals.push(iso(new Date()));
  if (sets.length) await c.env.DB.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  const r = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<ClientRow>();
  return c.json(client(r!));
});

// --- Poza de profil și TAF Identity ---

const mimeOf = (h: string | undefined) => (h ?? '').split(';')[0].trim().toLowerCase();

clientRoutes.put('/me/photo', async (c) => {
  const id = c.get('client').clientId;
  const mediaId = await saveMedia(c.env, mimeOf(c.req.header('Content-Type')), await c.req.arrayBuffer(), id);
  const old = await c.env.DB.prepare('SELECT photo_url FROM clients WHERE id = ?').bind(id).first<{ photo_url: string | null }>();
  await c.env.DB.prepare('UPDATE clients SET photo_url = ? WHERE id = ?').bind(mediaUrl(mediaId), id).run();
  await deleteMediaUrl(c.env, old?.photo_url ?? null);
  return c.json({ photoUrl: mediaUrl(mediaId) });
});

clientRoutes.delete('/me/photo', async (c) => {
  const id = c.get('client').clientId;
  const old = await c.env.DB.prepare('SELECT photo_url FROM clients WHERE id = ?').bind(id).first<{ photo_url: string | null }>();
  await c.env.DB.prepare('UPDATE clients SET photo_url = NULL WHERE id = ?').bind(id).run();
  await deleteMediaUrl(c.env, old?.photo_url ?? null);
  return c.json({ ok: true });
});

clientRoutes.get('/me/identity', async (c) => c.json(await getIdentity(c.env, c.get('client').clientId, false)));

clientRoutes.put('/me/identity', async (c) => {
  const b = await c.req.json<{ note?: string }>();
  const id = c.get('client').clientId;
  await c.env.DB.prepare('UPDATE clients SET identity_note = ? WHERE id = ?').bind(String(b.note ?? '').slice(0, 1000), id).run();
  return c.json(await getIdentity(c.env, id, false));
});

clientRoutes.post('/me/identity/photos', async (c) => {
  const caption = (c.req.query('caption') ?? '').trim();
  const p = await addPhoto(c.env, c.get('client').clientId, mimeOf(c.req.header('Content-Type')), await c.req.arrayBuffer(), null, caption);
  return c.json(p, 201);
});

clientRoutes.patch('/me/identity/photos/:pid', async (c) => {
  const b = await c.req.json<{ caption?: string }>();
  await c.env.DB.prepare('UPDATE client_photos SET caption = ? WHERE id = ? AND client_id = ? AND private = 0')
    .bind(String(b.caption ?? '').slice(0, 200), c.req.param('pid'), c.get('client').clientId)
    .run();
  return c.json({ ok: true });
});

clientRoutes.delete('/me/identity/photos/:pid', async (c) => {
  await deletePhoto(c.env, c.get('client').clientId, c.req.param('pid'), false);
  return c.json({ ok: true });
});

clientRoutes.get('/me/referrals', async (c) => c.json(await myReferrals(c.env, c.get('client').clientId)));
clientRoutes.get('/me/subscriptions', async (c) => c.json(await mySubscriptions(c.env, c.get('client').clientId)));

// Carduri cadou: cele cumpărate de client și cele primite pe numărul lui de telefon.
clientRoutes.get('/me/gift-cards', async (c) => {
  const id = c.get('client').clientId;
  const me = await c.env.DB.prepare('SELECT phone FROM clients WHERE id = ?').bind(id).first<{ phone: string }>();
  const r = await c.env.DB.prepare(
    `SELECT g.*, b.name AS buyer_name FROM gift_cards g LEFT JOIN clients b ON b.id = g.buyer_client_id
     WHERE (g.buyer_client_id = ? OR g.recipient_phone = ?) AND g.status != 'cancelled' ORDER BY g.created_at DESC LIMIT 50`,
  )
    .bind(id, me?.phone ?? '')
    .all<GiftCardRow>();
  const s = (await getAutomations(c.env)).giftCard;
  return c.json({
    enabled: s.enabled,
    amounts: s.amounts,
    validMonths: s.validMonths,
    bought: r.results.filter((g) => g.buyer_client_id === id).map((g) => giftCard(g, true)),
    // Cel care primește vede codul doar după ce cardul a fost plătit.
    received: r.results.filter((g) => g.recipient_phone === me?.phone && g.buyer_client_id !== id).map((g) => giftCard(g, true)),
  });
});

clientRoutes.post('/me/gift-cards', async (c) => {
  const b = await c.req.json<{ amount?: number; recipientName?: string; recipientPhone?: string; message?: string }>();
  const phone = b.recipientPhone?.trim() ? normalizePhone(b.recipientPhone) : null;
  const id = await createGiftCard(c.env, c.get('client').clientId, { ...b, recipientPhone: phone });
  return c.json({ id }, 201);
});

// Plata online: întoarce adresa paginii de plată Stripe. Codul pleacă automat după confirmarea plății.
clientRoutes.post('/me/gift-cards/:id/pay', async (c) => {
  const id = c.get('client').clientId;
  const g = await c.env.DB.prepare(`SELECT g.id, g.amount_bani, g.recipient_name, c.email FROM gift_cards g JOIN clients c ON c.id = g.buyer_client_id
     WHERE g.id = ? AND g.buyer_client_id = ? AND g.status = 'pending'`)
    .bind(c.req.param('id'), id)
    .first<{ id: string; amount_bani: number; recipient_name: string; email: string | null }>();
  if (!g) throw new HttpError(409, 'not_pending');
  const shop = (await getBusiness(c.env)).name;
  const url = await createCheckout(c.env, { kind: 'gift', ref: g.id, amountBani: g.amount_bani, title: `Card cadou ${shop} · ${g.amount_bani / 100} lei`, email: g.email });
  return c.json({ url });
});

/** Plata cu cardul a unei programări viitoare, din aplicație (prețul întreg). */
clientRoutes.post('/bookings/:id/pay', async (c) => {
  const b = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ? AND b.client_id = ?`).bind(c.req.param('id'), c.get('client').clientId).first<BookingRow>();
  if (!b) throw new HttpError(404, 'booking_not_found');
  if (b.online_paid_bani) throw new HttpError(409, 'booking_paid');
  if (b.status !== 'confirmed' || Date.parse(b.starts_at) < Date.now()) throw new HttpError(409, 'not_payable');
  if (!b.price_bani) throw new HttpError(409, 'not_payable');
  const me = await c.env.DB.prepare('SELECT email FROM clients WHERE id = ?').bind(b.client_id).first<{ email: string | null }>();
  const biz = await getBusiness(c.env);
  const url = await createCheckout(c.env, { kind: 'booking', ref: b.id, amountBani: b.price_bani, title: `${b.service_name} · ${b.barber_name} · ${biz.name}`, email: me?.email });
  return c.json({ url });
});

clientRoutes.post('/orders/:id/pay', async (c) => {
  const o = await getOrder(c.env, c.req.param('id')!);
  if (o.clientId !== c.get('client').clientId) throw new HttpError(404, 'not_found');
  if (o.paidAt) throw new HttpError(409, 'order_paid');
  if (o.status !== 'new' && o.status !== 'ready') throw new HttpError(409, 'not_payable');
  const me = await c.env.DB.prepare('SELECT email FROM clients WHERE id = ?').bind(o.clientId).first<{ email: string | null }>();
  const shop = (await getBusiness(c.env)).name;
  const url = await createCheckout(c.env, { kind: 'order', ref: o.id, amountBani: Math.round(o.total * 100), title: `Comanda ${o.code} · ${shop}`, email: me?.email });
  return c.json({ url });
});

clientRoutes.post('/me/gift-cards/:id/cancel', async (c) => {
  const r = await c.env.DB.prepare(`UPDATE gift_cards SET status = 'cancelled' WHERE id = ? AND buyer_client_id = ? AND status = 'pending'`)
    .bind(c.req.param('id'), c.get('client').clientId)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'not_pending');
  return c.json({ ok: true });
});

/** Pozele înainte / după ale clientului, puse de frizer. */
clientRoutes.get('/me/before-after', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT x.id, x.before_media, x.after_media, x.created_at, br.name AS barber_name FROM before_after x LEFT JOIN barbers br ON br.id = x.barber_id
     WHERE x.client_id = ? ORDER BY x.created_at DESC LIMIT 50`,
  )
    .bind(c.get('client').clientId)
    .all<{ id: string; before_media: string; after_media: string; created_at: string; barber_name: string | null }>();
  return c.json(r.results.map((x) => ({ id: x.id, before: mediaUrl(x.before_media), after: mediaUrl(x.after_media), barberName: x.barber_name, createdAt: x.created_at })));
});

clientRoutes.get('/me/export', async (c) => c.json(await exportClient(c.env, c.get('client').clientId)));

clientRoutes.delete('/me', async (c) => {
  await deleteClient(c.env, c.get('client').clientId);
  return c.json({ ok: true });
});

clientRoutes.get('/me/bookings', async (c) => {
  const r = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.client_id = ? ORDER BY b.starts_at DESC LIMIT 100`)
    .bind(c.get('client').clientId)
    .all<BookingRow>();
  return c.json(r.results.map(booking));
});

clientRoutes.post('/bookings', async (c) => {
  const b = await c.req.json<{ serviceId?: string; barberId?: string | null; start?: string; note?: string }>();
  if (!b.serviceId || !b.start) throw new HttpError(400, 'invalid_body');
  // Programare și anulare la nesfârșit ar trimite tot atâtea SMS-uri de confirmare: cel mult 10 programări noi pe zi.
  const today = await c.env.DB.prepare(`SELECT count(*) AS n FROM bookings WHERE client_id = ? AND source = 'app' AND created_at > ?`)
    .bind(c.get('client').clientId, iso(new Date(Date.now() - 86_400_000)))
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= 10) throw new HttpError(429, 'too_many_bookings_today');
  // Maxim 3 programări viitoare active pe client (cererile în așteptare se numără și ele), ca să nu se blocheze orele.
  const created = await createBooking(c.env, {
    maxActive: 3,
    clientId: c.get('client').clientId,
    serviceId: b.serviceId,
    barberId: b.barberId ?? null,
    start: b.start,
    note: b.note,
    source: 'app',
  });
  return c.json(created, 201);
});

// --- Lista de așteptare: „Anunță-mă dacă se eliberează un loc” ---

clientRoutes.get('/me/waitlist', async (c) => c.json(await myWaitlist(c.env, c.get('client').clientId)));

clientRoutes.post('/me/waitlist', async (c) => {
  const b = await c.req.json<{ serviceId?: string; barberId?: string | null; day?: string; part?: string }>().catch(() => ({}));
  const r = await joinWaitlist(c.env, c.get('client').clientId, b);
  return c.json(r.entry, r.created ? 201 : 200);
});

clientRoutes.delete('/me/waitlist/:id', async (c) => {
  await removeWaitlist(c.env, c.req.param('id'), 'client', { clientId: c.get('client').clientId });
  return c.json({ ok: true });
});

clientRoutes.post('/bookings/:id/cancel', async (c) => {
  return c.json(await cancelBooking(c.env, c.req.param('id'), 'client', c.get('client').clientId));
});

// --- Magazin ---

const stripClient = <T extends { clientName: string; clientPhone: string }>({ clientName: _n, clientPhone: _p, ...o }: T) => o;

clientRoutes.get('/me/orders', async (c) => c.json((await getOrders(c.env, 'o.client_id = ?', [c.get('client').clientId], 50)).map(stripClient)));

clientRoutes.post('/orders', async (c) => {
  const o = await createOrder(c.env, c.get('client').clientId, await c.req.json());
  c.executionCtx.waitUntil(notifyOrder(c.env, o.id, 'order_created').catch((e) => console.error('order_created', e)));
  return c.json(stripClient(o), 201);
});

clientRoutes.post('/orders/:id/cancel', async (c) => {
  const id = c.req.param('id')!;
  const o = await getOrder(c.env, id);
  if (o.clientId !== c.get('client').clientId) throw new HttpError(404, 'not_found');
  // O comandă plătită online se anulează doar de la salon, care returnează și banii.
  if (o.paidAt) throw new HttpError(409, 'order_paid');
  // Clientul poate anula doar până când salonul o pregătește.
  if (!(await setOrderStatus(c.env, id, 'cancelled', ['new']))) throw new HttpError(409, 'not_cancellable');
  return c.json(stripClient(await getOrder(c.env, id)));
});

clientRoutes.post('/push-tokens', async (c) => {
  const b = await c.req.json<{ token?: string; platform?: string }>();
  if (!b.token || !/^Expo(nent)?PushToken\[.+\]$/.test(b.token)) throw new HttpError(400, 'invalid_token');
  await c.env.DB.prepare(
    `INSERT INTO push_tokens (token, client_id, platform, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET client_id = excluded.client_id, platform = excluded.platform, updated_at = excluded.updated_at`,
  )
    .bind(b.token, c.get('client').clientId, (b.platform ?? '').slice(0, 20), iso(new Date()))
    .run();
  return c.json({ ok: true });
});
