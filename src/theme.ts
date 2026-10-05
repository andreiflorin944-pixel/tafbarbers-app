import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Culorile aplicației actuale TAF Barber's: portocaliu și negru.
export const colors = {
  bg: '#000000',
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

// Culoarea principală se alege din panou (Aspect aplicație). Stilurile se calculează o singură
// dată, la pornire, așa că o citim aici, sincron, din ce a salvat aplicația data trecută.
// O culoare nouă se vede de la următoarea deschidere a aplicației.
export const ACCENT_KEY = 'taf.accent';
export const BG_KEY = 'taf.bg';

function readSaved(key: string): string | null {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) : SecureStore.getItem(key);
    return v && /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null;
  } catch {
    return null;
  }
}
export const readSavedAccent = () => readSaved(ACCENT_KEY);
export const readSavedBackground = () => readSaved(BG_KEY);

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
/** Amestecă fundalul cu alb: carduri și margini puțin mai deschise decât fundalul. */
const lighten = (hex: string, k: number) => toHex(rgb(hex).map((x) => x + (255 - x) * k));

function applyBackground(hex: string) {
  colors.bg = hex;
  colors.card = lighten(hex, 0.06);
  colors.cardAlt = lighten(hex, 0.1);
  colors.border = lighten(hex, 0.15);
}

function applyAccent(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const dark = (x: number) => Math.round(x * 0.74).toString(16).padStart(2, '0');
  colors.gold = hex;
  colors.goldDark = `#${dark(r)}${dark(g)}${dark(b)}`;
  colors.onGold = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#FFFFFF';
}

const saved = readSavedAccent();
if (saved) applyAccent(saved);
const savedBg = readSavedBackground();
if (savedBg && savedBg !== '#000000') applyBackground(savedBg);
