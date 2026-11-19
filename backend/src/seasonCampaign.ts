// Campania de sezon (Crăciun, Paște, Valentine’s, Ziua Tatălui sau una scrisă de mână), setată din panou → Marketing → Campanie de sezon.
// Între cele două zile apare ca primul banner pe Acasă (aplicație și site) și, dacă e bifat, ca pop-up la intrarea în aplicație
// (o singură dată pe campanie). Butonul deschide cardul cadou, programarea, abonamentul personalizat sau magazinul.
// Pornește și se oprește singură; nimic nu se trimite clienților (anunțurile push/e-mail rămân la Campanii, trimise de mână).
import { getCustomSubSettings } from './customSubs';
import { getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';
import { getAutomations } from './growth';
import { localDay } from './time';
import { autoTranslate } from './translate';

type Lang = 'ro' | 'en' | 'fr';
type Texts = Record<Lang, string>;
export const SEASON_THEMES = ['christmas', 'easter', 'valentine', 'fathers', 'custom'] as const;
export type SeasonTheme = (typeof SEASON_THEMES)[number];
export const SEASON_TARGETS = ['gift_card', 'book', 'custom_sub', 'shop'] as const;
export type SeasonTarget = (typeof SEASON_TARGETS)[number];
const TEXT_KEYS = ['kicker', 'title', 'text', 'cta', 'wish'] as const;
type TextKey = (typeof TEXT_KEYS)[number];

export type SeasonCampaign = {
  enabled: boolean;
  theme: SeasonTheme;
  startsAt: string; // YYYY-MM-DD, ora salonului; gol = de acum
  endsAt: string; // YYYY-MM-DD inclusiv; gol = fără sfârșit
  target: SeasonTarget;
  popup: boolean; // pop-up la intrarea în aplicație, o dată pe campanie
  kicker: Texts;
  title: Texts;
  text: Texts;
  cta: Texts;
  wish: Texts; // urarea pusă din oficiu în cardul cadou (doar când butonul duce la cardul cadou)
  imageUrl: string | null;
  version: number; // crește la fiecare salvare cu alt conținut: pop-up-ul apare din nou pentru campania nouă
};

const t3 = (ro: string, en: string, fr: string): Texts => ({ ro, en, fr });
export const DEFAULT_SEASON: SeasonCampaign = {
  enabled: false,
  theme: 'christmas',
  startsAt: '',
  endsAt: '',
  target: 'gift_card',
  popup: true,
  kicker: t3('CADOU DE CRĂCIUN', 'CHRISTMAS GIFT', 'CADEAU DE NOËL'),
  title: t3('Fă cadou o tunsoare de Crăciun', 'Give a haircut for Christmas', 'Offrez une coupe pour Noël'),
  text: t3(
    'Card cadou TAF Barbers, cu urarea ta. Ajunge pe loc prin SMS și în aplicație.',
    'A TAF Barbers gift card with your wishes. Delivered instantly by SMS and in the app.',
    'Une carte cadeau TAF Barbers avec vos vœux. Envoyée tout de suite par SMS et dans l’application.',
  ),
  cta: t3('Alege cardul cadou', 'Choose a gift card', 'Choisir une carte cadeau'),
  wish: t3('Crăciun fericit! 🎄', 'Merry Christmas! 🎄', 'Joyeux Noël ! 🎄'),
  imageUrl: '/campanii/craciun.jpg',
  version: 1,
};

export async function getSeasonCampaign(env: Env): Promise<SeasonCampaign> {
  const s = await getSetting<Partial<SeasonCampaign>>(env, 'season_campaign', {});
  const d = DEFAULT_SEASON;
  const out = { ...d, ...s } as SeasonCampaign;
  for (const k of TEXT_KEYS) out[k] = { ...d[k], ...s[k] };
  return out;
}

export async function saveSeasonCampaign(env: Env, v: Partial<SeasonCampaign>): Promise<SeasonCampaign> {
  const cur = await getSeasonCampaign(env);
  const day = (x: unknown, d: string) => {
    if (x === undefined) return d;
    const s = String(x ?? '').trim();
    if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'invalid_date');
    return s;
  };
  const pick = <T extends string>(x: unknown, all: readonly T[], d: T, code: string): T => {
    if (x === undefined) return d;
    if (!all.includes(x as T)) throw new HttpError(400, code);
    return x as T;
  };
  const startsAt = day(v.startsAt, cur.startsAt);
  const endsAt = day(v.endsAt, cur.endsAt);
  if (startsAt && endsAt && endsAt < startsAt) throw new HttpError(400, 'invalid_dates');
  const img = v.imageUrl === undefined ? cur.imageUrl : v.imageUrl ? String(v.imageUrl).trim().slice(0, 500) : null;
  if (img && !/^(\/|https:\/\/)\S+$/.test(img)) throw new HttpError(400, 'invalid_url');
  const max: Record<TextKey, number> = { kicker: 40, title: 80, text: 200, cta: 40, wish: 200 };
  const next: SeasonCampaign = {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : cur.enabled,
    theme: pick(v.theme, SEASON_THEMES, cur.theme, 'invalid_theme'),
    startsAt,
    endsAt,
    target: pick(v.target, SEASON_TARGETS, cur.target, 'invalid_target'),
    popup: typeof v.popup === 'boolean' ? v.popup : cur.popup,
    imageUrl: img,
    version: cur.version,
  } as SeasonCampaign;
  // Textele: scrise în română, engleza și franceza se completează singure (ca la bannere).
  for (const k of TEXT_KEYS) {
    const out = { ...cur[k] };
    for (const l of ['ro', 'en', 'fr'] as const) if (typeof v[k]?.[l] === 'string') out[l] = v[k]![l]!.trim().slice(0, max[k]);
    if ((k === 'title' || k === 'cta') && !out.ro) throw new HttpError(400, 'ro_required');
    next[k] = await autoTranslate(env, cur[k], out);
  }
  // Altă temă, alt titlu sau altă perioadă = campanie nouă: clienții care au închis pop-up-ul îl văd din nou.
  if (next.theme !== cur.theme || next.title.ro !== cur.title.ro || next.startsAt !== cur.startsAt || (next.enabled && !cur.enabled)) next.version = cur.version + 1;
  await setSetting(env, 'season_campaign', next);
  return next;
}

/** E în desfășurare azi, iar ce deschide butonul e pornit (cardul cadou se vinde, abonamentul personalizat e pornit). */
export async function activeSeason(env: Env, now = new Date()): Promise<SeasonCampaign | null> {
  const s = await getSeasonCampaign(env);
  if (!s.enabled) return null;
  const today = localDay(env.TIMEZONE, now);
  if ((s.startsAt && today < s.startsAt) || (s.endsAt && today > s.endsAt)) return null;
  if (s.target === 'gift_card' && !(await getAutomations(env)).giftCard.enabled) return null;
  if (s.target === 'custom_sub' && !(await getCustomSubSettings(env)).enabled) return null;
  return s;
}

const langOf = (l: string | null | undefined): Lang => (l === 'en' || l === 'fr' ? l : 'ro');

/** Textele în limba clientului (goale = româna). */
export function seasonTexts(s: SeasonCampaign, lang: string | null | undefined) {
  const l = langOf(lang);
  const p = (t: Texts) => t[l] || t.ro;
  return { kicker: p(s.kicker), title: p(s.title), text: p(s.text), cta: p(s.cta), wish: p(s.wish), imageUrl: s.imageUrl };
}

/** Bannerul de pe Acasă (aplicație și site), ca unul din panou; `popup` = se arată și ca pop-up la intrare. */
export function seasonPromo(s: SeasonCampaign, lang: string | null | undefined) {
  const t = seasonTexts(s, lang);
  const action =
    s.target === 'book'
      ? { type: 'book' as const }
      : s.target === 'custom_sub'
        ? { type: 'custom_sub' as const }
        : s.target === 'shop'
          ? { type: 'shop' as const, productId: null }
          : { type: 'gift_card' as const };
  const icon = s.target === 'book' ? 'cut' : s.target === 'custom_sub' ? 'diamond' : s.target === 'shop' ? 'bag-handle' : 'gift';
  return { id: `season-${s.version}`, kicker: t.kicker, title: t.title, text: t.text, cta: t.cta, icon, imageUrl: t.imageUrl, color: null, action, popup: s.popup, theme: s.theme };
}
