import { getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';

// Aspectul aplicației, modificat din panou (Aspect).
export type Appearance = {
  accent: string; // culoarea principală, #RRGGBB
  background: string; // fundalul aplicației, #RRGGBB (negru sau gri închis)
  logoUrl: string | null; // /v1/media/... sau https://...
  title: string; // numele de pe prima pagină, când nu e logo
  welcome: { ro: string; en: string; fr: string }; // gol = textul standard
  buttonText: string | null; // textul de pe butoane; null = automat (negru/alb după culoarea butonului)
  text: string; // textul principal
  muted: string; // textul secundar (descrieri, durate)
  card: string | null; // cardurile; null = automat, puțin mai deschise decât fundalul
  backgroundImage: string | null; // poză de fundal pentru toată aplicația
  backgroundDim: number; // cât de întunecată e poza de fundal, 0–90 (%)
};

export const DEFAULT_APPEARANCE: Appearance = {
  accent: '#F9A11B',
  background: '#000000',
  logoUrl: null,
  title: 'TAF Barber’s',
  welcome: { ro: '', en: '', fr: '' },
  buttonText: null,
  text: '#FFFFFF',
  muted: '#A3A09A',
  card: null,
  backgroundImage: null,
  backgroundDim: 60,
};

export const getAppearance = async (env: Env): Promise<Appearance> => ({ ...DEFAULT_APPEARANCE, ...(await getSetting(env, 'appearance', DEFAULT_APPEARANCE)) });

export const isImageUrl = (u: unknown): u is string =>
  typeof u === 'string' && u.length <= 500 && (/^\/v1\/media\/[\w-]+$/.test(u) || /^https:\/\/\S+$/.test(u));

export async function saveAppearance(env: Env, b: Partial<Appearance>): Promise<Appearance> {
  const next = { ...(await getAppearance(env)) };
  const color = (v: unknown) => {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new HttpError(400, 'invalid_color');
    return v.toUpperCase();
  };
  for (const k of ['accent', 'background', 'text', 'muted'] as const) if (b[k] !== undefined) next[k] = color(b[k]);
  for (const k of ['buttonText', 'card'] as const) if (b[k] !== undefined) next[k] = b[k] === null ? null : color(b[k]);
  if (b.backgroundImage !== undefined) {
    if (b.backgroundImage !== null && !isImageUrl(b.backgroundImage)) throw new HttpError(400, 'invalid_url');
    next.backgroundImage = b.backgroundImage;
  }
  if (b.backgroundDim !== undefined) next.backgroundDim = Math.max(0, Math.min(90, Math.round(Number(b.backgroundDim) || 0)));
  if (b.logoUrl !== undefined) {
    if (b.logoUrl !== null && !isImageUrl(b.logoUrl)) throw new HttpError(400, 'invalid_url');
    next.logoUrl = b.logoUrl;
  }
  if (typeof b.title === 'string') next.title = b.title.trim().slice(0, 40) || DEFAULT_APPEARANCE.title;
  if (b.welcome && typeof b.welcome === 'object') {
    next.welcome = { ...next.welcome };
    for (const l of ['ro', 'en', 'fr'] as const) {
      if (typeof b.welcome[l] === 'string') next.welcome[l] = b.welcome[l].trim().slice(0, 60);
    }
  }
  await setSetting(env, 'appearance', next);
  return next;
}

export const MEDIA_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MEDIA_MAX = 1_500_000;
