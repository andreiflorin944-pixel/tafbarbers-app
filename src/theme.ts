import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Culorile aplicației actuale TAF Barber's: portocaliu și negru.
export const colors = {
  bg: '#000000',
  bgSolid: '#000000', // = bg; păstrat pentru ferestrele deasupra ecranului
  card: '#0F0F10',
  cardAlt: '#1A1A1C',
  border: '#262628',
  gold: '#F9A11B', // accentul portocaliu
  goldDark: '#B87410',
  onGold: '#000000',
  text: '#FFFFFF',
  muted: '#A3A09A',
  danger: '#E5625E',
  success: '#5C8A63',
};

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

// Aspectul se alege din panou (Aspect aplicație). Stilurile se calculează o singură dată, la pornire,
// așa că îl citim aici, sincron, din ce a salvat aplicația data trecută. Schimbările se văd de la
// următoarea deschidere a aplicației.
export const LOOK_KEY = 'taf.look';
// Cheile vechi (doar culoarea și fundalul), citite încă o dată după actualizare.
const ACCENT_KEY = 'taf.accent';
const BG_KEY = 'taf.bg';

/** Ce ține minte aplicația din aspectul ales în panou. */
export type SavedLook = {
  accent?: string;
  background?: string;
  buttonText?: string | null;
  text?: string;
  muted?: string;
  card?: string | null;
  backgroundImage?: string | null;
  backgroundDim?: number;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;
const hexOr = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : undefined);

function readRaw(key: string): string | null {
  try {
    return (Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) : SecureStore.getItem(key)) ?? null;
  } catch {
    return null;
  }
}

export function readSavedLook(): SavedLook {
  try {
    const raw = readRaw(LOOK_KEY);
    if (raw) return JSON.parse(raw) as SavedLook;
  } catch {
    // salvare stricată: pornim cu aspectul standard
  }
  return { accent: hexOr(readRaw(ACCENT_KEY)), background: hexOr(readRaw(BG_KEY)) };
}

/** Forma păstrată, ca să putem compara ce vine de la server cu ce rulează acum. */
export function normalizeLook(l: SavedLook | null | undefined): SavedLook {
  return {
    accent: hexOr(l?.accent),
    background: hexOr(l?.background),
    buttonText: hexOr(l?.buttonText) ?? null,
    text: hexOr(l?.text),
    muted: hexOr(l?.muted),
    card: hexOr(l?.card) ?? null,
    backgroundImage: typeof l?.backgroundImage === 'string' ? l.backgroundImage : null,
    backgroundDim: typeof l?.backgroundDim === 'number' ? l.backgroundDim : 60,
  };
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
/** Amestecă o culoare cu alb: carduri și margini puțin mai deschise decât fundalul. */
const lighten = (hex: string, k: number) => toHex(rgb(hex).map((x) => x + (255 - x) * k));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** Poza de fundal aleasă în panou; o desenează `Backdrop` în spatele ecranelor clientului. */
export const backdrop: { image: string | null; dim: number } = { image: null, dim: 60 };

function applyLook(raw: SavedLook) {
  const l = normalizeLook(raw);
  if (l.background) {
    colors.bgSolid = l.background;
    colors.bg = l.background;
    colors.card = lighten(l.background, 0.06);
    colors.cardAlt = lighten(l.background, 0.1);
    colors.border = lighten(l.background, 0.15);
  }
  if (l.card) {
    colors.card = l.card;
    colors.cardAlt = lighten(l.card, 0.05);
    colors.border = lighten(l.card, 0.1);
  }
  if (l.accent) {
    const [r, g, b] = rgb(l.accent);
    colors.gold = l.accent;
    colors.goldDark = toHex([r * 0.74, g * 0.74, b * 0.74]);
    colors.onGold = luminance(l.accent) > 150 ? '#000000' : '#FFFFFF';
  }
  if (l.buttonText) colors.onGold = l.buttonText;
  if (l.text) colors.text = l.text;
  if (l.muted) colors.muted = l.muted;
  if (l.backgroundImage) {
    backdrop.image = l.backgroundImage;
    backdrop.dim = l.backgroundDim ?? 60;
  }
}

applyLook(readSavedLook());
