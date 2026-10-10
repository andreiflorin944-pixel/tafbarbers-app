import type { Env } from './env';
import { getBusiness, tryLock, unlock } from './db';
import { sendEmail, sendPush, sendSms } from './notify';
import { iso } from './time';
import { langOf, lookup, type Lang } from './contentI18n';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// Rândul de jos al e-mailului, în limba clientului.
const FOOTER: Record<Lang, { tx: (s: string) => string; mk: (s: string) => string }> = {
  ro: { tx: (s) => `Primești acest e-mail pentru că ai cont la ${s}.`, mk: (s) => `Primești acest e-mail pentru că ai acceptat ofertele ${s} în aplicație. Te poți dezabona oricând din Cont.` },
  en: { tx: (s) => `You are receiving this e-mail because you have an account at ${s}.`, mk: (s) => `You are receiving this e-mail because you accepted offers from ${s} in the app. You can unsubscribe at any time from Account.` },
  fr: { tx: (s) => `Vous recevez cet e-mail parce que vous avez un compte chez ${s}.`, mk: (s) => `Vous recevez cet e-mail parce que vous avez accepté les offres de ${s} dans l’application. Désinscription possible à tout moment depuis Compte.` },
};

export function emailHtml(shop: string, title: string, body: string, transactional = false, lang: string = 'ro') {
  const f = FOOTER[langOf(lang)];
  return `<!doctype html><html><body style="margin:0;background:#000;font-family:Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F0F10;border-radius:20px;overflow:hidden">
<tr><td style="background:#F9A11B;padding:24px 28px;font-size:22px;font-weight:800;color:#000">${esc(shop)}</td></tr>
<tr><td style="padding:28px;color:#fff"><h1 style="margin:0 0 12px;font-size:24px">${esc(title)}</h1>
<div style="font-size:16px;line-height:1.5;color:#E6E3DD">${esc(body).replace(/\n/g, '<br>')}</div></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#A3A09A">${transactional ? f.tx(esc(shop)) : f.mk(esc(shop))}</td></tr>
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
    // Fiecare client primește campania în limba aplicației lui (traducerea făcută la salvare; altfel româna).
    const [en, fr] = await Promise.all([lookup(env, 'en', [cmp.title, cmp.body]), lookup(env, 'fr', [cmp.title, cmp.body])]);
    const text = (lang: string | null | undefined) => {
      const m = langOf(lang) === 'en' ? en : langOf(lang) === 'fr' ? fr : null;
      return { title: m?.get(cmp.title) ?? cmp.title, body: m?.get(cmp.body) ?? cmp.body };
    };
    const notYet = `NOT EXISTS (SELECT 1 FROM message_log m WHERE m.campaign_id = ?1 AND m.recipient = %s)`;
    let left = 0;
    if (cmp.channel === 'push') {
      const t = await env.DB.prepare(
        `SELECT p.token, c.lang FROM push_tokens p JOIN clients c ON c.id = p.client_id WHERE c.marketing_push = 1 AND c.deleted_at IS NULL AND ${notYet.replace('%s', 'p.token')} LIMIT ${BATCH * 3}`,
      )
        .bind(id)
        .all<{ token: string; lang: string }>();
      for (const l of ['ro', 'en', 'fr'] as const) {
        const tokens = t.results.filter((x) => langOf(x.lang) === l).map((x) => x.token);
        if (tokens.length) await sendPush(env, { kind: 'campaign', campaignId: id }, tokens, text(l).title, text(l).body, { campaignId: id });
      }
      left = t.results.length >= BATCH * 3 ? 1 : 0;
    } else if (cmp.channel === 'email') {
      const r = await env.DB.prepare(
        `SELECT c.email, max(c.lang) AS lang FROM clients c WHERE c.marketing_email = 1 AND c.deleted_at IS NULL AND c.email IS NOT NULL AND c.email != '' AND ${notYet.replace('%s', 'c.email')} GROUP BY c.email LIMIT ${BATCH}`,
      )
        .bind(id)
        .all<{ email: string; lang: string }>();
      for (const x of r.results) {
        const m = text(x.lang);
        await sendEmail(env, { kind: 'campaign', recipient: x.email, campaignId: id }, m.title, emailHtml(biz.name, m.title, m.body, false, x.lang));
      }
      left = r.results.length >= BATCH ? 1 : 0;
    } else {
      const r = await env.DB.prepare(
        `SELECT c.phone, c.lang FROM clients c WHERE c.marketing_sms = 1 AND c.deleted_at IS NULL AND ${notYet.replace('%s', 'c.phone')} LIMIT ${BATCH}`,
      )
        .bind(id)
        .all<{ phone: string; lang: string }>();
      for (const x of r.results) await sendSms(env, { kind: 'campaign', recipient: x.phone, campaignId: id }, text(x.lang).body);
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
