import { getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';

// Aspectul aplicației, modificat din panou (Aspect).
export type Appearance = {
  accent: string; // culoarea principală, #RRGGBB
  logoUrl: string | null; // /v1/media/... sau https://...
  title: string; // numele de pe prima pagină, când nu e logo
  welcome: { ro: string; en: string; fr: string }; // gol = textul standard
};

export const DEFAULT_APPEARANCE: Appearance = {
  accent: '#F9A11B',
  logoUrl: null,
  title: 'TAF Barber’s',
  welcome: { ro: '', en: '', fr: '' },
};

export const getAppearance = (env: Env) => getSetting(env, 'appearance', DEFAULT_APPEARANCE);

export const isImageUrl = (u: unknown): u is string =>
  typeof u === 'string' && u.length <= 500 && (/^\/v1\/media\/[\w-]+$/.test(u) || /^https:\/\/\S+$/.test(u));

export async function saveAppearance(env: Env, b: Partial<Appearance>): Promise<Appearance> {
  const next = { ...(await getAppearance(env)) };
  if (b.accent !== undefined) {
    if (typeof b.accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(b.accent)) throw new HttpError(400, 'invalid_color');
    next.accent = b.accent.toUpperCase();
  }
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
