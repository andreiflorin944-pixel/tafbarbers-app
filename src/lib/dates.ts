import { tr } from '@/i18n';

// Numele zilelor și lunilor, în limba aleasă în aplicație (din src/i18n.tsx).
const DAYS = () => tr('date.daysShort').split(',');
const DAYS_LONG = () => tr('date.daysLong').split(',');
const MONTHS = () => tr('date.months').split(',');

export const pad = (n: number) => String(n).padStart(2, '0');

// Orele și zilele se arată mereu ca la salon (ora României), oricare ar fi fusul orar al telefonului:
// un client plecat în altă țară vede tot ora la care trebuie să fie la salon.
export const SALON_TZ = 'Europe/Bucharest';
const DAY_MS = 86_400_000;

let fmt: Intl.DateTimeFormat | null | undefined;
/** Data și ora din ceasul salonului pentru un moment dat (fără Intl: ora telefonului). */
function wall(d: Date) {
  if (fmt === undefined) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: SALON_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    } catch {
      fmt = null;
    }
  }
  if (!fmt) return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(d)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
}

/**
 * Ziua din calendar a momentului dat, ca dată fixă (ora 12:00 UTC a zilei salonului), ca să rămână aceeași zi
 * în orice fus orar. Zilele din benzile de alegere se construiesc așa și se citesc cu funcțiile de mai jos.
 */
export function startOfDay(d: Date) {
  const w = wall(d);
  return new Date(Date.UTC(w.y, w.mo - 1, w.d, 12));
}

export function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY_MS);
}

export function dayKey(d: Date) {
  const w = wall(d);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
}

export function fromDayKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Momentul în care începe ziua la salon (miezul nopții, ora României), pentru intervale și poziții în calendar. */
export function salonMidnight(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d);
  // Diferența față de UTC se citește de două ori, ca să prindă și zilele cu schimbarea orei.
  for (let i = 0; i < 2; i++) {
    const w = wall(new Date(t));
    t = Date.UTC(y, m - 1, d) - (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - t);
  }
  return new Date(t);
}

const wd = (d: Date) => {
  const w = wall(d);
  return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
};
/** Ziua săptămânii (0 = duminică) și ziua din lună, la salon. */
export const weekdayOf = wd;
export const dayOfMonth = (d: Date) => wall(d).d;
/** Ora (0–23) la salon. */
export const hourOf = (d: Date) => wall(d).h;

export const shortDay = (d: Date) => DAYS()[wd(d)];
export const longDay = (d: Date) => DAYS_LONG()[wd(d)];
export const shortMonth = (d: Date) => MONTHS()[wall(d).mo - 1];
/** Numele zilei după numărul ei (0 = duminică), scurt sau lung. */
export const dayName = (weekday: number, long = false) => (long ? DAYS_LONG() : DAYS())[weekday];
/** O zi AAAA-LL-ZZ scurt: „5 oct”. */
export const shortDate = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS()[Number(day.slice(5, 7)) - 1]}`;

export const formatTime = (d: Date) => {
  const w = wall(d);
  return `${pad(w.h)}:${pad(w.mi)}`;
};

export const formatDate = (d: Date) => {
  const w = wall(d);
  return tr('date.full', { weekday: longDay(d), day: w.d, month: shortMonth(d), year: w.y });
};

export function parseHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(Number);
  const c = new Date(base);
  c.setHours(h, m, 0, 0);
  return c;
}

/** Data nașterii scrisă ZZ.LL.AAAA → AAAA-LL-ZZ; null dacă nu e o dată reală. */
export function parseBirth(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso >= '1900-01-01' && d.getTime() <= Date.now() ? iso : null;
}

/** AAAA-LL-ZZ → ZZ.LL.AAAA */
export const formatBirth = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('.') : '');

/** Vârsta în ani, pentru fișa clientului. */
export function ageFrom(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
}
