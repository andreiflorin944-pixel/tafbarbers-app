import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HttpError, type AppEnv, type Env } from './env';
import { adminRoutes } from './routes/admin';
import { clientRoutes } from './routes/client';
import { publicRoutes } from './routes/public';
import { scheduled } from './cron';
import { DOCS, legalDoc, type Doc } from './legal';

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
