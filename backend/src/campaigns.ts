import type { Env } from './env';
import { getBusiness, tryLock, unlock } from './db';
import { sendEmail, sendPush, sendSms } from './notify';
import { iso } from './time';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function emailHtml(shop: string, title: string, body: string, transactional = false) {
  return `<!doctype html><html><body style="margin:0;background:#000;font-family:Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F0F10;border-radius:20px;overflow:hidden">
<tr><td style="background:#F9A11B;padding:24px 28px;font-size:22px;font-weight:800;color:#000">${esc(shop)}</td></tr>
<tr><td style="padding:28px;color:#fff"><h1 style="margin:0 0 12px;font-size:24px">${esc(title)}</h1>
<div style="font-size:16px;line-height:1.5;color:#E6E3DD">${esc(body).replace(/\n/g, '<br>')}</div></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#A3A09A">${transactional ? `Primești acest e-mail pentru că ai cont la ${esc(shop)}.` : `Primești acest e-mail pentru că ai acceptat ofertele ${esc(shop)} în aplicație. Te poți dezabona oricând din Cont.`}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Câți destinatari se trimit dintr-o rulare; restul îi ia cron-ul la următoarele rulări (limita de cereri a unui Worker). */
const BATCH = 100;

/**
 * Trimite (sau continuă) o campanie către clienții care au acceptat canalul. Merge pe bucăți: fiecare destinatar e trecut
 * în jurnal, iar o rulare nouă (cron-ul, la 5 minute, sau „Reia trimiterea”) sare peste cei care au primit-o deja,
 * așa că o trimitere întreruptă se continuă fără ca cineva să primească mesajul de două ori.
 */
export async function runCampaign(env: Env, id: string) {
  // O singură rulare odată pe campanie (trimiterea din panou și cron-ul se pot suprapune).
  if (!(await tryLock(env, `campaign:${id}`, 5 * 60_000))) return;
  try {
    const cmp = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<{
      id: string;
      channel: 'push' | 'email' | 'sms';
      title: string;
      body: string;
      status: string;
    }>();
    if (!cmp || cmp.status !== 'sending') return;
    const biz = await getBusiness(env);
    const notYet = `NOT EXISTS (SELECT 1 FROM message_log m WHERE m.campaign_id = ?1 AND m.recipient = %s)`;
    let left = 0;
    if (cmp.channel === 'push') {
      const t = await env.DB.prepare(
        `SELECT p.token FROM push_tokens p JOIN clients c ON c.id = p.client_id WHERE c.marketing_push = 1 AND c.deleted_at IS NULL AND ${notYet.replace('%s', 'p.token')} LIMIT ${BATCH * 3}`,
      )
        .bind(id)
        .all<{ token: string }>();
      await sendPush(env, { kind: 'campaign', campaignId: id }, t.results.map((x) => x.token), cmp.title, cmp.body, { campaignId: id });
      left = t.results.length >= BATCH * 3 ? 1 : 0;
    } else if (cmp.channel === 'email') {
      const r = await env.DB.prepare(
        `SELECT DISTINCT c.email FROM clients c WHERE c.marketing_email = 1 AND c.deleted_at IS NULL AND c.email IS NOT NULL AND c.email != '' AND ${notYet.replace('%s', 'c.email')} LIMIT ${BATCH}`,
      )
        .bind(id)
        .all<{ email: string }>();
      const html = emailHtml(biz.name, cmp.title, cmp.body);
      for (const x of r.results) await sendEmail(env, { kind: 'campaign', recipient: x.email, campaignId: id }, cmp.title, html);
      left = r.results.length >= BATCH ? 1 : 0;
    } else {
      const r = await env.DB.prepare(
        `SELECT c.phone FROM clients c WHERE c.marketing_sms = 1 AND c.deleted_at IS NULL AND ${notYet.replace('%s', 'c.phone')} LIMIT ${BATCH}`,
      )
        .bind(id)
        .all<{ phone: string }>();
      for (const x of r.results) await sendSms(env, { kind: 'campaign', recipient: x.phone, campaignId: id }, cmp.body);
      left = r.results.length >= BATCH ? 1 : 0;
    }
    // Câți au primit-o până acum; „Trimisă” abia când nu mai e nimeni de trimis.
    const n = await env.DB.prepare(`SELECT count(DISTINCT recipient) AS n FROM message_log WHERE campaign_id = ? AND status = 'sent'`).bind(id).first<{ n: number }>();
    await env.DB.prepare(`UPDATE campaigns SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, recipients = ? WHERE id = ? AND status = 'sending'`)
      .bind(left ? 'sending' : 'sent', left ? 'sending' : 'sent', iso(new Date()), n?.n ?? 0, id)
      .run();
  } catch (e) {
    console.error('campaign failed', id, e);
    await env.DB.prepare(`UPDATE campaigns SET status = 'failed' WHERE id = ?`).bind(id).run();
  } finally {
    await unlock(env, `campaign:${id}`);
  }
}
