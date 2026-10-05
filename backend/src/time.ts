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
