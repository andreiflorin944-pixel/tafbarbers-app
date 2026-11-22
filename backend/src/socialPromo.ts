import { getBusiness, getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';
import { bonus, giveBonus } from './referrals';
import { iso } from './time';

// „Urmărește-ne pe Facebook, Instagram, TikTok și deblochezi X% reducere la o ședință.”
// Nimeni (nici Apple, nici rețelele) nu ne lasă să verificăm dacă cineva chiar a dat „follow”, iar Apple respinge aplicațiile
// care dau recompense condiționate de acțiuni (regula 3.2.2). De aceea reducerea e un bonus dat o singură dată pe cont,
// la apăsarea butonului; panoul poate cere, opțional, ca butonul să apară abia după ce clientul a deschis linkurile.

export type SocialPromoSettings = {
  enabled: boolean;
  percent: number;
  /** Câte zile e valabilă reducerea după deblocare (null = fără termen). */
  validDays: number | null;
  /** Butonul de deblocare apare doar după ce clientul a deschis toate rețelele (risc la Apple, vezi mai sus). */
  requireTaps: boolean;
};

export const DEFAULT_SOCIAL_PROMO: SocialPromoSettings = { enabled: false, percent: 50, validDays: 60, requireTaps: false };

export const getSocialPromoSettings = async (env: Env): Promise<SocialPromoSettings> => ({
  ...DEFAULT_SOCIAL_PROMO,
  ...(await getSetting(env, 'social_promo', DEFAULT_SOCIAL_PROMO)),
});

export async function saveSocialPromoSettings(env: Env, b: Partial<SocialPromoSettings>) {
  const cur = await getSocialPromoSettings(env);
  const percent = b.percent === undefined ? cur.percent : Math.round(Number(b.percent));
  if (!(percent >= 1 && percent <= 100)) throw new HttpError(400, 'invalid_value');
  let validDays = cur.validDays;
  if (b.validDays !== undefined) {
    validDays = b.validDays === null || (b.validDays as unknown) === '' ? null : Math.round(Number(b.validDays));
    if (validDays !== null && !(validDays >= 1 && validDays <= 3650)) throw new HttpError(400, 'invalid_value');
  }
  const next: SocialPromoSettings = {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
    percent,
    validDays,
    requireTaps: typeof b.requireTaps === 'boolean' ? b.requireTaps : cur.requireTaps,
  };
  await setSetting(env, 'social_promo', next);
  return next;
}

/** Linkurile complete spre rețele, din Setări (acolo pot fi scrise ca „@tafbarbers” sau ca link). */
export function socialLinks(biz: { instagram?: string; facebook?: string; tiktok?: string }) {
  const url = (v: string | undefined, base: string, at: boolean) => {
    const s = (v ?? '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(www\.)?(instagram|facebook|tiktok)\.com\//i.test(s)) return `https://${s}`;
    return `${base}${at ? '@' : ''}${s.replace(/^@/, '')}`;
  };
  return {
    facebook: url(biz.facebook, 'https://www.facebook.com/', false),
    instagram: url(biz.instagram, 'https://www.instagram.com/', false),
    tiktok: url(biz.tiktok, 'https://www.tiktok.com/', true),
  };
}

/** Ce primește aplicația cu datele salonului: null când promo-ul e oprit sau nu e pusă nicio rețea. */
export async function publicSocialPromo(env: Env, biz?: Awaited<ReturnType<typeof getBusiness>>) {
  const s = await getSocialPromoSettings(env);
  if (!s.enabled) return null;
  const links = socialLinks(biz ?? (await getBusiness(env)));
  if (!links.facebook && !links.instagram && !links.tiktok) return null;
  return { percent: s.percent, validDays: s.validDays, requireTaps: s.requireTaps, links };
}

export const promoTitle = (percent: number) => `${percent}% reducere la o ședință (urmărești TAF pe rețele)`;

/** Deblocarea: o singură dată pe cont, chiar dacă apasă de două ori sau din două telefoane deodată. */
export async function claimSocialPromo(env: Env, clientId: string) {
  const s = await getSocialPromoSettings(env);
  if (!s.enabled) {
    const b = await promoBonus(env, clientId);
    if (b) return { claimed: true, already: true, bonus: b };
    throw new HttpError(404, 'promo_off');
  }
  const taken = await env.DB.prepare('UPDATE clients SET social_promo_at = ? WHERE id = ? AND social_promo_at IS NULL').bind(iso(new Date()), clientId).run();
  if (!taken.meta.changes) return { claimed: true, already: true, bonus: await promoBonus(env, clientId) };
  const id = await giveBonus(env, clientId, { title: promoTitle(s.percent), kind: 'percent', value: s.percent, validDays: s.validDays }, 'manual');
  await env.DB.prepare('UPDATE clients SET social_promo_bonus = ? WHERE id = ?').bind(id, clientId).run();
  return { claimed: true, already: false, bonus: await promoBonus(env, clientId) };
}

async function promoBonus(env: Env, clientId: string) {
  const r = await env.DB.prepare('SELECT b.* FROM clients c JOIN bonuses b ON b.id = c.social_promo_bonus WHERE c.id = ?')
    .bind(clientId)
    .first<Parameters<typeof bonus>[0]>();
  return r ? bonus(r) : null;
}

/** Pentru panou: câți au deblocat reducerea și câți au folosit-o deja. */
export async function socialPromoStats(env: Env) {
  const r = await env.DB.prepare(
    `SELECT count(*) AS claimed, sum(CASE WHEN b.status = 'used' THEN 1 ELSE 0 END) AS used
     FROM clients c LEFT JOIN bonuses b ON b.id = c.social_promo_bonus WHERE c.social_promo_at IS NOT NULL AND c.deleted_at IS NULL`,
  ).first<{ claimed: number; used: number | null }>();
  return { claimed: r?.claimed ?? 0, used: r?.used ?? 0 };
}
