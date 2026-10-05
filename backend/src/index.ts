import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HttpError, type AppEnv, type Env } from './env';
import { adminRoutes } from './routes/admin';
import { clientRoutes } from './routes/client';
import { publicRoutes } from './routes/public';
import { scheduled } from './cron';

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
