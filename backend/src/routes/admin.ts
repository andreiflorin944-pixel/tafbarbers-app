import { Hono, type Context, type Next } from 'hono';
import {
  createSession,
  deleteSession,
  hashPassword,
  newId,
  normalizePhone,
  requireAdmin,
  timingSafeEqual,
  tokenFrom,
  verifyPassword,
} from '../auth';
import { BOOKING_SELECT, cancelBooking, createBooking, getBooking } from '../bookings';
import {
  barber,
  booking,
  client,
  getBusiness,
  promo,
  service,
  setSetting,
  type BarberRow,
  type BookingRow,
  type ClientRow,
  type PromoRow,
  type ServiceRow,
} from '../db';
import { HttpError, PERMS, parsePerms, type AppEnv, type Perm } from '../env';
import { runCampaign } from '../campaigns';
import { iso, isDay, localToUtc } from '../time';

export const adminRoutes = new Hono<AppEnv>();

// --- Autentificare ---

/** Primul cont de admin. Merge o singură dată și cere ADMIN_SETUP_KEY (secret în Cloudflare). */
adminRoutes.post('/setup', async (c) => {
  const b = await c.req.json<{ setupKey?: string; email?: string; password?: string; name?: string }>();
  if (!c.env.ADMIN_SETUP_KEY || !timingSafeEqual(String(b.setupKey ?? ''), c.env.ADMIN_SETUP_KEY))
    throw new HttpError(403, 'forbidden');
  const n = await c.env.DB.prepare('SELECT count(*) AS n FROM admins').first<{ n: number }>();
  if ((n?.n ?? 0) > 0) throw new HttpError(409, 'already_set_up');
  const email = validEmail(b.email);
  validPassword(b.password);
  const id = newId('ad');
  await c.env.DB.prepare('INSERT INTO admins (id, email, name, password_hash) VALUES (?, ?, ?, ?)')
    .bind(id, email, (b.name ?? '').slice(0, 80), await hashPassword(b.password!))
    .run();
  return c.json({ token: await createSession(c.env.DB, 'admin', id) }, 201);
});

adminRoutes.post('/login', async (c) => {
  const b = await c.req.json<{ email?: string; password?: string }>();
  const a = await c.env.DB.prepare('SELECT id, password_hash FROM admins WHERE email = ?')
    .bind(String(b.email ?? '').trim().toLowerCase())
    .first<{ id: string; password_hash: string }>();
  // Verificăm parola și când contul nu există, ca timpul de răspuns să nu-l dea de gol.
  const ok = await verifyPassword(String(b.password ?? ''), a?.password_hash ?? DUMMY_HASH);
  if (!a || !ok) throw new HttpError(401, 'wrong_credentials');
  return c.json({ token: await createSession(c.env.DB, 'admin', a.id) });
});

const DUMMY_HASH = 'pbkdf2$100000$00000000000000000000000000000000$' + '0'.repeat(64);

adminRoutes.use('*', requireAdmin);

adminRoutes.post('/logout', async (c) => {
  const t = tokenFrom(c);
  if (t) await deleteSession(c.env.DB, t);
  return c.json({ ok: true });
});

adminRoutes.get('/me', async (c) => {
  const a = await c.env.DB.prepare('SELECT id, email, name, barber_id FROM admins WHERE id = ?')
    .bind(c.get('admin').adminId)
    .first<{ id: string; email: string; name: string; barber_id: string | null }>();
  const s = c.get('admin');
  return c.json({ id: a!.id, email: a!.email, name: a!.name, barberId: a!.barber_id, owner: s.owner, permissions: s.perms });
});

/** Catalogul, campaniile și setările sunt doar pentru proprietar. */
async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}

function need(c: Context<AppEnv>, perm: Perm) {
  if (!c.get('admin').perms[perm]) throw new HttpError(403, 'no_permission');
}

/** Frizerul fără dreptul „bookings_all” lucrează doar pe programările lui. */
function ownBarber(c: Context<AppEnv>): string | null {
  const a = c.get('admin');
  return a.perms.bookings_all ? null : a.barberId;
}

function cleanPerms(raw: unknown): Record<string, boolean> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(PERMS.filter((p) => typeof o[p] === 'boolean').map((p) => [p, o[p] as boolean]));
}

// --- Echipa (conturi admin) ---

adminRoutes.get('/admins', ownerOnly, async (c) => {
  const r = await c.env.DB.prepare('SELECT id, email, name, barber_id, permissions FROM admins ORDER BY email').all();
  return c.json(
    r.results.map((a: any) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      barberId: a.barber_id,
      permissions: parsePerms(a.permissions, !a.barber_id),
    })),
  );
});

adminRoutes.post('/admins', ownerOnly, async (c) => {
  const b = await c.req.json<{ email?: string; password?: string; name?: string; barberId?: string | null; permissions?: unknown }>();
  const email = validEmail(b.email);
  validPassword(b.password);
  const id = newId('ad');
  await c.env.DB.prepare('INSERT INTO admins (id, email, name, password_hash, barber_id, permissions) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, email, (b.name ?? '').slice(0, 80), await hashPassword(b.password!), b.barberId || null, JSON.stringify(cleanPerms(b.permissions)))
    .run()
    .catch(() => {
      throw new HttpError(409, 'email_taken');
    });
  return c.json({ id }, 201);
});

adminRoutes.patch('/admins/:id', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const b = await c.req.json<{ name?: string; barberId?: string | null; permissions?: unknown; password?: string }>();
  if (id === c.get('admin').adminId && b.barberId) throw new HttpError(400, 'cannot_demote_self');
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.name !== undefined) sets.push('name = ?'), vals.push(String(b.name).slice(0, 80));
  if (b.barberId !== undefined) sets.push('barber_id = ?'), vals.push(b.barberId || null);
  if (b.permissions !== undefined) sets.push('permissions = ?'), vals.push(JSON.stringify(cleanPerms(b.permissions)));
  if (b.password) {
    validPassword(b.password);
    sets.push('password_hash = ?'), vals.push(await hashPassword(b.password));
  }
  if (sets.length) await c.env.DB.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ ok: true });
});

adminRoutes.post('/me/password', async (c) => {
  const b = await c.req.json<{ current?: string; next?: string }>();
  const a = await c.env.DB.prepare('SELECT password_hash FROM admins WHERE id = ?')
    .bind(c.get('admin').adminId)
    .first<{ password_hash: string }>();
  if (!(await verifyPassword(String(b.current ?? ''), a!.password_hash))) throw new HttpError(400, 'wrong_password');
  validPassword(b.next);
  await c.env.DB.prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(b.next!), c.get('admin').adminId)
    .run();
  return c.json({ ok: true });
});

adminRoutes.delete('/admins/:id', ownerOnly, async (c) => {
  if (c.req.param('id')! === c.get('admin').adminId) throw new HttpError(400, 'cannot_delete_self');
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM sessions WHERE kind = 'admin' AND subject_id = ?`).bind(c.req.param('id')!),
    c.env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(c.req.param('id')!),
  ]);
  return c.json({ ok: true });
});

// --- Setări salon ---

adminRoutes.get('/settings', async (c) => c.json(await getBusiness(c.env)));
adminRoutes.put('/settings', ownerOnly, async (c) => {
  const cur = await getBusiness(c.env);
  const b = await c.req.json<Record<string, unknown>>();
  const allowed = [
    'name', 'tagline', 'description', 'address', 'phone', 'website', 'instagram', 'facebook', 'tiktok',
    'slotStepMin', 'cancelHours', 'minLeadMin', 'maxDaysAhead', 'cancellationPolicy',
  ];
  const next = { ...cur } as Record<string, unknown>;
  for (const k of allowed) if (k in b) next[k] = b[k];
  await setSetting(c.env, 'business', next);
  return c.json(next);
});

// --- Servicii ---

adminRoutes.get('/services', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM services ORDER BY sort, name').all<ServiceRow>();
  return c.json(r.results.map(service));
});

adminRoutes.post('/services', ownerOnly, async (c) => {
  const b = await c.req.json<ServiceInput>();
  const id = newId('svc');
  const v = serviceValues(b, true);
  await c.env.DB.prepare(
    'INSERT INTO services (id, name, description, duration_min, price_bani, color, image_url, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, v.name, v.description ?? '', v.duration_min, v.price_bani, v.color ?? '#3B3FE0', v.image_url ?? null, v.sort ?? 0, v.active ?? 1)
    .run();
  // Serviciu nou: implicit îl fac toți frizerii.
  await c.env.DB.prepare('INSERT INTO barber_services (barber_id, service_id) SELECT id, ? FROM barbers').bind(id).run();
  return c.json(service((await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(id).first<ServiceRow>())!), 201);
});

adminRoutes.patch('/services/:id', ownerOnly, async (c) => {
  const v = serviceValues(await c.req.json<ServiceInput>(), false);
  await update(c.env.DB, 'services', c.req.param('id')!, v);
  const r = await c.env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(c.req.param('id')!).first<ServiceRow>();
  if (!r) throw new HttpError(404, 'not_found');
  return c.json(service(r));
});

// Ștergerea unui serviciu cu istoric îl dezactivează, ca programările vechi să-și păstreze numele.
adminRoutes.delete('/services/:id', ownerOnly, async (c) => {
  const used = await c.env.DB.prepare('SELECT 1 FROM bookings WHERE service_id = ? LIMIT 1').bind(c.req.param('id')!).first();
  if (used) await c.env.DB.prepare('UPDATE services SET active = 0 WHERE id = ?').bind(c.req.param('id')!).run();
  else await c.env.DB.prepare('DELETE FROM services WHERE id = ?').bind(c.req.param('id')!).run();
  return c.json({ ok: true, deactivated: !!used });
});

type ServiceInput = {
  name?: string;
  description?: string;
  durationMin?: number;
  price?: number;
  color?: string;
  imageUrl?: string | null;
  sort?: number;
  active?: boolean;
};
function serviceValues(b: ServiceInput, create: boolean) {
  const v: Record<string, unknown> = {};
  if (b.name !== undefined || create) {
    if (!b.name?.trim()) throw new HttpError(400, 'name_required');
    v.name = b.name.trim().slice(0, 120);
  }
  if (b.durationMin !== undefined || create) {
    if (!Number.isInteger(b.durationMin) || b.durationMin! < 5 || b.durationMin! > 480) throw new HttpError(400, 'invalid_duration');
    v.duration_min = b.durationMin;
  }
  if (b.price !== undefined || create) {
    if (typeof b.price !== 'number' || b.price < 0) throw new HttpError(400, 'invalid_price');
    v.price_bani = Math.round(b.price * 100);
  }
  if (b.description !== undefined) v.description = String(b.description).slice(0, 2000);
  if (b.color !== undefined) v.color = String(b.color).slice(0, 20);
  if (b.imageUrl !== undefined) v.image_url = b.imageUrl;
  if (b.sort !== undefined) v.sort = Number(b.sort) || 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v as { name: string; description?: string; duration_min: number; price_bani: number; color?: string; image_url?: string | null; sort?: number; active?: number };
}

// --- Frizeri, programul și serviciile lor ---

const BARBER_SELECT = `SELECT b.*, (SELECT group_concat(service_id) FROM barber_services WHERE barber_id = b.id) AS service_ids FROM barbers b`;

adminRoutes.get('/barbers', async (c) => {
  const [r, h] = await Promise.all([
    c.env.DB.prepare(`${BARBER_SELECT} ORDER BY b.sort, b.name`).all<BarberRow>(),
    c.env.DB.prepare('SELECT barber_id, weekday, start_min, end_min FROM working_hours ORDER BY weekday, start_min').all<{
      barber_id: string;
      weekday: number;
      start_min: number;
      end_min: number;
    }>(),
  ]);
  return c.json(
    r.results.map((b) => ({
      ...barber(b),
      hours: h.results.filter((x) => x.barber_id === b.id).map((x) => ({ weekday: x.weekday, start: x.start_min, end: x.end_min })),
    })),
  );
});

type BarberInput = {
  name?: string;
  role?: string;
  bio?: string;
  photoUrl?: string | null;
  sort?: number;
  active?: boolean;
  serviceIds?: string[];
  hours?: Array<{ weekday: number; start: number; end: number }>;
};

adminRoutes.post('/barbers', ownerOnly, async (c) => {
  const b = await c.req.json<BarberInput>();
  if (!b.name?.trim()) throw new HttpError(400, 'name_required');
  const id = newId('br');
  await c.env.DB.prepare('INSERT INTO barbers (id, name, role, bio, photo_url, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, b.name.trim().slice(0, 80), (b.role ?? 'Barber').slice(0, 60), (b.bio ?? '').slice(0, 1000), b.photoUrl ?? null, b.sort ?? 0)
    .run();
  await saveBarberRelations(c.env.DB, id, {
    serviceIds: b.serviceIds ?? (await c.env.DB.prepare('SELECT id FROM services').all<{ id: string }>()).results.map((s) => s.id),
    hours: b.hours,
  });
  return c.json({ id }, 201);
});

adminRoutes.patch('/barbers/:id', ownerOnly, async (c) => {
  const b = await c.req.json<BarberInput>();
  const id = c.req.param('id')!;
  const v: Record<string, unknown> = {};
  if (b.name !== undefined) v.name = String(b.name).trim().slice(0, 80);
  if (b.role !== undefined) v.role = String(b.role).slice(0, 60);
  if (b.bio !== undefined) v.bio = String(b.bio).slice(0, 1000);
  if (b.photoUrl !== undefined) v.photo_url = b.photoUrl;
  if (b.sort !== undefined) v.sort = Number(b.sort) || 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  await update(c.env.DB, 'barbers', id, v);
  await saveBarberRelations(c.env.DB, id, b);
  return c.json({ ok: true });
});

adminRoutes.delete('/barbers/:id', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const used = await c.env.DB.prepare('SELECT 1 FROM bookings WHERE barber_id = ? LIMIT 1').bind(id).first();
  if (used) await c.env.DB.prepare('UPDATE barbers SET active = 0 WHERE id = ?').bind(id).run();
  else await c.env.DB.prepare('DELETE FROM barbers WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deactivated: !!used });
});

async function saveBarberRelations(db: D1Database, id: string, b: Pick<BarberInput, 'serviceIds' | 'hours'>) {
  const stmts: D1PreparedStatement[] = [];
  if (b.serviceIds) {
    stmts.push(db.prepare('DELETE FROM barber_services WHERE barber_id = ?').bind(id));
    for (const s of b.serviceIds) stmts.push(db.prepare('INSERT INTO barber_services (barber_id, service_id) VALUES (?, ?)').bind(id, s));
  }
  if (b.hours) {
    for (const h of b.hours) {
      if (!(h.weekday >= 0 && h.weekday <= 6 && h.start >= 0 && h.end <= 1440 && h.end > h.start)) throw new HttpError(400, 'invalid_hours');
    }
    stmts.push(db.prepare('DELETE FROM working_hours WHERE barber_id = ?').bind(id));
    for (const h of b.hours)
      stmts.push(db.prepare('INSERT INTO working_hours (barber_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)').bind(id, h.weekday, h.start, h.end));
  }
  if (stmts.length) await db.batch(stmts);
}

// --- Concedii / zile libere ---

adminRoutes.get('/time-off', async (c) => {
  const from = c.req.query('from') ?? iso(new Date(Date.now() - 7 * 86_400_000));
  const r = await c.env.DB.prepare('SELECT * FROM time_off WHERE ends_at > ? ORDER BY starts_at').bind(from).all();
  return c.json(
    r.results.map((t: any) => ({ id: t.id, barberId: t.barber_id, start: t.starts_at, end: t.ends_at, reason: t.reason })),
  );
});

/** Acceptă fie ISO {start,end}, fie zile locale {fromDay,toDay} (zile întregi, inclusiv). */
adminRoutes.post('/time-off', async (c) => {
  const b = await c.req.json<{ barberId?: string | null; start?: string; end?: string; fromDay?: string; toDay?: string; reason?: string }>();
  need(c, 'timeoff');
  const scoped = c.get('admin').owner ? null : c.get('admin').barberId;
  const barberId = scoped ?? (b.barberId || null);
  let start: string, end: string;
  if (isDay(b.fromDay) && isDay(b.toDay)) {
    start = iso(localToUtc(c.env.TIMEZONE, b.fromDay, 0));
    end = iso(localToUtc(c.env.TIMEZONE, b.toDay, 1440));
  } else {
    if (!b.start || !b.end || Number.isNaN(Date.parse(b.start)) || Number.isNaN(Date.parse(b.end))) throw new HttpError(400, 'invalid_range');
    start = iso(new Date(b.start));
    end = iso(new Date(b.end));
  }
  if (end <= start) throw new HttpError(400, 'invalid_range');
  const r = await c.env.DB.prepare('INSERT INTO time_off (barber_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?)')
    .bind(barberId, start, end, (b.reason ?? '').slice(0, 200))
    .run();
  return c.json({ id: r.meta.last_row_id }, 201);
});

adminRoutes.delete('/time-off/:id', async (c) => {
  need(c, 'timeoff');
  const scoped = c.get('admin').owner ? null : c.get('admin').barberId;
  await c.env.DB.prepare(`DELETE FROM time_off WHERE id = ? ${scoped ? 'AND barber_id = ?' : ''}`)
    .bind(...(scoped ? [c.req.param('id')!, scoped] : [c.req.param('id')!]))
    .run();
  return c.json({ ok: true });
});

// --- Programări ---

/** GET /bookings?from=ISO&to=ISO&barberId=…&status=… */
adminRoutes.get('/bookings', async (c) => {
  const q = c.req.query();
  const where = ['b.starts_at >= ?', 'b.starts_at < ?'];
  const vals: unknown[] = [q.from ?? iso(new Date(Date.now() - 86_400_000)), q.to ?? iso(new Date(Date.now() + 30 * 86_400_000))];
  const barberId = ownBarber(c) ?? q.barberId;
  if (barberId) where.push('b.barber_id = ?'), vals.push(barberId);
  if (q.status) where.push('b.status = ?'), vals.push(q.status);
  const r = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.starts_at LIMIT 1000`)
    .bind(...vals)
    .all<BookingRow>();
  return c.json(r.results.map(booking));
});

/** Programare făcută din panou (telefon/walk-in). Clientul se creează după număr dacă nu există. */
adminRoutes.post('/bookings', async (c) => {
  const b = await c.req.json<{
    phone?: string;
    name?: string;
    serviceId?: string;
    barberId?: string | null;
    start?: string;
    note?: string;
    force?: boolean;
    notify?: boolean;
  }>();
  need(c, 'bookings_create');
  if (!b.serviceId || !b.start) throw new HttpError(400, 'invalid_body');
  const phone = normalizePhone(b.phone);
  let cl = await c.env.DB.prepare('SELECT id, name FROM clients WHERE phone = ?').bind(phone).first<{ id: string; name: string }>();
  if (!cl) {
    cl = { id: newId('cl'), name: (b.name ?? '').trim() };
    await c.env.DB.prepare('INSERT INTO clients (id, phone, name) VALUES (?, ?, ?)').bind(cl.id, phone, cl.name.slice(0, 80)).run();
  } else if (!cl.name && b.name?.trim()) {
    await c.env.DB.prepare('UPDATE clients SET name = ? WHERE id = ?').bind(b.name.trim().slice(0, 80), cl.id).run();
  }
  const barberId = ownBarber(c) ?? b.barberId ?? null;
  const created = await createBooking(c.env, {
    clientId: cl.id,
    serviceId: b.serviceId,
    barberId,
    start: b.start,
    note: b.note,
    source: 'admin',
    skipAvailabilityCheck: !!b.force && !!barberId,
    notify: b.notify !== false,
  });
  return c.json(created, 201);
});

adminRoutes.patch('/bookings/:id', async (c) => {
  const id = c.req.param('id')!;
  const cur = await getBooking(c.env, id);
  need(c, 'bookings_manage');
  const scoped = ownBarber(c);
  if (!cur || (scoped && cur.barberId !== scoped)) throw new HttpError(404, 'not_found');
  const b = await c.req.json<{ status?: string; note?: string }>();
  if (b.status === 'cancelled') return c.json(await cancelBooking(c.env, id, 'admin'));
  const v: Record<string, unknown> = {};
  if (b.status) {
    if (!['confirmed', 'completed', 'no_show'].includes(b.status)) throw new HttpError(400, 'invalid_status');
    v.status = b.status;
  }
  if (b.note !== undefined) v.note = String(b.note).slice(0, 500);
  await update(c.env.DB, 'bookings', id, v);
  return c.json(await getBooking(c.env, id));
});

// --- Clienți ---

adminRoutes.get('/clients', async (c) => {
  need(c, 'clients');
  const q = (c.req.query('q') ?? '').trim();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const r = await c.env.DB.prepare(
    `SELECT c.*,
       (SELECT count(*) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS visits,
       (SELECT max(starts_at) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS last_visit
     FROM clients c ${q ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : ''}
     ORDER BY c.created_at DESC LIMIT 500`,
  )
    .bind(...(q ? [like, like, like] : []))
    .all<ClientRow & { visits: number; last_visit: string | null }>();
  return c.json(r.results.map((x) => ({ ...client(x), visits: x.visits, lastVisit: x.last_visit })));
});

adminRoutes.get('/clients/:id', async (c) => {
  need(c, 'clients');
  const id = c.req.param('id')!;
  const r = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<ClientRow>();
  if (!r) throw new HttpError(404, 'not_found');
  const bk = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.client_id = ? ORDER BY b.starts_at DESC LIMIT 200`).bind(id).all<BookingRow>();
  return c.json({ ...client(r), bookings: bk.results.map(booking) });
});

adminRoutes.patch('/clients/:id', async (c) => {
  need(c, 'clients');
  const b = await c.req.json<{ name?: string; email?: string | null; notes?: string }>();
  const v: Record<string, unknown> = {};
  if (b.name !== undefined) v.name = String(b.name).slice(0, 80);
  if (b.email !== undefined) v.email = b.email || null;
  if (b.notes !== undefined) v.notes = String(b.notes).slice(0, 2000);
  await update(c.env.DB, 'clients', c.req.param('id')!, v);
  return c.json({ ok: true });
});

// --- Bannere de marketing ---

adminRoutes.get('/promos', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM promos ORDER BY sort').all<PromoRow>();
  return c.json(r.results.map((p) => promo(p)));
});

type PromoInput = {
  kicker?: string;
  title?: string;
  text?: string;
  cta?: string;
  icon?: string;
  action?: { type: 'service'; serviceId: string } | { type: 'url'; url: string } | { type: 'book' };
  translations?: Record<string, Record<string, string>>;
  startsAt?: string | null;
  endsAt?: string | null;
  sort?: number;
  active?: boolean;
};
function promoValues(b: PromoInput, create: boolean) {
  const v: Record<string, unknown> = {};
  for (const k of ['kicker', 'title', 'cta'] as const) {
    if (b[k] !== undefined || create) {
      if (!b[k]?.trim()) throw new HttpError(400, `${k}_required`);
      v[k] = b[k]!.trim().slice(0, 160);
    }
  }
  if (b.text !== undefined) v.text = String(b.text).slice(0, 400);
  if (b.icon !== undefined) v.icon = ['pricetag', 'flame', 'school', 'bag-handle'].includes(b.icon) ? b.icon : 'pricetag';
  if (b.action !== undefined || create) {
    const a = b.action ?? { type: 'book' };
    v.action_type = a.type;
    v.action_value = a.type === 'service' ? a.serviceId : a.type === 'url' ? a.url : null;
  }
  if (b.translations !== undefined) v.translations = JSON.stringify(b.translations ?? {});
  if (b.startsAt !== undefined) v.starts_at = b.startsAt;
  if (b.endsAt !== undefined) v.ends_at = b.endsAt;
  if (b.sort !== undefined) v.sort = Number(b.sort) || 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v;
}

adminRoutes.post('/promos', ownerOnly, async (c) => {
  const v = promoValues(await c.req.json<PromoInput>(), true);
  const id = newId('pr');
  const cols = ['id', ...Object.keys(v)];
  await c.env.DB.prepare(`INSERT INTO promos (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(id, ...Object.values(v))
    .run();
  return c.json({ id }, 201);
});

adminRoutes.patch('/promos/:id', ownerOnly, async (c) => {
  await update(c.env.DB, 'promos', c.req.param('id')!, promoValues(await c.req.json<PromoInput>(), false));
  return c.json({ ok: true });
});

adminRoutes.delete('/promos/:id', ownerOnly, async (c) => {
  await c.env.DB.prepare('DELETE FROM promos WHERE id = ?').bind(c.req.param('id')!).run();
  return c.json({ ok: true });
});

// --- Campanii (push / e-mail / SMS) ---

adminRoutes.get('/campaigns', ownerOnly, async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100').all();
  return c.json(r.results);
});

/** Numărul de clienți care ar primi campania (au acceptat canalul și au contact). */
adminRoutes.get('/campaigns/audience', ownerOnly, async (c) => {
  const db = c.env.DB;
  const [push, email, sms] = await Promise.all([
    db.prepare('SELECT count(DISTINCT p.client_id) AS n FROM push_tokens p JOIN clients c ON c.id = p.client_id WHERE c.marketing_push = 1').first<{ n: number }>(),
    db.prepare(`SELECT count(*) AS n FROM clients WHERE marketing_email = 1 AND email IS NOT NULL AND email != ''`).first<{ n: number }>(),
    db.prepare('SELECT count(*) AS n FROM clients WHERE marketing_sms = 1').first<{ n: number }>(),
  ]);
  return c.json({ push: push?.n ?? 0, email: email?.n ?? 0, sms: sms?.n ?? 0 });
});

adminRoutes.post('/campaigns', ownerOnly, async (c) => {
  const b = await c.req.json<{ channel?: string; title?: string; body?: string; scheduledAt?: string | null; sendNow?: boolean }>();
  if (!['push', 'email', 'sms'].includes(b.channel ?? '')) throw new HttpError(400, 'invalid_channel');
  if (!b.title?.trim() || !b.body?.trim()) throw new HttpError(400, 'title_and_body_required');
  const id = newId('cmp');
  const status = b.sendNow ? 'sending' : b.scheduledAt ? 'scheduled' : 'draft';
  await c.env.DB.prepare('INSERT INTO campaigns (id, channel, title, body, status, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, b.channel, b.title.trim().slice(0, 120), b.body.trim().slice(0, 5000), status, b.scheduledAt ?? null)
    .run();
  if (b.sendNow) c.executionCtx.waitUntil(runCampaign(c.env, id));
  return c.json({ id, status }, 201);
});

adminRoutes.post('/campaigns/:id/send', ownerOnly, async (c) => {
  const r = await c.env.DB.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ? AND status IN ('draft','scheduled')`)
    .bind(c.req.param('id')!)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'not_sendable');
  c.executionCtx.waitUntil(runCampaign(c.env, c.req.param('id')!));
  return c.json({ ok: true });
});

// --- Tablou de bord ---

adminRoutes.get('/stats', async (c) => {
  const scoped = ownBarber(c);
  const showMoney = c.get('admin').perms.stats;
  const f = scoped ? 'AND barber_id = ?' : '';
  const args = (...a: unknown[]) => (scoped ? [...a, scoped] : a);
  const now = new Date();
  const dayAgo30 = iso(new Date(now.getTime() - 30 * 86_400_000));
  const db = c.env.DB;
  const [upcoming, month, clients, messages] = await Promise.all([
    db.prepare(`SELECT count(*) AS n FROM bookings WHERE status = 'confirmed' AND starts_at > ? ${f}`).bind(...args(iso(now))).first<{ n: number }>(),
    db
      .prepare(
        `SELECT count(*) AS n, coalesce(sum(price_bani), 0) AS revenue,
           sum(status = 'cancelled') AS cancelled, sum(status = 'no_show') AS no_show
         FROM bookings WHERE starts_at >= ? AND starts_at < ? ${f}`,
      )
      .bind(...args(dayAgo30, iso(now)))
      .first<{ n: number; revenue: number; cancelled: number; no_show: number }>(),
    db.prepare('SELECT count(*) AS n FROM clients WHERE created_at >= ?').bind(dayAgo30).first<{ n: number }>(),
    db.prepare(`SELECT channel, count(*) AS n FROM message_log WHERE created_at >= ? AND status = 'sent' GROUP BY channel`).bind(dayAgo30).all<{ channel: string; n: number }>(),
  ]);
  return c.json({
    upcoming: upcoming?.n ?? 0,
    last30: {
      bookings: month?.n ?? 0,
      revenue: showMoney ? (month?.revenue ?? 0) / 100 : null,
      cancelled: month?.cancelled ?? 0,
      noShow: month?.no_show ?? 0,
      newClients: c.get('admin').perms.clients ? (clients?.n ?? 0) : null,
      messages: Object.fromEntries(messages.results.map((m) => [m.channel, m.n])),
    },
  });
});

adminRoutes.get('/messages', ownerOnly, async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM message_log ORDER BY id DESC LIMIT 200').all();
  return c.json(r.results);
});

// --- Utilitare ---

function validEmail(e: unknown): string {
  const s = String(e ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'invalid_email');
  return s;
}
function validPassword(p: unknown) {
  if (typeof p !== 'string' || p.length < 10) throw new HttpError(400, 'password_too_short');
}

const TABLES = new Set(['services', 'barbers', 'bookings', 'clients', 'promos']);
async function update(db: D1Database, table: string, id: string, v: Record<string, unknown>) {
  if (!TABLES.has(table)) throw new Error('bad table');
  const keys = Object.keys(v);
  if (!keys.length) return;
  for (const k of keys) if (!/^[a-z_]+$/.test(k)) throw new Error('bad column');
  await db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(v), id).run();
}
