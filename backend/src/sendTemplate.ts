import { localizeText } from './contentI18n';
import { getBusiness } from './db';
import type { Env } from './env';
import { channelsFor, type ChannelEvent } from './growth';
import { EMAIL_WORDS, langKey, publicBase, sendBrandEmail, type EmailContent } from './emailLayout';
import { sendPush, sendSms } from './notify';
import { renderTemplate, type TplEvent } from './templates';

/**
 * Trimite unui client mesajul automat al unui eveniment, pe canalele bifate în panou (Notificări → Ce se trimite și pe unde),
 * cu textele din șabloane. Întoarce pe ce canale a plecat.
 */
/** `opts.channel`: un șablon-variantă (ex. comanda gata, plătită deja) folosește canalele bifate la evenimentul de bază. */
export async function sendTemplate(
  env: Env,
  event: (TplEvent & ChannelEvent) | 'order_ready_paid',
  clientId: string,
  vars: Record<string, string>,
  opts: { bookingId?: string; data?: Record<string, string>; channel?: ChannelEvent } = {},
): Promise<{ sms: boolean; push: boolean; email: boolean; off?: boolean }> {
  const out = { sms: false, push: false, email: false };
  const ch = await channelsFor(env, opts.channel ?? (event === 'order_ready_paid' ? 'order_ready' : event));
  if (!ch) return { ...out, off: true };
  const c = await env.DB.prepare('SELECT phone, email, lang, name, phone_unverified FROM clients WHERE id = ?')
    .bind(clientId)
    .first<{ phone: string; email: string | null; lang: string; name: string; phone_unverified: number | null }>();
  if (!c || c.phone.startsWith('deleted:')) return out;
  const biz = await getBusiness(env);
  const name = (c.name ?? '').trim();
  // Serviciul și abonamentul sunt scrise în panou în română: clientul le primește în limba lui (unde există traducerea).
  const tr: Record<string, string> = {};
  for (const k of ['servicename', 'membershipplanname']) if (vars[k]) tr[k] = await localizeText(env, c.lang, vars[k]);
  const t = await renderTemplate(env, event, c.lang, {
    businessname: biz.name,
    businessphone: biz.phone ?? '',
    customerfullname: name,
    customerfirstname: name.split(/\s+/)[0] ?? '',
    ...vars,
    ...tr,
  });
  const log = { kind: event, bookingId: opts.bookingId };
  // Numărul nedovedit (cont făcut cu cod pe e-mail) poate fi al altcuiva: fără SMS până nu intră cu cod pe acel număr.
  if (ch.sms && t.sms && !c.phone_unverified) out.sms = await sendSms(env, { ...log, recipient: c.phone }, t.sms);
  if (ch.push && t.pushTitle) {
    const tokens = (await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(clientId).all<{ token: string }>()).results.map((x) => x.token);
    if (tokens.length) out.push = (await sendPush(env, log, tokens, t.pushTitle, t.pushBody, opts.data ?? {})) > 0;
  }
  if (ch.email && c.email && t.emailSubject) {
    const allVars: Record<string, string> = { businessname: biz.name, businessphone: biz.phone ?? '', ...vars, ...tr };
    out.email = await sendBrandEmail(env, { ...log, recipient: c.email }, t.emailSubject, emailParts(env, event, c.lang, t.emailSubject, t.emailBody, allVars));
  }
  return out;
}

const BOOKING_EVENTS = ['confirm', 'cancel', 'client_cancel', 'booking_moved', 'booking_request', 'booking_request_refused', 'booking_request_expired', 'waitlist_slot', 'reminder_24h', 'reminder_2h'];
const REBOOK_EVENTS = ['cancel', 'client_cancel', 'booking_request_refused', 'booking_request_expired'];

/** Titlul e subiectul fără „· Salon” de la final (salonul e deja în logo). */
const titleOf = (subject: string, shop: string) => subject.replace(new RegExp(`\\s*[·|\\-–]\\s*${shop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '').trim() || subject;
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Din textul șablonului face e-mailul cu aspect TAF: caseta cu detaliile programării, butonul (linkul programării, recenzia,
 * plata) și textul fără adresa lungă a linkului (care ajunge în buton).
 */
export function emailParts(env: Env, event: string, lang: string, subject: string, body: string, v: Record<string, string>): EmailContent {
  const w = EMAIL_WORDS[langKey(lang)];
  const details: Array<[string, string]> = [];
  const add = (label: string, value?: string) => value?.trim() && details.push([label, value.trim()]);
  let button: EmailContent['button'];
  if (BOOKING_EVENTS.includes(event)) {
    add(w.service, v.servicename);
    add(w.barber, v.barbername);
    add(w.when, cap(v.datetime ?? ''));
    if (event === 'waitlist_slot') add(w.times, v.times);
    add(w.price, v.price);
    if (v.location?.trim()) add(w.location, [v.locationname, v.locationaddress].filter(Boolean).join(', '));
    if (event === 'waitlist_slot' && v.booklink) button = { label: w.bookSlot, url: v.booklink };
    else if (REBOOK_EVENTS.includes(event)) button = publicBase(env) ? { label: w.rebook, url: publicBase(env) } : undefined;
    else if (v.managelink) button = { label: event === 'booking_request' ? w.request : w.manage, url: v.managelink };
  } else if (event.startsWith('sub_')) {
    add(w.plan, v.membershipplanname);
    add(w.until, v.enddate);
    add(w.amount, v.amount);
    if (v.paylink) button = { label: w.pay, url: v.paylink };
  } else if (event === 'pay_request') {
    add(w.service, v.servicename);
    add(w.barber, v.barbername);
    add(w.when, cap(v.datetime ?? ''));
    add(w.amount, v.amount);
    if (v.paylink) button = { label: w.pay, url: v.paylink };
  } else if (event.startsWith('order_')) {
    add(w.order, v.ordernumber);
  } else if (event === 'review' && v.reviewlink) {
    button = { label: w.review, url: v.reviewlink };
  }
  return { lang, title: titleOf(subject, v.businessname ?? ''), body: stripLink(body, button?.url, lang), transactional: true, details, button };
}

/** Scoate din text adresa care a ajuns în buton („… anuleaz-o de aici: https://…” → „… anuleaz-o mai jos.”). */
export function stripLink(body: string, url: string | undefined, lang: string): string {
  if (!url || !body.includes(url)) return body;
  const below = langKey(lang) === 'en' ? 'below' : langKey(lang) === 'fr' ? 'ci-dessous' : 'mai jos';
  const u = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .replace(new RegExp(`\\s+(?:de\\s+)?(?:aici|here|ici)\\s*:?\\s*${u}`, 'g'), ` ${below}.`)
    .replace(new RegExp(`\\s*:?\\s*${u}`, 'g'), '')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
