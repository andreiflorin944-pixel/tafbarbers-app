import { Hono, type Context, type Next } from 'hono';
import { newId, sha256 } from './auth';
import { getBusiness } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { getAutomations } from './growth';
import { iso } from './time';

// Coduri QR pentru campanii: fiecare cod are linkul lui (/q/<cod>). La scanare numărăm vizita și deschidem
// aplicația cu codul; când omul intră în cont sau își face cont, îl legăm de campanie.

const TARGETS = new Set(['book', 'home']);
/** O scanare urmată de intrare în cont din aceeași rețea, în cel mult atâtea ore, e socotită „probabil din QR”. */
const PROBABLE_HOURS = 24;

type CampaignRow = { id: string; code: string; name: string; target: string; created_at: string; archived_at: string | null };

/** Adresa IP doar ca amprentă: hash cu o cheie a serverului, nu o păstrăm în clar. */
export async function ipHash(env: Env, c: Context<AppEnv>): Promise<string | null> {
  const ip = c.req.header('CF-Connecting-IP');
  if (!ip) return null;
  return (await sha256(`qr:${env.SOCIAL_KEY ?? env.ADMIN_SETUP_KEY ?? ''}:${ip}`)).slice(0, 32);
}

function device(ua: string): 'ios' | 'android' | 'other' {
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

function newCode(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => abc[x % abc.length]).join('');
}

/**
 * Leagă clientul de o campanie: după codul primit de aplicație (sigur) sau, fără cod, după o scanare
 * din aceeași rețea în ultimele 24 de ore (probabil). Fiecare client contează o singură dată pe campanie.
 */
export async function attributeQr(env: Env, clientId: string, isNew: boolean, code: string | null | undefined, ip: string | null) {
  let campaignId: string | null = null;
  let match: 'exact' | 'probable' = 'exact';
  const clean = typeof code === 'string' ? code.trim().toLowerCase().slice(0, 20) : '';
  if (clean) {
    const r = await env.DB.prepare('SELECT id FROM qr_campaigns WHERE code = ?').bind(clean).first<{ id: string }>();
    campaignId = r?.id ?? null;
  }
  if (!campaignId && ip) {
    const since = iso(new Date(Date.now() - PROBABLE_HOURS * 3_600_000));
    const r = await env.DB.prepare('SELECT campaign_id FROM qr_scans WHERE ip_hash = ? AND at >= ? ORDER BY at DESC LIMIT 1').bind(ip, since).first<{ campaign_id: string }>();
    if (r) (campaignId = r.campaign_id), (match = 'probable');
  }
  if (!campaignId) return;
  await env.DB.prepare(
    `INSERT INTO qr_clients (campaign_id, client_id, kind, match, at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, client_id) DO UPDATE SET match = CASE WHEN excluded.match = 'exact' THEN 'exact' ELSE qr_clients.match END`,
  )
    .bind(campaignId, clientId, isNew ? 'signup' : 'login', match, iso(new Date()))
    .run();
}

/** Pagina care deschide aplicația (sau arată linkurile spre magazine dacă nu e instalată). */
export async function openAppPage(env: Env, deep: string): Promise<string> {
  const [biz, auto] = await Promise.all([getBusiness(env), getAutomations(env)]);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const store = [
    auto.links.appStoreUrl ? `<a class="s" href="${esc(auto.links.appStoreUrl)}">App Store (iPhone)</a>` : '',
    auto.links.playStoreUrl ? `<a class="s" href="${esc(auto.links.playStoreUrl)}">Google Play (Android)</a>` : '',
  ].join('');
  const phone = biz.phone ? `<p class="m">Sau sună-ne: <a href="tel:${esc(biz.phone.replace(/\s+/g, ''))}">${esc(biz.phone)}</a></p>` : '';
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programează-te la ${esc(biz.name)}</title>
<meta property="og:title" content="Programează-te la ${esc(biz.name)}"><meta property="og:description" content="Alege serviciul, frizerul și ora, direct din aplicație.">
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:56px 20px;text-align:center}h1{font-size:28px;margin:0 0 6px}a.b{display:block;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:16px;border-radius:999px;margin:26px 0 12px}a.s{display:block;border:1px solid #333;color:#eee;text-decoration:none;padding:13px;border-radius:999px;margin-top:10px}.m{color:#999;font-size:14px}a{color:#F9A11B}</style></head>
<body><main><h1>${esc(biz.name)}</h1><p class="m">${esc(biz.address || 'Programează-te în câteva secunde')}</p>
<a class="b" href="${esc(deep)}">Deschide aplicația</a>${store ? `<p class="m">Nu ai aplicația? Instaleaz-o:</p>${store}` : ''}${phone}</main>
<script>setTimeout(function(){location.href=${JSON.stringify(deep)}},300)</script></body></html>`;
}

// --- Linkul din cod (public) ---

export const qrPublic = new Hono<AppEnv>();

qrPublic.get('/q/:code', async (c) => {
  const code = c.req.param('code').toLowerCase().slice(0, 20);
  const camp = await c.env.DB.prepare('SELECT * FROM qr_campaigns WHERE code = ?').bind(code).first<CampaignRow>();
  // Un cod necunoscut sau oprit tot deschide aplicația, doar că nu se numără.
  if (!camp || camp.archived_at) return c.html(await openAppPage(c.env, 'tafbarbers://'));
  const ip = await ipHash(c.env, c);
  c.executionCtx.waitUntil(
    c.env.DB.prepare('INSERT INTO qr_scans (id, campaign_id, at, device, ip_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(newId('qs'), camp.id, iso(new Date()), device(c.req.header('User-Agent') ?? ''), ip)
      .run(),
  );
  const deep = camp.target === 'book' ? `tafbarbers://book?qr=${code}` : `tafbarbers://?qr=${code}`;
  return c.html(await openAppPage(c.env, deep));
});

// --- Panoul (doar proprietarul) ---

export const qrAdmin = new Hono<AppEnv>();

async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}
qrAdmin.use('/qr', ownerOnly);
qrAdmin.use('/qr/*', ownerOnly);

const baseUrl = (env: Env, reqUrl: string) => (env.PUBLIC_URL ?? new URL(reqUrl).origin).replace(/\/+$/, '');

type Stats = { campaign_id: string; scans: number; people: number; signups: number; logins: number; bookings: number; revenue: number };

async function stats(env: Env, id?: string): Promise<Map<string, Stats>> {
  const where = id ? 'WHERE campaign_id = ?' : '';
  const args = id ? [id] : [];
  const [scans, clients, books] = await Promise.all([
    env.DB.prepare(`SELECT campaign_id, count(*) AS scans, count(DISTINCT coalesce(ip_hash, id)) AS people FROM qr_scans ${where} GROUP BY campaign_id`).bind(...args).all<{ campaign_id: string; scans: number; people: number }>(),
    env.DB.prepare(`SELECT campaign_id, sum(kind = 'signup') AS signups, sum(kind = 'login') AS logins FROM qr_clients ${where} GROUP BY campaign_id`).bind(...args).all<{ campaign_id: string; signups: number; logins: number }>(),
    // Programările făcute de acești clienți după ce au venit prin cod.
    env.DB.prepare(
      `SELECT q.campaign_id, count(b.id) AS bookings, coalesce(sum(CASE WHEN b.status = 'completed' THEN b.paid_bani ELSE 0 END), 0) AS revenue
       FROM qr_clients q JOIN bookings b ON b.client_id = q.client_id AND b.created_at >= q.at AND b.status != 'cancelled'
       ${id ? 'WHERE q.campaign_id = ?' : ''} GROUP BY q.campaign_id`,
    ).bind(...args).all<{ campaign_id: string; bookings: number; revenue: number }>(),
  ]);
  const m = new Map<string, Stats>();
  const get = (k: string) => m.get(k) ?? (m.set(k, { campaign_id: k, scans: 0, people: 0, signups: 0, logins: 0, bookings: 0, revenue: 0 }), m.get(k)!);
  for (const r of scans.results) Object.assign(get(r.campaign_id), { scans: r.scans, people: r.people });
  for (const r of clients.results) Object.assign(get(r.campaign_id), { signups: r.signups ?? 0, logins: r.logins ?? 0 });
  for (const r of books.results) Object.assign(get(r.campaign_id), { bookings: r.bookings, revenue: (r.revenue ?? 0) / 100 });
  return m;
}

function campaign(env: Env, reqUrl: string, r: CampaignRow, s?: Stats) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    target: r.target,
    url: `${baseUrl(env, reqUrl)}/q/${r.code}`,
    createdAt: r.created_at,
    archived: !!r.archived_at,
    scans: s?.scans ?? 0,
    people: s?.people ?? 0,
    signups: s?.signups ?? 0,
    logins: s?.logins ?? 0,
    bookings: s?.bookings ?? 0,
    revenue: s?.revenue ?? 0,
  };
}

qrAdmin.get('/qr', async (c) => {
  const [rows, st] = await Promise.all([c.env.DB.prepare('SELECT * FROM qr_campaigns ORDER BY archived_at IS NOT NULL, created_at DESC').all<CampaignRow>(), stats(c.env)]);
  return c.json(rows.results.map((r) => campaign(c.env, c.req.url, r, st.get(r.id))));
});

qrAdmin.post('/qr', async (c) => {
  const b = await c.req.json<{ name?: string; target?: string }>();
  const name = (b.name ?? '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'name_required');
  const target = TARGETS.has(b.target ?? '') ? b.target! : 'book';
  const row: CampaignRow = { id: newId('qr'), code: newCode(), name, target, created_at: iso(new Date()), archived_at: null };
  await c.env.DB.prepare('INSERT INTO qr_campaigns (id, code, name, target, created_at) VALUES (?, ?, ?, ?, ?)').bind(row.id, row.code, row.name, row.target, row.created_at).run();
  return c.json(campaign(c.env, c.req.url, row), 201);
});

qrAdmin.patch('/qr/:id', async (c) => {
  const b = await c.req.json<{ name?: string; target?: string; archived?: boolean }>();
  const id = c.req.param('id');
  if (typeof b.name === 'string') {
    const name = b.name.trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'name_required');
    await c.env.DB.prepare('UPDATE qr_campaigns SET name = ? WHERE id = ?').bind(name, id).run();
  }
  if (b.target && TARGETS.has(b.target)) await c.env.DB.prepare('UPDATE qr_campaigns SET target = ? WHERE id = ?').bind(b.target, id).run();
  if (typeof b.archived === 'boolean') await c.env.DB.prepare('UPDATE qr_campaigns SET archived_at = ? WHERE id = ?').bind(b.archived ? iso(new Date()) : null, id).run();
  const r = await c.env.DB.prepare('SELECT * FROM qr_campaigns WHERE id = ?').bind(id).first<CampaignRow>();
  if (!r) throw new HttpError(404, 'not_found');
  return c.json(campaign(c.env, c.req.url, r, (await stats(c.env, id)).get(id)));
});

/** Detaliile unui cod: scanări pe zile și telefoane, plus lista clienților veniți prin el. */
qrAdmin.get('/qr/:id', async (c) => {
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('SELECT * FROM qr_campaigns WHERE id = ?').bind(id).first<CampaignRow>();
  if (!r) throw new HttpError(404, 'not_found');
  const [st, days, devices, clients] = await Promise.all([
    stats(c.env, id),
    c.env.DB.prepare('SELECT substr(at, 1, 10) AS day, count(*) AS n FROM qr_scans WHERE campaign_id = ? GROUP BY day ORDER BY day DESC LIMIT 60').bind(id).all<{ day: string; n: number }>(),
    c.env.DB.prepare('SELECT device, count(*) AS n FROM qr_scans WHERE campaign_id = ? GROUP BY device').bind(id).all<{ device: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT q.client_id, q.kind, q.match, q.at, cl.name, cl.phone,
         (SELECT count(*) FROM bookings b WHERE b.client_id = q.client_id AND b.created_at >= q.at AND b.status != 'cancelled') AS bookings
       FROM qr_clients q LEFT JOIN clients cl ON cl.id = q.client_id WHERE q.campaign_id = ? ORDER BY q.at DESC LIMIT 500`,
    ).bind(id).all<{ client_id: string; kind: string; match: string; at: string; name: string | null; phone: string | null; bookings: number }>(),
  ]);
  return c.json({
    ...campaign(c.env, c.req.url, r, st.get(id)),
    days: days.results.reverse(),
    devices: Object.fromEntries(devices.results.map((d) => [d.device, d.n])),
    clients: clients.results.map((x) => ({ id: x.client_id, name: x.name ?? '', phone: x.phone ?? '', kind: x.kind, match: x.match, at: x.at, bookings: x.bookings })),
  });
});
