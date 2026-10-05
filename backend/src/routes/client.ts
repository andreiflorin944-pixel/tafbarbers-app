import { Hono } from 'hono';
import { requireClient } from '../auth';
import { BOOKING_SELECT, cancelBooking, createBooking } from '../bookings';
import { booking, client, type BookingRow, type ClientRow } from '../db';
import { HttpError, type AppEnv } from '../env';
import { iso } from '../time';

export const clientRoutes = new Hono<AppEnv>();
// Pe căi anume: rutele publice sunt montate tot sub /v1.
for (const p of ['/me', '/me/*', '/bookings', '/bookings/*', '/push-tokens']) clientRoutes.use(p, requireClient);

clientRoutes.get('/me', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(c.get('client').clientId).first<ClientRow>();
  if (!r) throw new HttpError(401, 'unauthorized');
  return c.json(client(r));
});

clientRoutes.patch('/me', async (c) => {
  const b = await c.req.json<{
    name?: string;
    email?: string | null;
    lang?: string;
    marketing?: { sms?: boolean; email?: boolean; push?: boolean };
  }>();
  const id = c.get('client').clientId;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.name === 'string') sets.push('name = ?'), vals.push(b.name.trim().slice(0, 80));
  if (b.email !== undefined) {
    if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw new HttpError(400, 'invalid_email');
    sets.push('email = ?'), vals.push(b.email || null);
  }
  if (b.lang && ['ro', 'en', 'fr'].includes(b.lang)) sets.push('lang = ?'), vals.push(b.lang);
  for (const ch of ['sms', 'email', 'push'] as const) {
    if (typeof b.marketing?.[ch] === 'boolean') sets.push(`marketing_${ch} = ?`), vals.push(b.marketing[ch] ? 1 : 0);
  }
  if (sets.length) await c.env.DB.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  const r = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<ClientRow>();
  return c.json(client(r!));
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
  // Maxim 3 programări viitoare active pe client, ca să nu se blocheze orele.
  const active = await c.env.DB.prepare(
    `SELECT count(*) AS n FROM bookings WHERE client_id = ? AND status = 'confirmed' AND starts_at > ?`,
  )
    .bind(c.get('client').clientId, iso(new Date()))
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= 3) throw new HttpError(409, 'too_many_active_bookings');
  const created = await createBooking(c.env, {
    clientId: c.get('client').clientId,
    serviceId: b.serviceId,
    barberId: b.barberId ?? null,
    start: b.start,
    note: b.note,
    source: 'app',
  });
  return c.json(created, 201);
});

clientRoutes.post('/bookings/:id/cancel', async (c) => {
  return c.json(await cancelBooking(c.env, c.req.param('id'), 'client', c.get('client').clientId));
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
