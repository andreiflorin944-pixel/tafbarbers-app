import { emailHtml } from './campaigns';
import { getBusiness, getSetting, setSetting } from './db';
import type { Env } from './env';
import { newId } from './auth';
import { sendEmail, sendPush } from './notify';
import { iso } from './time';

// Erorile de pe server se păstrează lângă cele din aplicația de pe telefon (panou: Setări → Erori din aplicație, platforma „server”),
// iar proprietarul primește un e-mail (și push în aplicația echipei) cel mult o dată pe oră când apar erori noi.

/** Scrie eroarea în jurnalul din panou (și în consola Cloudflare). Nu aruncă niciodată. */
export async function recordServerError(env: Env, where: string, err: unknown) {
  console.error(where, err);
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO app_errors (id, platform, fatal, message, stack) VALUES (?, ?, 1, ?, ?)').bind(
        newId('err'),
        'server',
        `${where}: ${e.message}`.slice(0, 500),
        (e.stack ?? '').slice(0, 4000),
      ),
      env.DB.prepare('DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY created_at DESC LIMIT 300)'),
    ]);
  } catch (x) {
    console.error('record server error', x);
  }
}

const HOUR = 3_600_000;

/** Din cron: dacă au apărut erori de server de la ultimul anunț (și a trecut cel puțin o oră de atunci), anunță proprietarii. */
export async function alertServerErrors(env: Env, now = new Date()) {
  const st = await getSetting(env, 'error_alert', { at: '' });
  if (st.at && now.getTime() - Date.parse(st.at) < HOUR) return 0;
  const since = st.at || iso(new Date(now.getTime() - HOUR));
  const r = await env.DB.prepare(
    `SELECT message, count(*) AS n FROM app_errors WHERE platform = 'server' AND fatal = 1 AND created_at > ? GROUP BY message ORDER BY n DESC LIMIT 20`,
  )
    .bind(since)
    .all<{ message: string; n: number }>();
  const total = r.results.reduce((s, x) => s + x.n, 0);
  if (!total) return 0;
  // Marcat înainte de trimitere: două rulări suprapuse nu trimit de două ori.
  await setSetting(env, 'error_alert', { at: iso(now) });
  const biz = await getBusiness(env);
  const title = total === 1 ? `${biz.name}: o eroare pe server` : `${biz.name}: ${total} erori pe server`;
  const lines = r.results.slice(0, 5).map((x) => `• ${x.message}${x.n > 1 ? ` (de ${x.n} ori)` : ''}`);
  const body = `${lines.join('\n')}\n\nToate erorile sunt în panou: Setări → Erori din aplicație. Dacă se repetă, trimite-le mai departe ca să fie reparate.`;
  const owners = await env.DB.prepare(`SELECT id, email FROM admins WHERE role = 'org_admin'`).all<{ id: string; email: string }>();
  for (const o of owners.results) {
    if (o.email) await sendEmail(env, { kind: 'server_error', recipient: o.email }, title, emailHtml(biz.name, title, body, true));
  }
  const ids = owners.results.map((o) => o.id);
  if (ids.length) {
    const tokens = await env.DB.prepare(`SELECT token FROM staff_push_tokens WHERE admin_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<{ token: string }>();
    if (tokens.results.length) await sendPush(env, { kind: 'server_error' }, tokens.results.map((t) => t.token), title, lines[0] ?? '', { screen: 'errors' });
  }
  return total;
}

/** Ultima rulare a cron-ului (la 5 minute); `/v1/health` o folosește ca un monitor extern să afle dacă s-a oprit. */
export const CRON_STALE_MS = 20 * 60_000;
export const markCronRun = (env: Env, now: Date) => setSetting(env, 'cron_last_run', { at: iso(now) });
export async function health(env: Env) {
  const st = await getSetting(env, 'cron_last_run', { at: '' });
  const cronOk = !!st.at && Date.now() - Date.parse(st.at) < CRON_STALE_MS;
  return { ok: cronOk, cronLastRun: st.at || null };
}
