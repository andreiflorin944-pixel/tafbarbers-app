import { Hono, type Context, type Next } from 'hono';
import { notesRoutes } from '../notes';
import { socialAdmin } from '../social';
import {
  createSession,
  deleteSession,
  hashPassword,
  newId,
  normalizePhone,
  requireAdmin,
  sha256,
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
  BARBER_SERVICE_COLS,
} from '../db';
import { HttpError, PERMS, isRole, parsePerms, type AppEnv, type Env, type Perm, type Role } from '../env';
import { runCampaign } from '../campaigns';
import { iso, isBirthdayOn, isDay, localDay, localToUtc } from '../time';
import { clientsCells, clientsCsv, deleteClient } from '../gdpr';
import { DOCS, getLegal, legalDoc, saveLegal } from '../legal';
import { getOrder, getOrders, product, setOrderStatus, type OrderStatus, type ProductRow } from '../shop';
import { addPhoto, deletePhoto, getIdentity, mediaUrl, parseBirthDate, saveMedia } from '../identity';
import { getBonuses, getReferralSettings, giveBonus, parseReward, saveReferralSettings, type Reward } from '../referrals';
import {
  activateSubscription,
  completeBooking,
  getPlans,
  getSubscriptions,
  planValues,
  subscription,
  undoCompletion,
  usableSubscription,
  type PlanInput,
} from '../subscriptions';
import { getBirthdaySettings, saveBirthdaySettings } from '../birthday';
import { buildDashboard, buildReport, REPORTS, reportCells, type ReportKind } from '../reports';
import { xlsx } from '../xlsx';
import { adjustMove, cancelNir, createNir, getNir, listNir, stockOut, type NirInput } from '../stock';
import { activateGiftCard, createGiftCard, freeSlotsSoon, getAutomations, giftCard, saveAutomations, type GiftCardRow } from '../growth';
import { sendPush, sendSms } from '../notify';
import { autoTranslate } from '../translate';
import { getAppearance, isImageUrl, MEDIA_MAX, MEDIA_TYPES, saveAppearance } from '../appearance';

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
  await c.env.DB.prepare(`INSERT INTO admins (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'org_admin')`)
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

// Fără dreptul „contacts”, telefonul și e-mailul clienților nu pleacă de pe server: le scoatem din
// toate răspunsurile cu date de clienți (programări, fișe, comenzi, abonamente, recomandări, zile de naștere).
const CLIENT_DATA = /^\/v1\/admin\/(bookings|clients|referrals|subscriptions|birthdays|orders)(\/|$)/;
const CONTACT_KEYS = new Set(['phone', 'email', 'clientPhone', 'clientEmail']);
function stripContacts(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripContacts);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !CONTACT_KEYS.has(k)).map(([k, x]) => [k, stripContacts(x)]));
  return v;
}
adminRoutes.use('*', async (c, next) => {
  await next();
  if (c.get('admin').perms.contacts || !CLIENT_DATA.test(c.req.path)) return;
  if (!(c.res.headers.get('Content-Type') ?? '').includes('application/json')) return;
  const body = stripContacts(await c.res.json());
  const headers = new Headers(c.res.headers);
  headers.delete('Content-Length');
  c.res = new Response(JSON.stringify(body), { status: c.res.status, headers });
});

// Notițe pentru echipă (sarcini, scripturi de filmat).
adminRoutes.route('/', notesRoutes);
adminRoutes.route('/', socialAdmin);

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
  return c.json({ id: a!.id, email: a!.email, name: a!.name, barberId: a!.barber_id, role: s.role, owner: s.owner, permissions: s.perms });
});

/** Catalogul, campaniile și setările sunt doar pentru proprietar. */
async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}

/** Cum s-a încasat la salon: numerar (implicit), card la POS sau transfer. */
const payMethodOf = (m: unknown) => (m === 'card' || m === 'transfer' ? m : 'cash');

function need(c: Context<AppEnv>, perm: Perm) {
  if (!c.get('admin').perms[perm]) throw new HttpError(403, 'no_permission');
}

/** Fără dreptul „bookings_all”, contul lucrează doar pe programările frizerului lui (sau pe niciuna, dacă nu e legat de un frizer). */
function ownBarber(c: Context<AppEnv>): string | null {
  const a = c.get('admin');
  return a.perms.bookings_all ? null : (a.barberId ?? '__niciunul__');
}

function cleanPerms(raw: unknown): Record<string, boolean> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(PERMS.filter((p) => typeof o[p] === 'boolean').map((p) => [p, o[p] as boolean]));
}

// --- Echipa (conturi admin) ---

adminRoutes.get('/admins', ownerOnly, async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT a.id, a.email, a.name, a.barber_id, a.permissions, a.role,
       (SELECT count(*) FROM sessions s WHERE s.kind = 'admin' AND s.subject_id = a.id AND s.expires_at > ?) AS sessions
     FROM admins a ORDER BY a.email`,
  )
    .bind(iso(new Date()))
    .all();
  return c.json(
    r.results.map((a: any) => {
      const role: Role = isRole(a.role) ? a.role : 'barber';
      // `sessions` = pe câte dispozitive e conectat acum (panou sau aplicație).
      return { id: a.id, email: a.email, name: a.name, barberId: a.barber_id, role, permissions: parsePerms(a.permissions, role), sessions: a.sessions };
    }),
  );
});

adminRoutes.post('/admins', ownerOnly, async (c) => {
  const b = await c.req.json<{ email?: string; password?: string; name?: string; barberId?: string | null; role?: string; permissions?: unknown }>();
  const email = validEmail(b.email);
  validPassword(b.password);
  // Fără rol trimis: cont legat de un frizer = frizer, altfel administrator de organizație (ca înainte).
  const role: Role = b.role === undefined ? (b.barberId ? 'barber' : 'org_admin') : isRole(b.role) ? b.role : (() => { throw new HttpError(400, 'invalid_role'); })();
  const id = newId('ad');
  await c.env.DB.prepare('INSERT INTO admins (id, email, name, password_hash, barber_id, role, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, (b.name ?? '').slice(0, 80), await hashPassword(b.password!), b.barberId || null, role, JSON.stringify(cleanPerms(b.permissions)))
    .run()
    .catch(() => {
      throw new HttpError(409, 'email_taken');
    });
  return c.json({ id }, 201);
});

adminRoutes.patch('/admins/:id', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const b = await c.req.json<{ name?: string; barberId?: string | null; role?: string; permissions?: unknown; password?: string }>();
  if (b.role !== undefined && !isRole(b.role)) throw new HttpError(400, 'invalid_role');
  if (id === c.get('admin').adminId && b.role !== undefined && b.role !== 'org_admin') throw new HttpError(400, 'cannot_demote_self');
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.role !== undefined) sets.push('role = ?'), vals.push(b.role);
  if (b.name !== undefined) sets.push('name = ?'), vals.push(String(b.name).slice(0, 80));
  if (b.barberId !== undefined) sets.push('barber_id = ?'), vals.push(b.barberId || null);
  if (b.permissions !== undefined) sets.push('permissions = ?'), vals.push(JSON.stringify(cleanPerms(b.permissions)));
  if (b.password) {
    validPassword(b.password);
    sets.push('password_hash = ?'), vals.push(await hashPassword(b.password));
  }
  if (sets.length) await c.env.DB.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  // Parolă nouă pusă de proprietar: contul e scos de pe toate dispozitivele (în afară de sesiunea ta, dacă e contul tău).
  if (b.password) await logoutAdmin(c.env.DB, id, id === c.get('admin').adminId ? tokenFrom(c) : null);
  return c.json({ ok: true });
});

/** Proprietarul deconectează un membru al echipei de pe toate dispozitivele (panou și aplicație). */
adminRoutes.post('/admins/:id/logout', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const n = await logoutAdmin(c.env.DB, id, id === c.get('admin').adminId ? tokenFrom(c) : null);
  return c.json({ ok: true, loggedOut: n });
});

/** Ieși de pe toate celelalte dispozitive (sesiunea curentă rămâne). */
adminRoutes.post('/me/logout-others', async (c) => {
  const n = await logoutAdmin(c.env.DB, c.get('admin').adminId, tokenFrom(c));
  return c.json({ ok: true, loggedOut: n });
});

async function logoutAdmin(db: D1Database, adminId: string, keepToken: string | null): Promise<number> {
  const keep = keepToken ? await sha256(keepToken) : '';
  const r = await db.prepare(`DELETE FROM sessions WHERE kind = 'admin' AND subject_id = ? AND token_hash != ?`).bind(adminId, keep).run();
  return r.meta.changes ?? 0;
}

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
  // După schimbarea parolei, celelalte dispozitive trebuie să intre din nou.
  await logoutAdmin(c.env.DB, c.get('admin').adminId, tokenFrom(c));
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
    'legalName', 'cui', 'regCom', 'legalAddress', 'legalEmail',
  ];
  const next = { ...cur } as Record<string, unknown>;
  for (const k of allowed) if (k in b) next[k] = b[k];
  await setSetting(c.env, 'business', next);
  return c.json(next);
});

// --- Aspectul aplicației și poze ---

adminRoutes.get('/appearance', async (c) => c.json(await getAppearance(c.env)));
adminRoutes.put('/appearance', ownerOnly, async (c) => c.json(await saveAppearance(c.env, await c.req.json())));

/** Urcă o poză (corpul cererii = fișierul). Întoarce adresa ei, de pus la logo, serviciu sau frizer. */
adminRoutes.post('/media', ownerOnly, async (c) => {
  const mime = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!MEDIA_TYPES[mime]) throw new HttpError(400, 'unsupported_image');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'empty_file');
  if (buf.byteLength > MEDIA_MAX) throw new HttpError(400, 'image_too_large');
  const id = newId('m');
  await c.env.DB.prepare('INSERT INTO media (id, mime, data, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, mime, buf, buf.byteLength, iso(new Date()))
    .run();
  return c.json({ id, url: `/v1/media/${id}` }, 201);
});

// --- Magazin: produse și comenzi ---

type ProductInput = {
  name?: string;
  description?: string;
  price?: number;
  imageUrl?: string | null;
  stock?: number | null;
  sort?: number;
  active?: boolean;
  forSale?: boolean;
  unit?: string;
  cost?: number | null;
};
function productValues(b: ProductInput, create: boolean) {
  const v: Record<string, unknown> = {};
  if (b.name !== undefined || create) {
    if (!b.name?.trim()) throw new HttpError(400, 'name_required');
    v.name = b.name.trim().slice(0, 120);
  }
  if (b.description !== undefined) v.description = String(b.description).slice(0, 1000);
  if (b.price !== undefined || create) {
    const p = Math.round(Number(b.price) * 100);
    if (!(p >= 0 && p <= 10_000_00)) throw new HttpError(400, 'invalid_price');
    v.price_bani = p;
  }
  if (b.imageUrl !== undefined) {
    if (b.imageUrl && !isImageUrl(b.imageUrl)) throw new HttpError(400, 'invalid_url');
    v.image_url = b.imageUrl || null;
  }
  if (b.stock !== undefined) {
    if (b.stock !== null && !(Number.isInteger(b.stock) && b.stock >= 0 && b.stock <= 100000)) throw new HttpError(400, 'invalid_stock');
    v.stock = b.stock;
  }
  if (b.sort !== undefined) v.sort = Math.floor(Number(b.sort)) || 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (b.forSale !== undefined) v.for_sale = b.forSale ? 1 : 0;
  if (b.unit !== undefined) v.unit = String(b.unit).trim().slice(0, 12) || 'buc';
  if (b.cost !== undefined) {
    const k = b.cost === null ? null : Math.round(Number(b.cost) * 100);
    if (k !== null && !(k >= 0 && k <= 10_000_000)) throw new HttpError(400, 'invalid_price');
    v.cost_bani = k;
  }
  return v;
}

adminRoutes.get('/products', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM products ORDER BY sort, name').all<ProductRow>();
  return c.json(r.results.map(product));
});

adminRoutes.post('/products', ownerOnly, async (c) => {
  const v = productValues(await c.req.json<ProductInput>(), true);
  const id = newId('p');
  await c.env.DB.prepare(
    'INSERT INTO products (id, name, description, price_bani, image_url, stock, sort, active, created_at, for_sale, unit, cost_bani) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, v.name, v.description ?? '', v.price_bani, v.image_url ?? null, v.stock ?? null, v.sort ?? 0, v.active ?? 1, iso(new Date()), v.for_sale ?? 1, v.unit ?? 'buc', v.cost_bani ?? null)
    .run();
  if (typeof v.stock === 'number' && v.stock > 0) await adjustMove(c.env, c.get('admin').adminId, id, v.stock, 'Stoc inițial').run();
  return c.json(product((await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<ProductRow>())!), 201);
});

adminRoutes.patch('/products/:id', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const v = productValues(await c.req.json<ProductInput>(), false);
  const before = await c.env.DB.prepare('SELECT stock FROM products WHERE id = ?').bind(id).first<{ stock: number | null }>();
  await update(c.env.DB, 'products', id, v);
  // Stocul schimbat de mână apare în fișa de magazie ca o corecție.
  if (before && typeof v.stock === 'number' && v.stock !== (before.stock ?? 0)) {
    await adjustMove(c.env, c.get('admin').adminId, id, v.stock - (before.stock ?? 0), 'Modificat din fișa produsului').run();
  }
  const r = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<ProductRow>();
  if (!r) throw new HttpError(404, 'not_found');
  return c.json(product(r));
});

// Un produs care apare în comenzi doar se ascunde, ca istoricul să rămână corect.
adminRoutes.delete('/products/:id', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const used = await c.env.DB.prepare('SELECT 1 FROM order_items WHERE product_id = ?1 UNION SELECT 1 FROM stock_moves WHERE product_id = ?1 LIMIT 1').bind(id).first();
  if (used) await c.env.DB.prepare('UPDATE products SET active = 0 WHERE id = ?').bind(id).run();
  else await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deactivated: !!used });
});

// --- Gestiune: NIR, ieșiri, fișa de magazie (dreptul „Magazin”) ---

adminRoutes.get('/nir', async (c) => {
  need(c, 'shop');
  return c.json(await listNir(c.env));
});
adminRoutes.get('/nir/:id', async (c) => {
  need(c, 'shop');
  return c.json(await getNir(c.env, c.req.param('id')!));
});
adminRoutes.post('/nir', async (c) => {
  need(c, 'shop');
  return c.json(await createNir(c.env, c.get('admin').adminId, await c.req.json<NirInput>()), 201);
});
adminRoutes.post('/nir/:id/cancel', ownerOnly, async (c) => c.json(await cancelNir(c.env, c.get('admin').adminId, c.req.param('id')!)));
adminRoutes.post('/stock/out', async (c) => {
  need(c, 'shop');
  return c.json(await stockOut(c.env, c.get('admin').adminId, await c.req.json()));
});

adminRoutes.get('/orders', async (c) => {
  need(c, 'shop');
  const status = c.req.query('status');
  if (status === 'open') return c.json(await getOrders(c.env, `o.status IN ('new', 'ready')`, [], 200));
  if (status && ['new', 'ready', 'picked_up', 'cancelled'].includes(status)) return c.json(await getOrders(c.env, 'o.status = ?', [status], 200));
  return c.json(await getOrders(c.env, '1 = 1', [], 200));
});

// Tranziții permise: nouă → gata (SMS la client) → ridicată; anulare cât timp nu e ridicată.
const ORDER_FROM: Record<string, OrderStatus[]> = { ready: ['new'], picked_up: ['new', 'ready'], cancelled: ['new', 'ready'] };
adminRoutes.patch('/orders/:id', async (c) => {
  need(c, 'shop');
  const id = c.req.param('id')!;
  const { status, payMethod } = await c.req.json<{ status?: string; payMethod?: string }>();
  const from = status ? ORDER_FROM[status] : undefined;
  if (!from) throw new HttpError(400, 'invalid_status');
  await getOrder(c.env, id);
  if (!(await setOrderStatus(c.env, id, status as OrderStatus, from))) throw new HttpError(409, 'invalid_transition');
  // La ridicare se încasează la salon, dacă nu a fost plătită deja online.
  if (status === 'picked_up')
    await c.env.DB.prepare('UPDATE orders SET paid_at = ?, pay_method = ? WHERE id = ? AND paid_at IS NULL').bind(iso(new Date()), payMethodOf(payMethod), id).run();
  return c.json(await getOrder(c.env, id));
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
  if (b.imageUrl !== undefined) {
    if (b.imageUrl && !isImageUrl(b.imageUrl)) throw new HttpError(400, 'invalid_url');
    v.image_url = b.imageUrl || null;
  }
  if (b.sort !== undefined) v.sort = Number(b.sort) || 0;
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return v as { name: string; description?: string; duration_min: number; price_bani: number; color?: string; image_url?: string | null; sort?: number; active?: number };
}

// --- Frizeri, programul și serviciile lor ---

const BARBER_SELECT = `SELECT b.*, ${BARBER_SERVICE_COLS} FROM barbers b`;

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
  color?: string | null;
  sort?: number;
  active?: boolean;
  serviceIds?: string[];
  /** Prețuri proprii în lei pe serviciu; null = prețul standard. */
  prices?: Record<string, number | null>;
  /** Durate proprii în minute pe serviciu; null = durata standard. */
  durations?: Record<string, number | null>;
  hours?: Array<{ weekday: number; start: number; end: number }>;
};

function barberColor(v: unknown) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new HttpError(400, 'invalid_color');
  return v.toUpperCase();
}

adminRoutes.post('/barbers', ownerOnly, async (c) => {
  const b = await c.req.json<BarberInput>();
  if (!b.name?.trim()) throw new HttpError(400, 'name_required');
  if (b.photoUrl && !isImageUrl(b.photoUrl)) throw new HttpError(400, 'invalid_url');
  const id = newId('br');
  await c.env.DB.prepare('INSERT INTO barbers (id, name, role, bio, photo_url, color, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, b.name.trim().slice(0, 80), (b.role ?? 'Barber').slice(0, 60), (b.bio ?? '').slice(0, 1000), b.photoUrl ?? null, barberColor(b.color), b.sort ?? 0)
    .run();
  await saveBarberRelations(c.env.DB, id, {
    prices: b.prices,
    durations: b.durations,
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
  if (b.photoUrl !== undefined) {
    if (b.photoUrl && !isImageUrl(b.photoUrl)) throw new HttpError(400, 'invalid_url');
    v.photo_url = b.photoUrl || null;
  }
  if (b.color !== undefined) v.color = barberColor(b.color);
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

async function saveBarberRelations(db: D1Database, id: string, b: Pick<BarberInput, 'serviceIds' | 'hours' | 'prices' | 'durations'>) {
  const stmts: D1PreparedStatement[] = [];
  const prices = new Map<string, number | null>();
  for (const [sid, lei] of Object.entries(b.prices ?? {})) {
    if (lei === null || lei === undefined || (lei as unknown) === '') prices.set(sid, null);
    else {
      const bani = Math.round(Number(lei) * 100);
      if (!(bani >= 0 && bani <= 100_000_00)) throw new HttpError(400, 'invalid_price');
      prices.set(sid, bani);
    }
  }
  const durations = new Map<string, number | null>();
  for (const [sid, min] of Object.entries(b.durations ?? {})) {
    if (min === null || min === undefined || (min as unknown) === '') durations.set(sid, null);
    else {
      const m = Math.round(Number(min));
      if (!(m >= 5 && m <= 480)) throw new HttpError(400, 'invalid_duration');
      durations.set(sid, m);
    }
  }
  if (b.serviceIds) {
    // Păstrăm prețurile și duratele proprii existente pentru serviciile care rămân bifate.
    const old = await db
      .prepare('SELECT service_id, price_bani, duration_min FROM barber_services WHERE barber_id = ?')
      .bind(id)
      .all<{ service_id: string; price_bani: number | null; duration_min: number | null }>();
    const keep = new Map(old.results.map((r) => [r.service_id, r]));
    stmts.push(db.prepare('DELETE FROM barber_services WHERE barber_id = ?').bind(id));
    for (const s of b.serviceIds) {
      const price = prices.has(s) ? prices.get(s)! : (keep.get(s)?.price_bani ?? null);
      const dur = durations.has(s) ? durations.get(s)! : (keep.get(s)?.duration_min ?? null);
      stmts.push(db.prepare('INSERT INTO barber_services (barber_id, service_id, price_bani, duration_min) VALUES (?, ?, ?, ?)').bind(id, s, price, dur));
    }
  } else {
    for (const [s, price] of prices) stmts.push(db.prepare('UPDATE barber_services SET price_bani = ? WHERE barber_id = ? AND service_id = ?').bind(price, id, s));
    for (const [s, dur] of durations) stmts.push(db.prepare('UPDATE barber_services SET duration_min = ? WHERE barber_id = ? AND service_id = ?').bind(dur, id, s));
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
    await c.env.DB.prepare('INSERT INTO clients (id, phone, name, marketing_push) VALUES (?, ?, ?, 0)').bind(cl.id, phone, cl.name.slice(0, 80)).run();
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
  if (b.status === 'cancelled') return c.json(await cancelBooking(c.env, id, 'admin', undefined, c.get('admin').adminId));
  const v: Record<string, unknown> = {};
  if (b.status) {
    if (!['confirmed', 'completed', 'no_show'].includes(b.status)) throw new HttpError(400, 'invalid_status');
    v.status = b.status;
  }
  if (b.note !== undefined) v.note = String(b.note).slice(0, 500);
  await update(c.env.DB, 'bookings', id, v);
  return c.json(await getBooking(c.env, id));
});

/** Ce trebuie la confirmarea tunsorii: prețul, abonamentul care o poate acoperi și bonusurile active ale clientului. */
adminRoutes.get('/bookings/:id/checkout', async (c) => {
  const cur = await bookingForStaff(c);
  const bonuses = (await getBonuses(c.env, cur.clientId, false)).filter((b) => b.status === 'active');
  return c.json({
    booking: cur,
    subscription: await usableSubscription(c.env, cur.clientId, cur.serviceId),
    bonuses,
  });
});

/** Programările trecute care n-au fost închise (încheiată / nu a venit / anulată). Frizerul le vede doar pe ale lui. */
adminRoutes.get('/bookings/unclosed', async (c) => {
  const scoped = ownBarber(c);
  const r = await c.env.DB.prepare(
    `${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.ends_at < ? AND b.starts_at > ? ${scoped ? 'AND b.barber_id = ?' : ''} ORDER BY b.starts_at DESC LIMIT 200`,
  )
    .bind(...(scoped ? [iso(new Date()), iso(new Date(Date.now() - 90 * 86_400_000)), scoped] : [iso(new Date()), iso(new Date(Date.now() - 90 * 86_400_000))]))
    .all<BookingRow>();
  return c.json(r.results.map(booking));
});

/** Frizerul confirmă tunsoarea: `{ payment: 'paid', amount }` sau `{ payment: 'subscription' }`, opțional `bonusId`. */
adminRoutes.post('/bookings/:id/complete', async (c) => {
  const cur = await bookingForStaff(c);
  const b = await c.req.json<{ payment?: string; amount?: number; tip?: number | null; bonusId?: string | null; giftCode?: string | null; giftAmount?: number | null; payMethod?: string | null }>();
  await completeBooking(c.env, cur.id, b, c.get('admin').adminId);
  return c.json(await getBooking(c.env, cur.id));
});

/** Anulează confirmarea plății (doar proprietarul). */
adminRoutes.delete('/bookings/:id/complete', ownerOnly, async (c) => {
  await undoCompletion(c.env, c.req.param('id')!);
  return c.json(await getBooking(c.env, c.req.param('id')!));
});

/**
 * Cerere de recenzie Google după o tunsoare încheiată: SMS (și push, dacă are aplicația) cu linkul recenziei.
 * O singură cerere pe programare, ca să nu deranjăm clientul.
 */
adminRoutes.post('/bookings/:id/review-request', async (c) => {
  const cur = await bookingForStaff(c);
  if (cur.status !== 'completed') throw new HttpError(409, 'review_not_completed');
  const { links } = await getAutomations(c.env);
  if (!links.googleReviewUrl) throw new HttpError(400, 'review_link_missing');
  const sent = await c.env.DB.prepare(`SELECT 1 FROM message_log WHERE kind = 'review' AND booking_id = ? AND status = 'sent' LIMIT 1`).bind(cur.id).first();
  if (sent) throw new HttpError(409, 'review_already_sent');
  const name = (cur.clientName || '').split(/\s+/)[0];
  const text = `${name ? `${name}, m` : 'M'}ulțumim că ai fost la TAFBarbers! Ne lași o recenzie? Durează un minut: ${links.googleReviewUrl}`;
  const ok = cur.clientPhone ? await sendSms(c.env, { kind: 'review', recipient: cur.clientPhone, bookingId: cur.id }, text) : false;
  const tokens = (await c.env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(cur.clientId).all<{ token: string }>()).results.map((t) => t.token);
  const pushed = tokens.length ? await sendPush(c.env, { kind: 'review', bookingId: cur.id }, tokens, 'Cum a fost tunsoarea?', 'Ne lași o recenzie pe Google? Durează un minut.', { url: links.googleReviewUrl }) : 0;
  if (!ok && !pushed) throw new HttpError(500, 'send_failed');
  return c.json({ ok: true, sms: ok, push: pushed > 0 });
});

async function bookingForStaff(c: Context<AppEnv>) {
  need(c, 'bookings_manage');
  const cur = await getBooking(c.env, c.req.param('id')!);
  const scoped = ownBarber(c);
  if (!cur || (scoped && cur.barberId !== scoped)) throw new HttpError(404, 'not_found');
  return cur;
}

// --- Abonamente ---

adminRoutes.get('/plans', async (c) => c.json(await getPlans(c.env, true)));

adminRoutes.post('/plans', ownerOnly, async (c) => {
  const v = planValues(await c.req.json<PlanInput>(), false);
  const id = newId('pl');
  const keys = Object.keys(v);
  await c.env.DB.prepare(`INSERT INTO plans (id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`)
    .bind(id, ...Object.values(v))
    .run();
  return c.json({ id }, 201);
});

adminRoutes.patch('/plans/:id', ownerOnly, async (c) => {
  await update(c.env.DB, 'plans', c.req.param('id')!, planValues(await c.req.json<PlanInput>(), true));
  return c.json({ ok: true });
});

adminRoutes.delete('/plans/:id', ownerOnly, async (c) => {
  await c.env.DB.prepare('DELETE FROM plans WHERE id = ?').bind(c.req.param('id')!).run();
  return c.json({ ok: true });
});

/** Abonamentele vândute (cu dreptul „clients”); `?all=1` include și cele expirate sau anulate. */
adminRoutes.get('/subscriptions', async (c) => {
  need(c, 'clients');
  const all = c.req.query('all') === '1';
  const r = await c.env.DB.prepare(
    `SELECT s.*, a.name AS created_by_name, cl.name AS client_name, cl.phone AS client_phone FROM subscriptions s
     JOIN clients cl ON cl.id = s.client_id LEFT JOIN admins a ON a.id = s.created_by
     ${all ? '' : `WHERE s.status = 'active' AND s.ends_at > ?`} ORDER BY s.ends_at ${all ? 'DESC' : ''} LIMIT 500`,
  )
    .bind(...(all ? [] : [iso(new Date())]))
    .all<Parameters<typeof subscription>[0] & { client_name: string; client_phone: string }>();
  return c.json(r.results.map((x) => ({ ...subscription(x), client: { id: x.client_id, name: x.client_name, phone: x.client_phone } })));
});

/** Activează un abonament plătit la salon (frizerul clientului sau adminul). */
adminRoutes.post('/clients/:id/subscriptions', async (c) => {
  const id = c.req.param('id')!;
  await needClient(c, id);
  const b = await c.req.json<{ planId?: string; note?: string; gift?: boolean; payMethod?: string }>();
  if (!b.planId) throw new HttpError(400, 'invalid_body');
  // Doar proprietarul oferă pachete cadou.
  if (b.gift && !c.get('admin').owner) throw new HttpError(403, 'owner_only');
  const note = String(b.note ?? '').trim() || (b.gift ? 'Cadou' : '');
  const sid = await activateSubscription(c.env, id, b.planId, c.get('admin').adminId, note, !!b.gift);
  if (!b.gift) await c.env.DB.prepare('UPDATE subscriptions SET pay_method = ? WHERE id = ?').bind(payMethodOf(b.payMethod), sid).run();
  return c.json({ id: sid }, 201);
});

/** Anulează un abonament (doar proprietarul). */
adminRoutes.patch('/subscriptions/:id', ownerOnly, async (c) => {
  const b = await c.req.json<{ status?: string }>();
  if (b.status !== 'cancelled') throw new HttpError(400, 'invalid_status');
  await c.env.DB.prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'active'`)
    .bind(iso(new Date()), c.req.param('id')!)
    .run();
  return c.json({ ok: true });
});

// --- Clienți ---

adminRoutes.get('/clients', async (c) => {
  need(c, 'clients');
  const q = (c.req.query('q') ?? '').trim();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  if (q && !c.get('admin').perms.contacts) {
    // Fără dreptul „contacts”: după nume, sau după numărul de telefon complet (nu după bucăți din el).
    const digits = q.replace(/[^\d+]/g, '');
    let phone: string | null = null;
    if (digits.length >= 9 && /^[\d+\s().-]+$/.test(q)) {
      try {
        phone = normalizePhone(q);
      } catch {
        phone = null;
      }
    }
    const r = await c.env.DB.prepare(
      `SELECT c.*,
         (SELECT count(*) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS visits,
         (SELECT max(starts_at) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS last_visit
       FROM clients c WHERE c.deleted_at IS NULL AND ${phone ? 'c.phone = ?' : 'c.name LIKE ?'} ORDER BY c.created_at DESC LIMIT 100`,
    )
      .bind(phone ?? like)
      .all<ClientRow & { visits: number; last_visit: string | null }>();
    return c.json(r.results.map((x) => ({ ...client(x), visits: x.visits, lastVisit: x.last_visit })));
  }
  const r = await c.env.DB.prepare(
    `SELECT c.*,
       (SELECT count(*) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS visits,
       (SELECT max(starts_at) FROM bookings WHERE client_id = c.id AND status IN ('confirmed','completed')) AS last_visit
     FROM clients c WHERE c.deleted_at IS NULL ${q ? 'AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)' : ''}
     ORDER BY c.created_at DESC LIMIT 500`,
  )
    .bind(...(q ? [like, like, like] : []))
    .all<ClientRow & { visits: number; last_visit: string | null }>();
  return c.json(r.results.map((x) => ({ ...client(x), visits: x.visits, lastVisit: x.last_visit })));
});

adminRoutes.get('/clients.csv', async (c) => {
  need(c, 'clients');
  need(c, 'contacts');
  return c.body(await clientsCsv(c.env), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="clienti-tafbarbers-${iso(new Date()).slice(0, 10)}.csv"`,
  });
});

adminRoutes.get('/clients.xlsx', async (c) => {
  need(c, 'clients');
  need(c, 'contacts');
  const name = `clienti-tafbarbers-${iso(new Date()).slice(0, 10)}`;
  return new Response(xlsx('Clienți', await clientsCells(c.env)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}.xlsx"`,
    },
  });
});

/**
 * Import de clienți dintr-un tabel (Excel/CSV citit în panou). Telefonul e cheia: un număr care există deja
 * nu dublează clientul, doar completează ce lipsea (nume, e-mail, zi de naștere). Ofertele rămân oprite:
 * acordul de marketing îl dă doar clientul (GDPR).
 */
adminRoutes.post('/clients/import', async (c) => {
  need(c, 'clients');
  need(c, 'contacts');
  const b = await c.req.json<{ rows?: Array<{ name?: unknown; phone?: unknown; email?: unknown; birthDate?: unknown; notes?: unknown }> }>();
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) throw new HttpError(400, 'import_empty');
  if (rows.length > 3000) throw new HttpError(400, 'import_too_big');
  const str = (v: unknown, max: number) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
  const res = { created: 0, updated: 0, unchanged: 0, skipped: [] as Array<{ row: number; reason: string }> };
  const seen = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    let phone: string;
    try {
      phone = normalizePhone(str(r.phone, 40));
    } catch {
      res.skipped.push({ row: i + 1, reason: str(r.phone, 40) ? 'telefon invalid' : 'fără telefon' });
      continue;
    }
    if (seen.has(phone)) {
      res.skipped.push({ row: i + 1, reason: 'telefon repetat în fișier' });
      continue;
    }
    seen.add(phone);
    let email: string | null = str(r.email, 120).toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = null;
    let birth: string | null = null;
    const rawBirth = str(r.birthDate, 20).replace(/[/.]/g, '-');
    const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(rawBirth);
    try {
      birth = rawBirth ? parseBirthDate(dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : rawBirth) : null;
    } catch {
      birth = null;
    }
    const name = str(r.name, 80);
    const notes = str(r.notes, 2000);
    const ex = await c.env.DB.prepare('SELECT id, name, email, birth_date, notes, deleted_at FROM clients WHERE phone = ?')
      .bind(phone)
      .first<{ id: string; name: string; email: string | null; birth_date: string | null; notes: string; deleted_at: string | null }>();
    if (!ex) {
      stmts.push(
        c.env.DB.prepare('INSERT INTO clients (id, phone, name, email, birth_date, notes, marketing_push, marketing_email, marketing_sms) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)').bind(
          newId('cl'),
          phone,
          name,
          email,
          birth,
          notes,
        ),
      );
      res.created++;
      continue;
    }
    if (ex.deleted_at) {
      res.skipped.push({ row: i + 1, reason: 'clientul și-a șters contul' });
      continue;
    }
    const v: Record<string, unknown> = {};
    if (!ex.name && name) v.name = name;
    if (!ex.email && email) v.email = email;
    if (!ex.birth_date && birth) v.birth_date = birth;
    if (!ex.notes && notes) v.notes = notes;
    if (!Object.keys(v).length) {
      res.unchanged++;
      continue;
    }
    const keys = Object.keys(v);
    stmts.push(c.env.DB.prepare(`UPDATE clients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => v[k]), ex.id));
    res.updated++;
  }
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return c.json({ ...res, skipped: res.skipped.slice(0, 200), skippedCount: res.skipped.length });
});

adminRoutes.delete('/clients/:id', ownerOnly, async (c) => {
  await deleteClient(c.env, c.req.param('id')!);
  return c.json({ ok: true });
});

/**
 * Fișa unui client: cu dreptul „clients”, oricare client; fără el, frizerul vede fișa (TAF Identity
 * și notițele) doar pentru clienții care au programare la el.
 */
async function needClient(c: Context<AppEnv>, clientId: string) {
  const a = c.get('admin');
  if (a.perms.clients) return;
  const mine = a.barberId
    ? await c.env.DB.prepare('SELECT 1 FROM bookings WHERE client_id = ? AND barber_id = ? LIMIT 1').bind(clientId, a.barberId).first()
    : null;
  if (!mine) throw new HttpError(403, 'no_permission');
}

adminRoutes.get('/clients/:id', async (c) => {
  const id = c.req.param('id')!;
  await needClient(c, id);
  const r = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<ClientRow>();
  if (!r) throw new HttpError(404, 'not_found');
  const own = ownBarber(c);
  const bk = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.client_id = ? ${own ? 'AND b.barber_id = ?' : ''} ORDER BY b.starts_at DESC LIMIT 200`)
    .bind(...(own ? [id, own] : [id]))
    .all<BookingRow>();
  const ref = r.referred_by ? await c.env.DB.prepare('SELECT id, name FROM clients WHERE id = ?').bind(r.referred_by).first<{ id: string; name: string }>() : null;
  const referred = await c.env.DB.prepare('SELECT count(*) AS n FROM clients WHERE referred_by = ? AND deleted_at IS NULL').bind(id).first<{ n: number }>();
  return c.json({
    ...client(r),
    bookings: bk.results.map(booking),
    identity: await getIdentity(c.env, id, true),
    bonuses: await getBonuses(c.env, id, true),
    subscriptions: await getSubscriptions(c.env, id, true),
    referredBy: ref,
    referredCount: referred?.n ?? 0,
    beforeAfter: await beforeAfterOf(c.env, id),
  });
});

// --- Poze înainte / după ---

async function beforeAfterOf(env: AppEnv['Bindings'], clientId: string) {
  const r = await env.DB.prepare(
    `SELECT x.id, x.before_media, x.after_media, x.created_at, br.name AS barber_name FROM before_after x LEFT JOIN barbers br ON br.id = x.barber_id
     WHERE x.client_id = ? ORDER BY x.created_at DESC LIMIT 50`,
  )
    .bind(clientId)
    .all<{ id: string; before_media: string; after_media: string; created_at: string; barber_name: string | null }>();
  return r.results.map((x) => ({ id: x.id, before: mediaUrl(x.before_media), after: mediaUrl(x.after_media), barberName: x.barber_name, createdAt: x.created_at }));
}

/** Urcă o poză (înainte sau după); întoarce id-ul ei, folosit apoi la salvarea perechii. */
adminRoutes.post('/clients/:id/before-after/upload', async (c) => {
  await needClient(c, c.req.param('id')!);
  const mime = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const mediaId = await saveMedia(c.env, mime, await c.req.arrayBuffer(), null);
  return c.json({ mediaId }, 201);
});

adminRoutes.post('/clients/:id/before-after', async (c) => {
  const id = c.req.param('id')!;
  await needClient(c, id);
  const b = await c.req.json<{ before?: string; after?: string }>();
  const ok = await c.env.DB.prepare(`SELECT count(*) AS n FROM media WHERE id IN (?, ?) AND client_id IS NULL`).bind(b.before ?? '', b.after ?? '').first<{ n: number }>();
  if (!b.before || !b.after || b.before === b.after || ok?.n !== 2) throw new HttpError(400, 'invalid_body');
  const pid = newId('ba');
  await c.env.DB.prepare('INSERT INTO before_after (id, client_id, before_media, after_media, barber_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(pid, id, b.before, b.after, c.get('admin').barberId, c.get('admin').adminId)
    .run();
  return c.json({ id: pid }, 201);
});

adminRoutes.delete('/before-after/:id', async (c) => {
  const x = await c.env.DB.prepare('SELECT client_id, before_media, after_media, created_by FROM before_after WHERE id = ?')
    .bind(c.req.param('id')!)
    .first<{ client_id: string; before_media: string; after_media: string; created_by: string | null }>();
  if (!x) throw new HttpError(404, 'not_found');
  if (!c.get('admin').owner && x.created_by !== c.get('admin').adminId) throw new HttpError(403, 'no_permission');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM before_after WHERE id = ?').bind(c.req.param('id')!),
    c.env.DB.prepare('DELETE FROM media WHERE id IN (?, ?)').bind(x.before_media, x.after_media),
  ]);
  return c.json({ ok: true });
});

// --- Mesaje automate (Setări → Notificări) ---

adminRoutes.get('/automations', async (c) => c.json(await getAutomations(c.env)));
adminRoutes.put('/automations', ownerOnly, async (c) => c.json(await saveAutomations(c.env, await c.req.json())));
/** Ce ore libere ar anunța acum mesajul de ultim moment. */
adminRoutes.get('/automations/free-slots', ownerOnly, async (c) => {
  const s = (await getAutomations(c.env)).lastMinute;
  return c.json(await freeSlotsSoon(c.env, new Date(), Number(c.req.query('hours')) || s.window));
});
/** Câți au apăsat linkul „Programează”, pe surse, în ultimele 30 de zile. */
adminRoutes.get('/link-stats', ownerOnly, async (c) => {
  const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const r = await c.env.DB.prepare('SELECT src, sum(n) AS n FROM link_clicks WHERE day >= ? GROUP BY src ORDER BY n DESC').bind(since).all<{ src: string; n: number }>();
  return c.json(r.results);
});

// --- Carduri cadou ---

const GIFT_SELECT = `SELECT g.*, b.name AS buyer_name, coalesce(nullif(a.name, ''), a.email) AS paid_by_name FROM gift_cards g
  LEFT JOIN clients b ON b.id = g.buyer_client_id LEFT JOIN admins a ON a.id = g.paid_by`;

adminRoutes.get('/gift-cards', async (c) => {
  need(c, 'bookings_manage');
  const st = c.req.query('status');
  const r = await c.env.DB.prepare(`${GIFT_SELECT} ${st ? 'WHERE g.status = ?' : ''} ORDER BY g.created_at DESC LIMIT 300`)
    .bind(...(st ? [st] : []))
    .all<GiftCardRow>();
  return c.json(r.results.map((g) => giftCard(g, true)));
});

/** Card vândut direct la salon: se creează și se activează pe loc. */
adminRoutes.post('/gift-cards', async (c) => {
  need(c, 'bookings_manage');
  const b = await c.req.json<{ amount?: number; recipientName?: string; recipientPhone?: string; message?: string; payMethod?: string }>();
  const phone = b.recipientPhone?.trim() ? normalizePhone(b.recipientPhone) : null;
  const id = await createGiftCard(c.env, null, { ...b, recipientPhone: phone });
  await activateGiftCard(c.env, id, c.get('admin').adminId);
  await c.env.DB.prepare('UPDATE gift_cards SET pay_method = ? WHERE id = ?').bind(payMethodOf(b.payMethod), id).run();
  const g = await c.env.DB.prepare(`${GIFT_SELECT} WHERE g.id = ?`).bind(id).first<GiftCardRow>();
  return c.json(giftCard(g!, true), 201);
});

/** `{ status: 'active' }` = încasat la salon (trimite codul); `{ status: 'cancelled' }` = anulat (doar proprietarul). */
adminRoutes.patch('/gift-cards/:id', async (c) => {
  need(c, 'bookings_manage');
  const b = await c.req.json<{ status?: string; payMethod?: string }>();
  const id = c.req.param('id')!;
  if (b.status === 'active') {
    await activateGiftCard(c.env, id, c.get('admin').adminId);
    await c.env.DB.prepare('UPDATE gift_cards SET pay_method = ? WHERE id = ?').bind(payMethodOf(b.payMethod), id).run();
  }
  else if (b.status === 'cancelled') {
    if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
    const r = await c.env.DB.prepare(`UPDATE gift_cards SET status = 'cancelled' WHERE id = ? AND status IN ('pending','active')`).bind(id).run();
    if (!r.meta.changes) throw new HttpError(409, 'not_cancellable');
  } else throw new HttpError(400, 'invalid_status');
  const g = await c.env.DB.prepare(`${GIFT_SELECT} WHERE g.id = ?`).bind(id).first<GiftCardRow>();
  return c.json(giftCard(g!, true));
});

/** Verificare la casă: soldul unui cod. */
adminRoutes.get('/gift-cards/check', async (c) => {
  need(c, 'bookings_manage');
  const code = String(c.req.query('code') ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const norm = code.startsWith('TAF-') ? code : code.length === 8 ? `TAF-${code.slice(0, 4)}-${code.slice(4)}` : code;
  const g = await c.env.DB.prepare(`${GIFT_SELECT} WHERE g.code = ?`).bind(norm).first<GiftCardRow>();
  if (!g || g.status === 'pending' || g.status === 'cancelled') throw new HttpError(404, 'gift_card_not_found');
  return c.json(giftCard(g, true));
});

// --- Ziua de naștere ---

adminRoutes.get('/birthday-settings', async (c) => c.json(await getBirthdaySettings(c.env)));
adminRoutes.put('/birthday-settings', ownerOnly, async (c) => c.json(await saveBirthdaySettings(c.env, await c.req.json())));

/** Clienții care își serbează ziua în următoarele `days` zile (implicit 7), pentru panou. */
adminRoutes.get('/birthdays', async (c) => {
  need(c, 'clients');
  const days = Math.min(31, Math.max(1, Number(c.req.query('days')) || 7));
  const tz = c.env.TIMEZONE || 'Europe/Bucharest';
  const list: Array<{ day: string; clients: Array<{ id: string; name: string; phone: string; birthDate: string }> }> = [];
  const r = await c.env.DB.prepare('SELECT id, name, phone, birth_date FROM clients WHERE deleted_at IS NULL AND birth_date IS NOT NULL').all<{ id: string; name: string; phone: string; birth_date: string }>();
  for (let i = 0; i < days; i++) {
    const day = localDay(tz, new Date(Date.now() + i * 86_400_000));
    const cl = r.results.filter((x) => isBirthdayOn(x.birth_date, day)).map((x) => ({ id: x.id, name: x.name, phone: x.phone, birthDate: x.birth_date }));
    if (cl.length) list.push({ day, clients: cl });
  }
  return c.json(list);
});

// --- Bonusuri și recomandări ---

adminRoutes.get('/referral-settings', async (c) => c.json(await getReferralSettings(c.env)));
adminRoutes.put('/referral-settings', ownerOnly, async (c) => c.json(await saveReferralSettings(c.env, await c.req.json())));

/** Conturile create prin recomandare, cu cine i-a adus și dacă s-a dat deja beneficiul. */
adminRoutes.get('/referrals', async (c) => {
  need(c, 'clients');
  const r = await c.env.DB.prepare(
    `SELECT n.id AS new_id, n.name AS new_name, n.phone AS new_phone, n.created_at, p.id AS ref_id, p.name AS ref_name, p.phone AS ref_phone,
       (SELECT b.title FROM bonuses b WHERE b.referral_of = n.id AND b.client_id = p.id AND b.status != 'cancelled' LIMIT 1) AS bonus_title
     FROM clients n JOIN clients p ON p.id = n.referred_by
     WHERE n.deleted_at IS NULL ORDER BY n.created_at DESC LIMIT 300`,
  ).all<{ new_id: string; new_name: string; new_phone: string; created_at: string; ref_id: string; ref_name: string; ref_phone: string; bonus_title: string | null }>();
  return c.json(
    r.results.map((x) => ({
      newClient: { id: x.new_id, name: x.new_name, phone: x.new_phone },
      referrer: { id: x.ref_id, name: x.ref_name, phone: x.ref_phone },
      createdAt: x.created_at,
      bonusTitle: x.bonus_title,
    })),
  );
});

/** Structura recomandărilor: fiecare client care a adus oameni, cu lista lor (vizite, cât au cheltuit) și bonusurile primite. */
adminRoutes.get('/referrals/tree', async (c) => {
  need(c, 'clients');
  const now = iso(new Date());
  const r = await c.env.DB.prepare(
    `SELECT n.id, n.name, n.created_at, n.referred_by,
       (SELECT count(*) FROM bookings b WHERE b.client_id = n.id AND b.status IN ('completed','confirmed') AND b.starts_at <= ?) AS visits,
       (SELECT coalesce(sum(CASE WHEN b.payment = 'paid' THEN b.paid_bani ELSE 0 END), 0) FROM bookings b WHERE b.client_id = n.id AND b.status = 'completed')
         + (SELECT coalesce(sum(price_bani), 0) FROM subscriptions s WHERE s.client_id = n.id AND s.status != 'cancelled') AS spent,
       (SELECT b.title FROM bonuses b WHERE b.referral_of = n.id AND b.client_id = n.referred_by AND b.status != 'cancelled' LIMIT 1) AS bonus_title
     FROM clients n WHERE n.referred_by IS NOT NULL AND n.deleted_at IS NULL ORDER BY n.created_at`,
  )
    .bind(now)
    .all<{ id: string; name: string; created_at: string; referred_by: string; visits: number; spent: number; bonus_title: string | null }>();
  const refIds = [...new Set(r.results.map((x) => x.referred_by))];
  if (!refIds.length) return c.json([]);
  const refs = await c.env.DB.prepare(
    `SELECT c.id, c.name, (SELECT count(*) FROM bonuses b WHERE b.client_id = c.id AND b.status != 'cancelled') AS bonuses
     FROM clients c WHERE c.id IN (${refIds.map(() => '?').join(',')})`,
  )
    .bind(...refIds)
    .all<{ id: string; name: string; bonuses: number }>();
  const showMoney = c.get('admin').perms.stats;
  const tree = refs.results.map((p) => {
    const people = r.results.filter((x) => x.referred_by === p.id);
    return {
      referrer: { id: p.id, name: p.name },
      count: people.length,
      // Câți dintre cei aduși au venit măcar o dată.
      active: people.filter((x) => x.visits > 0).length,
      spent: showMoney ? people.reduce((n, x) => n + x.spent, 0) / 100 : null,
      bonuses: p.bonuses,
      people: people.map((x) => ({ id: x.id, name: x.name, createdAt: x.created_at, visits: x.visits, spent: showMoney ? x.spent / 100 : null, bonusTitle: x.bonus_title })),
    };
  });
  tree.sort((a, b) => b.count - a.count || b.active - a.active);
  return c.json(tree);
});

/** Beneficiu dat de admin: standard (`standard: true`) sau personalizat; opțional legat de o recomandare. */
adminRoutes.post('/clients/:id/bonuses', ownerOnly, async (c) => {
  const id = c.req.param('id')!;
  const b = await c.req.json<Partial<Reward> & { standard?: boolean; referralOf?: string }>();
  const exists = await c.env.DB.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  if (!exists) throw new HttpError(404, 'not_found');
  const reward = b.standard ? (await getReferralSettings(c.env)).standard : parseReward(b);
  const referralOf = b.referralOf
    ? ((await c.env.DB.prepare('SELECT id FROM clients WHERE id = ? AND referred_by = ?').bind(b.referralOf, id).first<{ id: string }>())?.id ?? null)
    : null;
  const bid = await giveBonus(c.env, id, reward, referralOf ? 'referral' : 'manual', referralOf);
  return c.json({ id: bid }, 201);
});

/** Marchează un bonus folosit (la tuns) sau îl anulează. */
adminRoutes.patch('/bonuses/:id', async (c) => {
  const b = await c.req.json<{ status?: string }>();
  const a = c.get('admin');
  const row = await c.env.DB.prepare('SELECT client_id, status FROM bonuses WHERE id = ?').bind(c.req.param('id')!).first<{ client_id: string; status: string }>();
  if (!row) throw new HttpError(404, 'not_found');
  if (b.status === 'used') {
    await needClient(c, row.client_id);
    if (row.status !== 'active') throw new HttpError(409, 'bonus_not_active');
    await c.env.DB.prepare(`UPDATE bonuses SET status = 'used', used_at = ?, used_by = ? WHERE id = ?`).bind(iso(new Date()), a.adminId, c.req.param('id')!).run();
  } else if (b.status === 'active' || b.status === 'cancelled') {
    if (!a.owner) throw new HttpError(403, 'no_permission');
    await c.env.DB.prepare(`UPDATE bonuses SET status = ?, used_at = NULL, used_by = NULL WHERE id = ?`).bind(b.status, c.req.param('id')!).run();
  } else throw new HttpError(400, 'invalid_status');
  return c.json({ ok: true });
});

// Poze despre client urcate de echipă: le vede doar echipa.
adminRoutes.post('/clients/:id/photos', async (c) => {
  const id = c.req.param('id')!;
  await needClient(c, id);
  const mime = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const p = await addPhoto(c.env, id, mime, await c.req.arrayBuffer(), { adminId: c.get('admin').adminId }, (c.req.query('caption') ?? '').trim());
  return c.json(p, 201);
});

adminRoutes.delete('/clients/:id/photos/:pid', async (c) => {
  const id = c.req.param('id')!;
  await needClient(c, id);
  await deletePhoto(c.env, id, c.req.param('pid')!, true);
  return c.json({ ok: true });
});

adminRoutes.patch('/clients/:id', async (c) => {
  await needClient(c, c.req.param('id')!);
  const b = await c.req.json<{ name?: string; email?: string | null; notes?: string; birthDate?: string | null }>();
  // Fără dreptul „clients”, frizerul poate doar să scrie notițe despre clienții lui.
  if (!c.get('admin').perms.clients && (b.name !== undefined || b.email !== undefined || b.birthDate !== undefined)) throw new HttpError(403, 'no_permission');
  const v: Record<string, unknown> = {};
  if (b.name !== undefined) v.name = String(b.name).slice(0, 80);
  if (b.email !== undefined) v.email = b.email || null;
  if (b.notes !== undefined) v.notes = String(b.notes).slice(0, 2000);
  if (b.birthDate !== undefined) v.birth_date = parseBirthDate(b.birthDate);
  await update(c.env.DB, 'clients', c.req.param('id')!, v);
  return c.json({ ok: true });
});

// --- Regulamente (termeni, confidențialitate) ---

adminRoutes.get('/legal', async (c) => {
  const store = await getLegal(c.env);
  const out: Record<string, unknown> = {};
  for (const d of DOCS) {
    const ro = await legalDoc(c.env, d, 'ro');
    out[d] = { updatedAt: store[d]?.updatedAt ?? null, isDefault: ro.isDefault, versions: { ro: store[d]?.versions?.ro ?? { title: ro.title, body: ro.body }, en: store[d]?.versions?.en ?? null, fr: store[d]?.versions?.fr ?? null } };
  }
  return c.json(out);
});

adminRoutes.put('/legal/:doc', ownerOnly, async (c) => {
  const doc = c.req.param('doc') as (typeof DOCS)[number];
  if (!DOCS.includes(doc)) throw new HttpError(404, 'not_found');
  const b = await c.req.json<{ versions?: Record<string, { title?: string; body?: string } | null> }>();
  const store = await getLegal(c.env);
  const versions: Record<string, { title: string; body: string }> = {};
  for (const l of ['ro', 'en', 'fr']) {
    const v = b.versions?.[l];
    if (v?.title?.trim() && v.body?.trim()) versions[l] = { title: v.title.trim().slice(0, 120), body: v.body.slice(0, 50_000) };
  }
  if (!versions.ro) throw new HttpError(400, 'ro_required');
  store[doc] = { updatedAt: iso(new Date()), versions };
  await saveLegal(c.env, store);
  return c.json({ ok: true, updatedAt: store[doc].updatedAt });
});

/** Renunță la textul editat și revine la modelul standard (cu datele firmei completate automat). */
adminRoutes.delete('/legal/:doc', ownerOnly, async (c) => {
  const doc = c.req.param('doc') as (typeof DOCS)[number];
  if (!DOCS.includes(doc)) throw new HttpError(404, 'not_found');
  const store = await getLegal(c.env);
  store[doc] = { updatedAt: null, versions: {} };
  await saveLegal(c.env, store);
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
  imageUrl?: string | null;
  color?: string | null;
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
  if (b.imageUrl !== undefined) {
    if (b.imageUrl && !isImageUrl(b.imageUrl)) throw new HttpError(400, 'invalid_url');
    v.image_url = b.imageUrl || null;
  }
  if (b.color !== undefined) {
    if (b.color && !/^#[0-9a-fA-F]{6}$/.test(b.color)) throw new HttpError(400, 'invalid_color');
    v.color = b.color ? b.color.toUpperCase() : null;
  }
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

/** Engleza și franceza bannerului se completează singure din română (cele corectate de mână rămân). */
async function translatePromo(env: Env, v: Record<string, unknown>, prev: PromoRow | null) {
  type Tr = Partial<Record<'en' | 'fr', Record<string, string>>>;
  const prevTr = JSON.parse(prev?.translations || '{}') as Tr;
  const nextTr = (v.translations !== undefined ? JSON.parse(v.translations as string) : prevTr) as Tr;
  const out = { en: { ...nextTr.en }, fr: { ...nextTr.fr } };
  for (const k of ['kicker', 'title', 'text', 'cta'] as const) {
    const ro = (v[k] as string | undefined) ?? prev?.[k] ?? '';
    const r = await autoTranslate(
      env,
      { ro: prev?.[k] ?? '', en: prevTr.en?.[k] ?? '', fr: prevTr.fr?.[k] ?? '' },
      { ro, en: out.en[k] ?? '', fr: out.fr[k] ?? '' },
    );
    if (r.en) out.en[k] = r.en;
    if (r.fr) out.fr[k] = r.fr;
  }
  v.translations = JSON.stringify(out);
}

adminRoutes.post('/promos', ownerOnly, async (c) => {
  const v = promoValues(await c.req.json<PromoInput>(), true);
  await translatePromo(c.env, v, null);
  const id = newId('pr');
  const cols = ['id', ...Object.keys(v)];
  await c.env.DB.prepare(`INSERT INTO promos (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(id, ...Object.values(v))
    .run();
  return c.json({ id }, 201);
});

adminRoutes.patch('/promos/:id', ownerOnly, async (c) => {
  const v = promoValues(await c.req.json<PromoInput>(), false);
  const prev = await c.env.DB.prepare('SELECT * FROM promos WHERE id = ?').bind(c.req.param('id')!).first<PromoRow>();
  if (prev) await translatePromo(c.env, v, prev);
  await update(c.env.DB, 'promos', c.req.param('id')!, v);
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
  const [upcoming, month, clients, messages, subs] = await Promise.all([
    db.prepare(`SELECT count(*) AS n FROM bookings WHERE status = 'confirmed' AND starts_at > ? ${f}`).bind(...args(iso(now))).first<{ n: number }>(),
    db
      .prepare(
        `SELECT count(*) AS n,
           coalesce(sum(CASE WHEN status = 'cancelled' THEN 0 WHEN payment = 'paid' THEN paid_bani WHEN payment = 'subscription' THEN 0 ELSE 0 END), 0) AS revenue,
           sum(status = 'cancelled') AS cancelled, sum(status = 'no_show') AS no_show
         FROM bookings WHERE starts_at >= ? AND starts_at < ? ${f}`,
      )
      .bind(...args(dayAgo30, iso(now)))
      .first<{ n: number; revenue: number; cancelled: number; no_show: number }>(),
    db.prepare('SELECT count(*) AS n FROM clients WHERE created_at >= ?').bind(dayAgo30).first<{ n: number }>(),
    db.prepare(`SELECT channel, count(*) AS n FROM message_log WHERE created_at >= ? AND status = 'sent' GROUP BY channel`).bind(dayAgo30).all<{ channel: string; n: number }>(),
    // Abonamentele vândute în perioadă (frizerul vede doar ce a activat el).
    db
      .prepare(`SELECT count(*) AS n, coalesce(sum(price_bani), 0) AS revenue FROM subscriptions WHERE status != 'cancelled' AND created_at >= ? ${scoped ? 'AND created_by = ?' : ''}`)
      .bind(...(scoped ? [dayAgo30, c.get('admin').adminId] : [dayAgo30]))
      .first<{ n: number; revenue: number }>(),
  ]);
  return c.json({
    upcoming: upcoming?.n ?? 0,
    last30: {
      bookings: month?.n ?? 0,
      // Încasări: tunsorile plătite (suma confirmată de frizer) plus abonamentele vândute; tunsorile pe abonament nu se mai numără o dată.
      revenue: showMoney ? ((month?.revenue ?? 0) + (subs?.revenue ?? 0)) / 100 : null,
      subscriptionsSold: subs?.n ?? 0,
      cancelled: month?.cancelled ?? 0,
      noShow: month?.no_show ?? 0,
      newClients: c.get('admin').perms.clients ? (clients?.n ?? 0) : null,
      messages: Object.fromEntries(messages.results.map((m) => [m.channel, m.n])),
    },
  });
});

// --- Tablou de bord și rapoarte (dreptul „Rapoarte”; banii doar cu „Încasări”) ---

const reportScope = (c: Context<AppEnv>, kind?: string) => {
  // Stocul ține de gestiune: cere dreptul „Magazin”, nu „Rapoarte”.
  if (kind === 'stock' || kind === 'stock-moves') {
    need(c, 'shop');
    return { session: c.get('admin'), barberId: null };
  }
  // Registrul de încasări: fiecare frizer îl vede pe al lui, și fără dreptul „Rapoarte”.
  if (kind === 'register' && !c.get('admin').perms.reports) {
    const barberId = c.get('admin').barberId;
    if (!barberId) throw new HttpError(403, 'no_permission');
    return { session: c.get('admin'), barberId };
  }
  need(c, 'reports');
  return { session: c.get('admin'), barberId: ownBarber(c) };
};

adminRoutes.get('/dashboard', async (c) => c.json(await buildDashboard(c.env, reportScope(c))));

adminRoutes.get('/reports', async (c) => {
  const a = c.get('admin');
  const p = a.perms;
  if (!p.reports) {
    if (!a.barberId) throw new HttpError(403, 'no_permission');
    return c.json(REPORTS.filter((r) => r.kind === 'register'));
  }
  return c.json(REPORTS.filter((r) => (!('clients' in r && r.clients) || p.clients) && (!('shop' in r && r.shop) || p.shop)));
});

/** GET /reports/:kind?from=YYYY-MM-DD&to=…&barberId=…&serviceId=…&status=…&format=xlsx */
adminRoutes.get('/reports/:kind', async (c) => {
  const q = c.req.query();
  const r = await buildReport(c.env, reportScope(c, c.req.param('kind')), c.req.param('kind') as ReportKind, q);
  if (q.format !== 'xlsx') return c.json(r);
  const name = `${r.title} ${r.from === r.to ? r.from : `${r.from} - ${r.to}`}`;
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ._-]/g, '').replace(/\s+/g, '-');
  return new Response(xlsx(r.title, reportCells(r)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${ascii}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
      'Cache-Control': 'no-store',
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

const TABLES = new Set(['services', 'barbers', 'bookings', 'clients', 'promos', 'products', 'plans']);
async function update(db: D1Database, table: string, id: string, v: Record<string, unknown>) {
  if (!TABLES.has(table)) throw new Error('bad table');
  const keys = Object.keys(v);
  if (!keys.length) return;
  for (const k of keys) if (!/^[a-z_]+$/.test(k)) throw new Error('bad column');
  await db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(v), id).run();
}
