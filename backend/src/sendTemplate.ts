import { emailHtml } from './campaigns';
import { localizeText } from './contentI18n';
import { getBusiness } from './db';
import type { Env } from './env';
import { channelsFor, type ChannelEvent } from './growth';
import { sendEmail, sendPush, sendSms } from './notify';
import { renderTemplate, type TplEvent } from './templates';

/**
 * Trimite unui client mesajul automat al unui eveniment, pe canalele bifate în panou (Notificări → Ce se trimite și pe unde),
 * cu textele din șabloane. Întoarce pe ce canale a plecat.
 */
export async function sendTemplate(
  env: Env,
  event: TplEvent & ChannelEvent,
  clientId: string,
  vars: Record<string, string>,
  opts: { bookingId?: string; data?: Record<string, string> } = {},
): Promise<{ sms: boolean; push: boolean; email: boolean; off?: boolean }> {
  const out = { sms: false, push: false, email: false };
  const ch = await channelsFor(env, event);
  if (!ch) return { ...out, off: true };
  const c = await env.DB.prepare('SELECT phone, email, lang, name FROM clients WHERE id = ?')
    .bind(clientId)
    .first<{ phone: string; email: string | null; lang: string; name: string }>();
  if (!c || c.phone.startsWith('deleted:')) return out;
  const biz = await getBusiness(env);
  const name = (c.name ?? '').trim();
  // Serviciul și abonamentul sunt scrise în panou în română: clientul le primește în limba lui (unde există traducerea).
  const tr: Record<string, string> = {};
  for (const k of ['servicename', 'membershipplanname']) if (vars[k]) tr[k] = await localizeText(env, c.lang, vars[k]);
  const t = await renderTemplate(env, event, c.lang, {
    businessname: biz.name,
    customerfullname: name,
    customerfirstname: name.split(/\s+/)[0] ?? '',
    ...vars,
    ...tr,
  });
  const log = { kind: event, bookingId: opts.bookingId };
  if (ch.sms && t.sms) out.sms = await sendSms(env, { ...log, recipient: c.phone }, t.sms);
  if (ch.push && t.pushTitle) {
    const tokens = (await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(clientId).all<{ token: string }>()).results.map((x) => x.token);
    if (tokens.length) out.push = (await sendPush(env, log, tokens, t.pushTitle, t.pushBody, opts.data ?? {})) > 0;
  }
  if (ch.email && c.email && t.emailSubject) {
    out.email = await sendEmail(env, { ...log, recipient: c.email }, t.emailSubject, emailHtml(biz.name, t.emailSubject, t.emailBody, true, c.lang));
  }
  return out;
}
