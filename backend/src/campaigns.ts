import type { Env } from './env';
import { getBusiness } from './db';
import { sendEmail, sendPush, sendSms } from './notify';
import { iso } from './time';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function emailHtml(shop: string, title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#000;font-family:Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F0F10;border-radius:20px;overflow:hidden">
<tr><td style="background:#F9A11B;padding:24px 28px;font-size:22px;font-weight:800;color:#000">${esc(shop)}</td></tr>
<tr><td style="padding:28px;color:#fff"><h1 style="margin:0 0 12px;font-size:24px">${esc(title)}</h1>
<div style="font-size:16px;line-height:1.5;color:#E6E3DD">${esc(body).replace(/\n/g, '<br>')}</div></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#A3A09A">Primești acest e-mail pentru că ai acceptat ofertele ${esc(shop)} în aplicație. Te poți dezabona oricând din Cont.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Trimite o campanie către clienții care au acceptat canalul respectiv. */
export async function runCampaign(env: Env, id: string) {
  const cmp = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<{
    id: string;
    channel: 'push' | 'email' | 'sms';
    title: string;
    body: string;
  }>();
  if (!cmp) return;
  const biz = await getBusiness(env);
  let recipients = 0;
  try {
    if (cmp.channel === 'push') {
      const t = await env.DB.prepare(
        'SELECT p.token FROM push_tokens p JOIN clients c ON c.id = p.client_id WHERE c.marketing_push = 1',
      ).all<{ token: string }>();
      recipients = await sendPush(env, { kind: 'campaign', campaignId: id }, t.results.map((x) => x.token), cmp.title, cmp.body, {
        campaignId: id,
      });
    } else if (cmp.channel === 'email') {
      const r = await env.DB.prepare(
        `SELECT email FROM clients WHERE marketing_email = 1 AND email IS NOT NULL AND email != ''`,
      ).all<{ email: string }>();
      const html = emailHtml(biz.name, cmp.title, cmp.body);
      for (const x of r.results) if (await sendEmail(env, { kind: 'campaign', recipient: x.email, campaignId: id }, cmp.title, html)) recipients++;
    } else {
      const r = await env.DB.prepare('SELECT phone FROM clients WHERE marketing_sms = 1').all<{ phone: string }>();
      for (const x of r.results) if (await sendSms(env, { kind: 'campaign', recipient: x.phone, campaignId: id }, cmp.body)) recipients++;
    }
    await env.DB.prepare(`UPDATE campaigns SET status = 'sent', sent_at = ?, recipients = ? WHERE id = ?`)
      .bind(iso(new Date()), recipients, id)
      .run();
  } catch (e) {
    console.error('campaign failed', id, e);
    await env.DB.prepare(`UPDATE campaigns SET status = 'failed', recipients = ? WHERE id = ?`).bind(recipients, id).run();
  }
}
