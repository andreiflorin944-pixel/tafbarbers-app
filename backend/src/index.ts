import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HttpError, type AppEnv, type Env } from './env';
import { adminRoutes } from './routes/admin';
import { clientRoutes } from './routes/client';
import { publicRoutes } from './routes/public';
import { scheduled } from './cron';
import { getAutomations } from './growth';
import { DOCS, legalDoc, type Doc } from './legal';
import { getBusiness } from './db';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const origins = c.env.CORS_ORIGINS.split(',').map((s) => s.trim());
  return cors({
    origin: origins.includes('*') ? '*' : origins,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  })(c, next);
});

app.get('/v1', (c) => c.json({ name: 'tafbarbers-api', ok: true }));
app.route('/v1', publicRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/v1', clientRoutes);

// Pagini publice pentru regulamente (link pentru App Store / Google Play și site).
app.get('/legal/:doc', async (c) => {
  const doc = c.req.param('doc') as Doc;
  if (!DOCS.includes(doc)) return c.text('Not found', 404);
  const lang = ['ro', 'en', 'fr'].includes(c.req.query('lang') ?? '') ? c.req.query('lang')! : 'ro';
  const d = await legalDoc(c.env, doc, lang);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const updated = d.updatedAt ? `<p class="m">Actualizat: ${d.updatedAt.slice(0, 10)}</p>` : '';
  return c.html(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title>
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px}h1{color:#F9A11B;font-size:26px}.m{color:#999;font-size:14px}p{white-space:pre-wrap}</style></head>
<body><main><h1>${esc(d.title)}</h1>${updated}<p>${esc(d.body)}</p></main></body></html>`);
});

// Linkul de recomandare: pagină simplă care deschide aplicația cu codul completat.
app.get('/r/:code', async (c) => {
  const code = c.req.param('code').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const biz = await getBusiness(c.env);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const deep = `tafbarbers://login?ref=${code}`;
  return c.html(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(biz.name)}</title>
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:48px 20px;text-align:center}h1{font-size:26px}.code{font-size:34px;font-weight:800;letter-spacing:6px;color:#F9A11B;margin:18px 0}a.b{display:inline-block;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-top:10px}.m{color:#999;font-size:14px}</style></head>
<body><main><h1>Ai fost invitat la ${esc(biz.name)}</h1><p>Fă-ți cont în aplicație cu codul de mai jos:</p><div class="code">${esc(code)}</div>
<a class="b" href="${deep}">Deschide aplicația</a><p class="m">Dacă nu ai încă aplicația, instaleaz-o, apoi scrie codul la crearea contului.</p></main></body></html>`);
});

// Butonul „Programează” din Google Maps, Instagram, Facebook sau site: deschide aplicația direct la programare
// și numără de unde vin clienții (?src=google | instagram | facebook | site | qr).
const LINK_SOURCES = new Set(['google', 'instagram', 'facebook', 'tiktok', 'site', 'qr', 'altul']);
app.get('/programare', async (c) => {
  const raw = (c.req.query('src') ?? '').toLowerCase();
  const src = LINK_SOURCES.has(raw) ? raw : 'altul';
  const day = new Date().toISOString().slice(0, 10);
  c.executionCtx.waitUntil(
    c.env.DB.prepare('INSERT INTO link_clicks (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1').bind(day, src).run(),
  );
  const [biz, auto] = await Promise.all([getBusiness(c.env), getAutomations(c.env)]);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const deep = `tafbarbers://book?src=${src}`;
  const store = [
    auto.links.appStoreUrl ? `<a class="s" href="${esc(auto.links.appStoreUrl)}">App Store (iPhone)</a>` : '',
    auto.links.playStoreUrl ? `<a class="s" href="${esc(auto.links.playStoreUrl)}">Google Play (Android)</a>` : '',
  ].join('');
  const phone = biz.phone ? `<p class="m">Sau sună-ne: <a href="tel:${esc(biz.phone.replace(/\s+/g, ''))}">${esc(biz.phone)}</a></p>` : '';
  return c.html(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programează-te la ${esc(biz.name)}</title>
<meta property="og:title" content="Programează-te la ${esc(biz.name)}"><meta property="og:description" content="Alege serviciul, frizerul și ora, direct din aplicație.">
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:56px 20px;text-align:center}h1{font-size:28px;margin:0 0 6px}a.b{display:block;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:16px;border-radius:999px;margin:26px 0 12px}a.s{display:block;border:1px solid #333;color:#eee;text-decoration:none;padding:13px;border-radius:999px;margin-top:10px}.m{color:#999;font-size:14px}a{color:#F9A11B}</style></head>
<body><main><h1>${esc(biz.name)}</h1><p class="m">${esc(biz.address || 'Programează-te în câteva secunde')}</p>
<a class="b" href="${deep}">Programează-te în aplicație</a>${store ? `<p class="m">Nu ai aplicația? Instaleaz-o:</p>${store}` : ''}${phone}</main>
<script>setTimeout(function(){location.href=${JSON.stringify(deep)}},300)</script></body></html>`);
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: async (_e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;
