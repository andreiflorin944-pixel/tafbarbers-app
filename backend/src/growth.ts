// Mesajele automate care aduc clienții înapoi și umplu programul: „Ne e dor de tine”, ore libere de ultim moment,
// textul cardului cadou și linkurile „Programează” (Google Maps, Instagram). Textele se editează din panou, Setări → Notificări.
import { autoTranslate } from './translate';
import { availability } from './availability';
import { emailHtml } from './campaigns';
import { getBusiness, getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';
import { sendEmail, sendPush, sendSms } from './notify';
import { giveBonus, parseReward, type Reward } from './referrals';
import { addDays, iso, localDay, localMinutes, localToUtc, roLocal } from './time';

type Lang = 'ro' | 'en' | 'fr';
type Texts = Record<Lang, string>;

export type WinbackSettings = {
  enabled: boolean;
  weeks: number; // după câte săptămâni fără vizită
  hour: number;
  push: boolean;
  email: boolean;
  sms: boolean;
  title: Texts;
  message: Texts; // {nume}, {salon}, {saptamani}
  bonus: boolean;
  reward: Reward;
};
export type LastMinuteSettings = {
  enabled: boolean;
  hours: number[]; // la ce ore (locale) se verifică golurile
  window: number; // golurile din următoarele N ore
  maxPerWeek: number; // de câte ori pe săptămână primește un client
  push: boolean;
  email: boolean;
  sms: boolean;
  title: Texts;
  message: Texts; // {nume}, {salon}, {ore}
};
export type GiftCardSettings = {
  enabled: boolean;
  amounts: number[]; // sumele propuse în aplicație (lei)
  validMonths: number;
  title: Texts;
  message: Texts; // {nume}, {de_la}, {suma}, {cod}, {mesaj}, {salon}
};
export type LinkSettings = { appStoreUrl: string; playStoreUrl: string; googleReviewUrl: string };
/** Notificările despre programări, comenzi și carduri cadou: adminul alege dacă pleacă și pe ce canale. */
export type ChannelEvent = 'confirm' | 'cancel' | 'reminder_24h' | 'reminder_2h' | 'review' | 'order_created' | 'order_ready' | 'order_cancelled' | 'gift_card' | 'sub_started';
export type Channel = { enabled: boolean; push: boolean; sms: boolean; email: boolean };
export const CHANNEL_EVENTS: ChannelEvent[] = ['confirm', 'cancel', 'reminder_24h', 'reminder_2h', 'review', 'order_created', 'order_ready', 'order_cancelled', 'gift_card', 'sub_started'];
export type Automations = {
  winback: WinbackSettings;
  lastMinute: LastMinuteSettings;
  giftCard: GiftCardSettings;
  links: LinkSettings;
  channels: Record<ChannelEvent, Channel>;
  /** Codul de intrare poate fi cerut și prin SMS (varianta de rezervă când nu vine e-mailul). */
  otpSms: boolean;
};

export const DEFAULT_AUTOMATIONS: Automations = {
  winback: {
    enabled: false,
    weeks: 6,
    hour: 11,
    push: true,
    email: true,
    sms: false,
    title: { ro: 'Ne e dor de tine, {nume}!', en: 'We miss you, {nume}!', fr: 'Vous nous manquez, {nume} !' },
    message: {
      ro: 'Au trecut {saptamani} săptămâni de la ultima tunsoare la {salon}. Hai să te aranjăm din nou!',
      en: "It's been {saptamani} weeks since your last cut at {salon}. Come get a fresh one!",
      fr: 'Cela fait {saptamani} semaines depuis votre dernière coupe chez {salon}. Revenez nous voir !',
    },
    bonus: true,
    reward: { title: '10% reducere la revenire', kind: 'percent', value: 10, validDays: 21 },
  },
  lastMinute: {
    enabled: false,
    hours: [10, 14],
    window: 4,
    maxPerWeek: 1,
    push: true,
    email: false,
    sms: false,
    title: { ro: 'Avem locuri libere azi', en: 'Free spots today', fr: 'Places libres aujourd’hui' },
    message: {
      ro: '{nume}, s-au eliberat ore azi la {salon}: {ore}. Rezervă din aplicație până nu le ia altcineva.',
      en: '{nume}, spots opened up today at {salon}: {ore}. Book in the app before they’re gone.',
      fr: '{nume}, des créneaux se sont libérés aujourd’hui chez {salon} : {ore}. Réservez dans l’application.',
    },
  },
  giftCard: {
    enabled: true,
    amounts: [50, 100, 150, 200],
    validMonths: 12,
    title: { ro: 'Ai primit un card cadou de {suma} lei', en: 'You received a {suma} lei gift card', fr: 'Vous avez reçu une carte cadeau de {suma} lei' },
    message: {
      ro: '{nume}, {de_la} ți-a făcut cadou o tunsoare la {salon}. Codul tău: {cod}. {mesaj}',
      en: '{nume}, {de_la} gave you a gift at {salon}. Your code: {cod}. {mesaj}',
      fr: '{nume}, {de_la} vous offre un cadeau chez {salon}. Votre code : {cod}. {mesaj}',
    },
  },
  links: { appStoreUrl: '', playStoreUrl: '', googleReviewUrl: '' },
  // Cum funcționa până acum: SMS la toate, plus push la reminder-e, comenzi și carduri cadou.
  channels: {
    confirm: { enabled: true, push: false, sms: true, email: false },
    cancel: { enabled: true, push: false, sms: true, email: false },
    reminder_24h: { enabled: true, push: true, sms: true, email: false },
    reminder_2h: { enabled: true, push: true, sms: true, email: false },
    review: { enabled: true, push: true, sms: true, email: false },
    order_created: { enabled: true, push: true, sms: false, email: false },
    order_ready: { enabled: true, push: true, sms: true, email: false },
    order_cancelled: { enabled: true, push: true, sms: false, email: false },
    gift_card: { enabled: true, push: true, sms: true, email: false },
    sub_started: { enabled: true, push: true, sms: false, email: false },
  },
  otpSms: true,
};

export async function getAutomations(env: Env): Promise<Automations> {
  const s = await getSetting<Partial<Automations>>(env, 'automations', {});
  const d = DEFAULT_AUTOMATIONS;
  const merge = <T extends { title?: Texts; message?: Texts }>(def: T, v: Partial<T> | undefined): T => ({
    ...def,
    ...v,
    ...(def.title && { title: { ...def.title, ...v?.title } }),
    ...(def.message && { message: { ...def.message, ...v?.message } }),
  });
  return {
    winback: { ...merge(d.winback, s.winback), reward: { ...d.winback.reward, ...s.winback?.reward } },
    lastMinute: merge(d.lastMinute, s.lastMinute),
    giftCard: merge(d.giftCard, s.giftCard),
    links: { ...d.links, ...s.links },
    channels: Object.fromEntries(CHANNEL_EVENTS.map((k) => [k, { ...d.channels[k], ...s.channels?.[k] }])) as Automations['channels'],
    otpSms: typeof s.otpSms === 'boolean' ? s.otpSms : d.otpSms,
  };
}

/** Pe ce canale pleacă o notificare (null = oprită din Setări → Notificări). */
export async function channelsFor(env: Env, kind: ChannelEvent): Promise<Channel | null> {
  const ch = (await getAutomations(env)).channels[kind];
  return ch.enabled ? ch : null;
}

export async function saveAutomations(env: Env, b: Partial<Automations>) {
  const cur = await getAutomations(env);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const int = (v: unknown, d: number, min: number, max: number, code: string) => {
    if (v === undefined) return d;
    const n = Math.round(Number(v));
    if (!(n >= min && n <= max)) throw new HttpError(400, code);
    return n;
  };
  const texts = (v: Partial<Texts> | undefined, d: Texts, max: number): Texts => {
    const out = { ...d };
    for (const l of ['ro', 'en', 'fr'] as const) if (typeof v?.[l] === 'string') out[l] = v[l]!.trim().slice(0, max);
    if (!out.ro) throw new HttpError(400, 'ro_required');
    return out;
  };
  const url = (v: unknown, d: string) => {
    if (v === undefined) return d;
    const s = String(v).trim();
    if (s && !/^https:\/\/[^\s]+$/.test(s)) throw new HttpError(400, 'invalid_url');
    return s.slice(0, 300);
  };
  const w: Partial<WinbackSettings> = b.winback ?? {};
  const l: Partial<LastMinuteSettings> = b.lastMinute ?? {};
  const g: Partial<GiftCardSettings> = b.giftCard ?? {};
  const hours = l.hours === undefined ? cur.lastMinute.hours : [...new Set((Array.isArray(l.hours) ? l.hours : []).map(Number))].sort((x, y) => x - y);
  if (!hours.length || hours.length > 4 || hours.some((h) => !(Number.isInteger(h) && h >= 7 && h <= 20))) throw new HttpError(400, 'invalid_hour');
  const amounts =
    g.amounts === undefined ? cur.giftCard.amounts : [...new Set((Array.isArray(g.amounts) ? g.amounts : []).map(Number))].filter((n) => n > 0).sort((x, y) => x - y);
  if (!amounts.length || amounts.length > 6 || amounts.some((n) => !(Number.isInteger(n) && n >= 10 && n <= 5000))) throw new HttpError(400, 'invalid_amount');
  const next: Automations = {
    winback: {
      enabled: bool(w.enabled, cur.winback.enabled),
      weeks: int(w.weeks, cur.winback.weeks, 2, 52, 'invalid_weeks'),
      hour: int(w.hour, cur.winback.hour, 7, 21, 'invalid_hour'),
      push: bool(w.push, cur.winback.push),
      email: bool(w.email, cur.winback.email),
      sms: bool(w.sms, cur.winback.sms),
      title: texts(w.title, cur.winback.title, 80),
      message: texts(w.message, cur.winback.message, 300),
      bonus: bool(w.bonus, cur.winback.bonus),
      reward: w.reward ? parseReward(w.reward) : cur.winback.reward,
    },
    lastMinute: {
      enabled: bool(l.enabled, cur.lastMinute.enabled),
      hours,
      window: int(l.window, cur.lastMinute.window, 1, 10, 'invalid_window'),
      maxPerWeek: int(l.maxPerWeek, cur.lastMinute.maxPerWeek, 1, 7, 'invalid_max'),
      push: bool(l.push, cur.lastMinute.push),
      email: bool(l.email, cur.lastMinute.email),
      sms: bool(l.sms, cur.lastMinute.sms),
      title: texts(l.title, cur.lastMinute.title, 80),
      message: texts(l.message, cur.lastMinute.message, 300),
    },
    giftCard: {
      enabled: bool(g.enabled, cur.giftCard.enabled),
      amounts,
      validMonths: int(g.validMonths, cur.giftCard.validMonths, 1, 36, 'invalid_months'),
      title: texts(g.title, cur.giftCard.title, 80),
      message: texts(g.message, cur.giftCard.message, 300),
    },
    links: {
      appStoreUrl: url(b.links?.appStoreUrl, cur.links.appStoreUrl),
      playStoreUrl: url(b.links?.playStoreUrl, cur.links.playStoreUrl),
      googleReviewUrl: url(b.links?.googleReviewUrl, cur.links.googleReviewUrl),
    },
    channels: Object.fromEntries(
      CHANNEL_EVENTS.map((k) => {
        const v: Partial<Channel> = b.channels?.[k] ?? {};
        const d = cur.channels[k];
        return [k, { enabled: bool(v.enabled, d.enabled), push: bool(v.push, d.push), sms: bool(v.sms, d.sms), email: bool(v.email, d.email) }];
      }),
    ) as Automations['channels'],
    otpSms: bool(b.otpSms, cur.otpSms),
  };
  // Engleza și franceza se completează singure din română.
  for (const k of ['winback', 'lastMinute', 'giftCard'] as const) {
    next[k].title = await autoTranslate(env, cur[k].title, next[k].title);
    next[k].message = await autoTranslate(env, cur[k].message, next[k].message);
  }
  await setSetting(env, 'automations', next);
  return next;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const langOf = (l: string): Lang => (l === 'en' || l === 'fr' ? l : 'ro');
export function fillText(t: string, vars: Record<string, string>) {
  let s = t;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  // „{nume}, …” fără nume: scoatem virgula rămasă la început și spațiile duble.
  return s.replace(/^\s*,\s*/, '').replace(/\s+([!,.?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
async function pushTokens(env: Env, clientId: string) {
  const t = await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(clientId).all<{ token: string }>();
  return t.results.map((x) => x.token);
}

// --- „Ne e dor de tine” ---

/**
 * Clienții care nu au mai venit de N săptămâni și nu au nimic programat primesc o dată (pe fiecare absență) mesajul,
 * opțional cu un bonus. Push oricui are aplicația; e-mail și SMS doar cu acordul pentru oferte.
 */
export async function sendWinback(env: Env, now = new Date()) {
  const { winback: s } = await getAutomations(env);
  if (!s.enabled) return 0;
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  if (localMinutes(tz, now) < s.hour * 60) return 0;
  const nowIso = iso(now);
  const cutoff = iso(new Date(now.getTime() - s.weeks * 7 * 86_400_000));
  const oldest = iso(new Date(now.getTime() - 400 * 86_400_000)); // după peste un an nu mai insistăm
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.phone, c.email, c.lang, c.marketing_sms, c.marketing_email, v.last FROM clients c
     JOIN (SELECT client_id, max(starts_at) AS last FROM bookings WHERE status IN ('completed','confirmed') AND starts_at <= ? GROUP BY client_id) v ON v.client_id = c.id
     WHERE c.deleted_at IS NULL AND v.last < ? AND v.last > ? AND (c.winback_at IS NULL OR c.winback_at < v.last)
       AND NOT EXISTS (SELECT 1 FROM bookings f WHERE f.client_id = c.id AND f.status = 'confirmed' AND f.starts_at > ?)
     LIMIT 100`,
  )
    .bind(nowIso, cutoff, oldest, nowIso)
    .all<{ id: string; name: string; phone: string; email: string | null; lang: string; marketing_sms: number; marketing_email: number; last: string }>();
  if (!rows.results.length) return 0;
  const shop = (await getBusiness(env)).name;
  let n = 0;
  for (const c of rows.results) {
    const claimed = await env.DB.prepare('UPDATE clients SET winback_at = ? WHERE id = ? AND (winback_at IS NULL OR winback_at < ?)').bind(nowIso, c.id, c.last).run();
    if (!claimed.meta.changes) continue;
    n++;
    const lang = langOf(c.lang);
    const weeks = String(Math.floor((now.getTime() - Date.parse(c.last)) / (7 * 86_400_000)));
    const vars = { nume: firstName(c.name), salon: shop, saptamani: weeks };
    const title = fillText(s.title[lang] || s.title.ro, vars);
    let body = fillText(s.message[lang] || s.message.ro, vars);
    if (s.bonus) {
      await giveBonus(env, c.id, s.reward, 'manual');
      body += lang === 'ro' ? ` Cadou: ${s.reward.title}.` : lang === 'fr' ? ` Cadeau : ${s.reward.title}.` : ` Gift: ${s.reward.title}.`;
    }
    if (s.push) {
      const tokens = await pushTokens(env, c.id);
      if (tokens.length) await sendPush(env, { kind: 'winback' }, tokens, title, body, { screen: s.bonus ? 'rewards' : 'book' });
    }
    if (s.email && c.marketing_email && c.email) await sendEmail(env, { kind: 'winback', recipient: c.email }, title, emailHtml(shop, title, body));
    if (s.sms && c.marketing_sms) await sendSms(env, { kind: 'winback', recipient: c.phone }, `${title} ${body}`);
  }
  return n;
}

// --- Ore libere de ultim moment ---

/** Orele libere de azi din următoarele `window` ore, la toți frizerii (pentru serviciul cel mai des rezervat). */
export async function freeSlotsSoon(env: Env, now: Date, windowHours: number) {
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const day = localDay(tz, now);
  const svc = await env.DB.prepare(
    `SELECT s.id FROM services s LEFT JOIN bookings b ON b.service_id = s.id AND b.created_at > ?
     WHERE s.active = 1 GROUP BY s.id ORDER BY count(b.id) DESC, s.sort LIMIT 1`,
  )
    .bind(iso(new Date(now.getTime() - 90 * 86_400_000)))
    .first<{ id: string }>();
  if (!svc) return [];
  const until = now.getTime() + windowHours * 3_600_000;
  const slots = await availability(env, { serviceId: svc.id, barberId: null, day });
  const names = new Map(
    (await env.DB.prepare('SELECT id, name FROM barbers').all<{ id: string; name: string }>()).results.map((b) => [b.id, b.name]),
  );
  return slots
    .filter((s) => Date.parse(s.start) > now.getTime() + 30 * 60_000 && Date.parse(s.start) <= until)
    .map((s) => ({ ...s, barberName: names.get(s.barberId) ?? '' }));
}

/**
 * La orele alese, dacă azi mai sunt goluri în următoarele ore, clienții cu notificările pentru oferte pornite
 * primesc un push (cel mult de N ori pe săptămână, niciodată cei care au deja programare azi).
 */
export async function sendLastMinute(env: Env, now = new Date()) {
  const { lastMinute: s } = await getAutomations(env);
  if (!s.enabled) return 0;
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const min = localMinutes(tz, now);
  const hour = s.hours.find((h) => min >= h * 60 && min < h * 60 + 30);
  if (hour === undefined) return 0;
  const day = localDay(tz, now);
  const key = `${day}-${hour}`;
  const state = await getSetting<{ lastMinute?: string }>(env, 'automation_state', {});
  if (state.lastMinute === key) return 0;
  await setSetting(env, 'automation_state', { ...state, lastMinute: key });

  const free = await freeSlotsSoon(env, now, s.window);
  if (!free.length) return 0;
  const ore = free
    .slice(0, 4)
    .map((x) => `${roLocal(x.start).hm}${x.barberName ? ` (${x.barberName})` : ''}`)
    .join(', ');
  const nowIso = iso(now);
  const dayStart = iso(localToUtc(tz, day, 0));
  // Cel mult `maxPerWeek` mesaje pe săptămână: între două mesaje trec cel puțin 7 / maxPerWeek zile.
  const since = iso(new Date(Math.min(Date.parse(dayStart), now.getTime() - (7 / s.maxPerWeek) * 86_400_000 + 3_600_000)));
  const reach = [
    ...(s.push ? ['(c.marketing_push = 1 AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.client_id = c.id))'] : []),
    ...(s.email ? ["(c.marketing_email = 1 AND coalesce(c.email, '') != '')"] : []),
    ...(s.sms ? ['c.marketing_sms = 1'] : []),
  ];
  if (!reach.length) return 0;
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.phone, c.email, c.lang, c.marketing_sms, c.marketing_email, c.marketing_push FROM clients c
     WHERE c.deleted_at IS NULL
       AND (c.lastminute_at IS NULL OR c.lastminute_at < ?)
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.client_id = c.id AND b.status = 'confirmed' AND b.starts_at > ?)
       AND (${reach.join(' OR ')})
     LIMIT 300`,
  )
    .bind(since, dayStart)
    .all<{ id: string; name: string; phone: string; email: string | null; lang: string; marketing_sms: number; marketing_email: number; marketing_push: number }>();
  const shop = (await getBusiness(env)).name;
  let n = 0;
  for (const c of rows.results) {
    const claimed = await env.DB.prepare('UPDATE clients SET lastminute_at = ? WHERE id = ? AND (lastminute_at IS NULL OR lastminute_at < ?)').bind(nowIso, c.id, since).run();
    if (!claimed.meta.changes) continue;
    const lang = langOf(c.lang);
    const vars = { nume: firstName(c.name), salon: shop, ore };
    const title = fillText(s.title[lang] || s.title.ro, vars);
    const body = fillText(s.message[lang] || s.message.ro, vars);
    if (s.push && c.marketing_push) await sendPush(env, { kind: 'last_minute' }, await pushTokens(env, c.id), title, body, { screen: 'book' });
    if (s.email && c.marketing_email && c.email) await sendEmail(env, { kind: 'last_minute', recipient: c.email }, title, emailHtml(shop, title, body));
    if (s.sms && c.marketing_sms) await sendSms(env, { kind: 'last_minute', recipient: c.phone }, `${title}: ${body}`);
    n++;
  }
  return n;
}

// --- Carduri cadou ---

export type GiftCardRow = {
  id: string;
  code: string;
  amount_bani: number;
  balance_bani: number;
  buyer_client_id: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  message: string;
  status: string;
  paid_by: string | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  pay_method?: string | null;
  buyer_name?: string | null;
  paid_by_name?: string | null;
};
export const giftCard = (r: GiftCardRow, showCode: boolean) => {
  const expired = r.status === 'active' && !!r.expires_at && r.expires_at < iso(new Date());
  return {
    id: r.id,
    // Codul se vede doar când cardul e plătit (altfel ar putea fi folosit înainte de plată).
    code: showCode && r.status !== 'pending' ? r.code : null,
    amount: r.amount_bani / 100,
    balance: r.balance_bani / 100,
    recipientName: r.recipient_name,
    recipientPhone: r.recipient_phone,
    message: r.message,
    status: (expired ? 'expired' : r.status) as 'pending' | 'active' | 'used' | 'cancelled' | 'expired',
    paidAt: r.paid_at,
    payMethod: r.pay_method ?? null,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    ...(r.buyer_name !== undefined && { buyerName: r.buyer_name }),
    ...(r.paid_by_name !== undefined && { paidByName: r.paid_by_name }),
  };
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
  return `TAF-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Clientul cumpără din aplicație un card cadou: rămâne „de plătit” până îl încasează echipa (sau, mai târziu, plata cu cardul). */
export async function createGiftCard(env: Env, buyerId: string | null, b: { amount?: number; recipientName?: string; recipientPhone?: string | null; message?: string }) {
  const s = (await getAutomations(env)).giftCard;
  if (buyerId && !s.enabled) throw new HttpError(409, 'gift_cards_off');
  const amount = Math.round(Number(b.amount));
  if (!(amount >= 10 && amount <= 5000)) throw new HttpError(400, 'invalid_amount');
  if (buyerId) {
    const pending = await env.DB.prepare(`SELECT count(*) AS n FROM gift_cards WHERE buyer_client_id = ? AND status = 'pending'`).bind(buyerId).first<{ n: number }>();
    if ((pending?.n ?? 0) >= 5) throw new HttpError(429, 'too_many_gift_cards');
  }
  const id = 'gc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  for (let i = 0; i < 5; i++) {
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO gift_cards (id, code, amount_bani, balance_bani, buyer_client_id, recipient_name, recipient_phone, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, newCode(), amount * 100, amount * 100, buyerId, String(b.recipientName ?? '').trim().slice(0, 80), b.recipientPhone ?? null, String(b.message ?? '').trim().slice(0, 200))
      .run();
    if (r.meta.changes) return id;
  }
  throw new HttpError(500, 'server_error');
}

/** Echipa încasează cardul la salon: devine activ, iar destinatarul primește codul (SMS și push, dacă are aplicația). */
export async function activateGiftCard(env: Env, id: string, adminId: string | null, pay?: { method: string; ref: string }) {
  const s = (await getAutomations(env)).giftCard;
  const now = new Date();
  const expires = iso(new Date(Date.parse(addDays(now.toISOString().slice(0, 10), Math.round(s.validMonths * 30.5)) + 'T21:59:59Z')));
  const r = await env.DB.prepare(
    `UPDATE gift_cards SET status = 'active', paid_by = ?, paid_at = ?, expires_at = ?, pay_method = coalesce(?, pay_method), payment_ref = coalesce(?, payment_ref)
     WHERE id = ? AND status = 'pending'`,
  )
    .bind(adminId, iso(now), expires, pay?.method ?? null, pay?.ref ?? null, id)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'not_pending');
  const g = (await env.DB.prepare(
    `SELECT g.*, b.name AS buyer_name FROM gift_cards g LEFT JOIN clients b ON b.id = g.buyer_client_id WHERE g.id = ?`,
  )
    .bind(id)
    .first<GiftCardRow>())!;
  if (g.recipient_phone) {
    const shop = (await getBusiness(env)).name;
    const rc = await env.DB.prepare('SELECT id, name, lang FROM clients WHERE phone = ? AND deleted_at IS NULL').bind(g.recipient_phone).first<{ id: string; name: string; lang: string }>();
    const lang = langOf(rc?.lang ?? 'ro');
    const vars = {
      nume: firstName(g.recipient_name || rc?.name || ''),
      de_la: firstName(g.buyer_name ?? '') || (lang === 'ro' ? 'un prieten' : lang === 'fr' ? 'un ami' : 'a friend'),
      suma: String(g.amount_bani / 100),
      cod: g.code,
      mesaj: g.message,
      salon: shop,
    };
    const title = fillText(s.title[lang] || s.title.ro, vars);
    const body = fillText(s.message[lang] || s.message.ro, vars);
    const ch = await channelsFor(env, 'gift_card');
    if (rc && ch?.push) {
      const tokens = await pushTokens(env, rc.id);
      if (tokens.length) await sendPush(env, { kind: 'gift_card' }, tokens, title, body, { screen: 'rewards' });
    }
    if (rc && ch?.email) {
      const em = await env.DB.prepare('SELECT email FROM clients WHERE id = ?').bind(rc.id).first<{ email: string | null }>();
      if (em?.email) await sendEmail(env, { kind: 'gift_card', recipient: em.email }, title, emailHtml(shop, title, body));
    }
    // Cardul cadou e o tranzacție, nu o reclamă: SMS-ul pleacă și fără acord pentru oferte.
    if (ch?.sms) await sendSms(env, { kind: 'gift_card', recipient: g.recipient_phone }, `${title}. ${body}`);
  }
  return g;
}

/** Folosește (o parte din) card la plata unei tunsori. Întoarce suma scăzută, în bani. */
export async function redeemGiftCard(env: Env, code: string, wantBani: number) {
  const c = String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const norm = c.startsWith('TAF-') ? c : c.length === 8 ? `TAF-${c.slice(0, 4)}-${c.slice(4)}` : c;
  const g = await env.DB.prepare('SELECT * FROM gift_cards WHERE code = ?').bind(norm).first<GiftCardRow>();
  if (!g || g.status !== 'active') throw new HttpError(404, 'gift_card_not_found');
  if (g.expires_at && g.expires_at < iso(new Date())) throw new HttpError(409, 'gift_card_expired');
  const take = Math.min(g.balance_bani, Math.max(0, Math.round(wantBani)));
  if (!take) throw new HttpError(409, 'gift_card_empty');
  const r = await env.DB.prepare(
    `UPDATE gift_cards SET balance_bani = balance_bani - ?, status = CASE WHEN balance_bani - ? <= 0 THEN 'used' ELSE status END
     WHERE id = ? AND status = 'active' AND balance_bani >= ?`,
  )
    .bind(take, take, g.id, take)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'gift_card_empty');
  return { id: g.id, take };
}

export async function refundGiftCard(env: Env, id: string, bani: number) {
  await env.DB.prepare(`UPDATE gift_cards SET balance_bani = min(amount_bani, balance_bani + ?), status = CASE WHEN status = 'used' THEN 'active' ELSE status END WHERE id = ?`)
    .bind(bani, id)
    .run();
}
