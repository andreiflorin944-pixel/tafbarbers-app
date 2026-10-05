// Ore și date afișate mereu în ora salonului, indiferent unde e deschis panoul.
export const TZ = 'Europe/Bucharest';

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ro-RO', { timeZone: TZ, ...o });
const timeF = fmt({ hour: '2-digit', minute: '2-digit' });
const dateF = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const longF = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayKeyF = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const time = (iso: string | Date) => timeF.format(new Date(iso));
export const date = (iso: string | Date) => dateF.format(new Date(iso));
export const longDate = (iso: string | Date) => longF.format(new Date(iso));
/** Ziua locală (YYYY-MM-DD) a unui moment. */
export const dayOf = (d: string | Date) => dayKeyF.format(new Date(d));
export const today = () => dayOf(new Date());

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Minute de la miezul nopții (ora salonului) pentru un moment. */
export function minutesOf(iso: string) {
  const [h, m] = time(iso).split(':').map(Number);
  return h * 60 + m;
}

/** Ziua locală + ora "HH:MM" → ISO UTC (ține cont de ora de vară). */
export function localToIso(day: string, hm: string) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t).toISOString();
}

export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const parseHm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const WEEKDAYS = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
export const STATUS: Record<string, string> = {
  confirmed: 'Confirmată',
  cancelled: 'Anulată',
  completed: 'Finalizată',
  no_show: 'Neprezentare',
};
export const lei = (n: number) => `${n.toLocaleString('ro-RO')} lei`;
