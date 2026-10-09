// Conversii între ora locală a salonului (Europe/Bucharest) și UTC.
// Programul e stocat în minute de la miezul nopții, ora locală; programările în ISO UTC.

function partsIn(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return p;
}

/** Diferența (ms) dintre ora locală și UTC la momentul dat. */
function offsetMs(tz: string, d: Date): number {
  const p = partsIn(tz, d);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Ziua locală `YYYY-MM-DD` + minute de la miezul nopții → Date UTC. */
export function localToUtc(tz: string, day: string, minutes: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  // Două treceri acoperă și zilele cu schimbarea orei.
  let t = guess.getTime() - offsetMs(tz, guess);
  t = guess.getTime() - offsetMs(tz, new Date(t));
  return new Date(t);
}

export function localDay(tz: string, d: Date): string {
  const p = partsIn(tz, d);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localMinutes(tz: string, d: Date): number {
  const p = partsIn(tz, d);
  return +p.hour * 60 + +p.minute;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function localWeekday(tz: string, d: Date): number {
  return WD[partsIn(tz, d).weekday];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function formatLocal(tz: string, iso: string, lang = 'ro'): string {
  const locale = lang === 'en' ? 'en-GB' : lang === 'fr' ? 'fr-FR' : 'ro-RO';
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Dacă `day` (AAAA-LL-ZZ) e ziua de naștere; cei născuți pe 29 februarie o serbează pe 28 în anii obișnuiți. */
export function isBirthdayOn(birthDate: string | null | undefined, day: string): boolean {
  if (!birthDate || birthDate.length < 10) return false;
  const md = birthDate.slice(5, 10);
  if (md === day.slice(5, 10)) return true;
  return md === '02-29' && day.slice(5, 10) === '02-28' && !isLeap(Number(day.slice(0, 4)));
}

// Ora României după regula UE (ora de vară: ultima duminică din martie – ultima duminică din octombrie, la 01:00 UTC).
// E mult mai rapidă decât Intl pe mii de rânduri, ceea ce contează la limita de procesor a Worker-ului.
const dstCache = new Map<number, [number, number]>();
function lastSundayUtc1(y: number, month: number) {
  const last = Date.UTC(y, month + 1, 0);
  return last - new Date(last).getUTCDay() * 86_400_000 + 3_600_000;
}
function roOffsetMs(ms: number) {
  const y = new Date(ms).getUTCFullYear();
  let r = dstCache.get(y);
  if (!r) dstCache.set(y, (r = [lastSundayUtc1(y, 2), lastSundayUtc1(y, 9)]));
  return (ms >= r[0] && ms < r[1] ? 3 : 2) * 3_600_000;
}
/** Ziua locală `YYYY-MM-DD` și ora `HH:MM` pentru un moment ISO. */
export function roLocal(t: string | Date) {
  const ms = typeof t === 'string' ? Date.parse(t) : t.getTime();
  const s = new Date(ms + roOffsetMs(ms)).toISOString();
  return { day: s.slice(0, 10), hm: s.slice(11, 16) };
}

/** De la ce oră (minute locale) nu mai trimitem mesaje cu oferte (urări, „Ne e dor de tine”), până a doua zi. */
export const QUIET_FROM = 22 * 60;
