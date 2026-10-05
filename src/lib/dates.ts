const DAYS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
const DAYS_LONG = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];
const MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export const pad = (n: number) => String(n).padStart(2, '0');

export function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, n: number) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDayKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const shortDay = (d: Date) => DAYS[d.getDay()];
export const longDay = (d: Date) => DAYS_LONG[d.getDay()];
export const shortMonth = (d: Date) => MONTHS[d.getMonth()];

export const formatTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const formatDate = (d: Date) =>
  `${longDay(d)}, ${d.getDate()} ${shortMonth(d)} ${d.getFullYear()}`;

export function parseHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(Number);
  const c = new Date(base);
  c.setHours(h, m, 0, 0);
  return c;
}
