import { autoTranslate } from './translate';
import { localizeText } from './contentI18n';
import { emailHtml } from './campaigns';
import { getBusiness, getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';
import { sendEmail, sendPush, sendSms } from './notify';
import { giveBonus, parseReward, type Reward } from './referrals';
import { isLeap as leap, localDay, localMinutes, QUIET_FROM } from './time';

// Ziua de naștere a clientului: programările din ziua lui se văd la frizer (lumânare),
// iar dimineața pleacă automat „La mulți ani”, opțional cu un bonus.

type Lang = 'ro' | 'en' | 'fr';
type Texts = Record<Lang, string>;
export type BirthdaySettings = {
  enabled: boolean;
  hour: number; // ora (locală) de la care se trimite urarea
  push: boolean;
  email: boolean;
  sms: boolean;
  title: Texts;
  message: Texts; // {nume} = prenumele clientului, {salon} = numele salonului
  bonus: boolean;
  reward: Reward;
};

export const DEFAULT_BIRTHDAY: BirthdaySettings = {
  enabled: true,
  hour: 10,
  push: true,
  email: true,
  sms: false,
  title: { ro: 'La mulți ani, {nume}!', en: 'Happy birthday, {nume}!', fr: 'Joyeux anniversaire, {nume} !' },
  message: {
    ro: 'Echipa {salon} îți urează la mulți ani! Te așteptăm pe scaun să sărbătorim cu o tunsoare pe cinste.',
    en: 'The {salon} team wishes you a happy birthday! Come by and celebrate with a fresh cut.',
    fr: 'Toute l’équipe {salon} vous souhaite un joyeux anniversaire ! Passez fêter ça avec une belle coupe.',
  },
  bonus: false,
  reward: { title: '20% reducere de ziua ta', kind: 'percent', value: 20, validDays: 14 },
};

export async function getBirthdaySettings(env: Env): Promise<BirthdaySettings> {
  const s = await getSetting(env, 'birthday', DEFAULT_BIRTHDAY);
  return { ...s, title: { ...DEFAULT_BIRTHDAY.title, ...s.title }, message: { ...DEFAULT_BIRTHDAY.message, ...s.message }, reward: { ...DEFAULT_BIRTHDAY.reward, ...s.reward } };
}

export async function saveBirthdaySettings(env: Env, b: Partial<BirthdaySettings>) {
  const cur = await getBirthdaySettings(env);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const texts = (v: Partial<Texts> | undefined, d: Texts, max: number): Texts => {
    const out = { ...d };
    for (const l of ['ro', 'en', 'fr'] as const) if (typeof v?.[l] === 'string') out[l] = v[l]!.trim().slice(0, max);
    if (!out.ro) throw new HttpError(400, 'ro_required');
    return out;
  };
  const hour = b.hour === undefined ? cur.hour : Math.round(Number(b.hour));
  if (!(hour >= 6 && hour <= 21)) throw new HttpError(400, 'invalid_hour');
  const next: BirthdaySettings = {
    enabled: bool(b.enabled, cur.enabled),
    hour,
    push: bool(b.push, cur.push),
    email: bool(b.email, cur.email),
    sms: bool(b.sms, cur.sms),
    title: texts(b.title, cur.title, 80),
    message: texts(b.message, cur.message, 300),
    bonus: bool(b.bonus, cur.bonus),
    reward: b.reward ? parseReward(b.reward) : cur.reward,
  };
  next.title = await autoTranslate(env, cur.title, next.title);
  next.message = await autoTranslate(env, cur.message, next.message);
  await setSetting(env, 'birthday', next);
  return next;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** Rulează din cron: după ora aleasă, fiecare client cu ziua azi primește urarea (o dată pe an). */
export async function greetBirthdays(env: Env, now = new Date()) {
  const s = await getBirthdaySettings(env);
  if (!s.enabled) return 0;
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  // Doar de la ora aleasă până la 22:00: noaptea nu trimitem (cine n-a primit azi nu primește noaptea târziu).
  const min = localMinutes(tz, now);
  if (min < s.hour * 60 || min >= QUIET_FROM) return 0;
  const day = localDay(tz, now);
  const year = Number(day.slice(0, 4));
  const md = day.slice(5, 10);
  const mds = md === '02-28' && !leap(year) ? [md, '02-29'] : [md];
  const rows = await env.DB.prepare(
    `SELECT id, name, phone, email, lang, marketing_sms, marketing_email FROM clients
     WHERE deleted_at IS NULL AND birth_date IS NOT NULL AND substr(birth_date, 6, 5) IN (${mds.map(() => '?').join(',')})
       AND (birthday_greeted IS NULL OR birthday_greeted < ?) LIMIT 200`,
  )
    .bind(...mds, year)
    .all<{ id: string; name: string; phone: string; email: string | null; lang: string; marketing_sms: number; marketing_email: number }>();
  if (!rows.results.length) return 0;
  const shop = (await getBusiness(env)).name;
  let n = 0;
  for (const c of rows.results) {
    // Marcăm întâi, ca două rulări suprapuse să nu trimită de două ori.
    const claimed = await env.DB.prepare('UPDATE clients SET birthday_greeted = ? WHERE id = ? AND (birthday_greeted IS NULL OR birthday_greeted < ?)')
      .bind(year, c.id, year)
      .run();
    if (!claimed.meta.changes) continue;
    n++;
    const lang: Lang = c.lang === 'en' || c.lang === 'fr' ? c.lang : 'ro';
    const fill = (t: string) => t.replaceAll('{nume}', firstName(c.name)).replaceAll('{salon}', shop).replace(/\s+([!,])/g, '$1').trim();
    const title = fill(s.title[lang] || s.title.ro);
    let body = fill(s.message[lang] || s.message.ro);
    if (s.bonus) {
      await giveBonus(env, c.id, s.reward, 'manual');
      const gift = await localizeText(env, lang, s.reward.title);
      body += lang === 'ro' ? ` Cadou de la noi: ${gift}.` : lang === 'fr' ? ` Notre cadeau : ${gift}.` : ` Our gift: ${gift}.`;
    }
    // Push: oricui are aplicația cu notificările pornite. E-mail și SMS: doar cu acordul pentru oferte.
    if (s.push) {
      const t = await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(c.id).all<{ token: string }>();
      if (t.results.length) await sendPush(env, { kind: 'birthday' }, t.results.map((x) => x.token), title, body, { screen: s.bonus ? 'rewards' : 'home' });
    }
    if (s.email && c.marketing_email && c.email) await sendEmail(env, { kind: 'birthday', recipient: c.email }, title, emailHtml(shop, title, body, false, lang));
    if (s.sms && c.marketing_sms) await sendSms(env, { kind: 'birthday', recipient: c.phone }, `${title} ${body}`);
  }
  return n;
}

