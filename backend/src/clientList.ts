import type { Env } from './env';
import { addDays, localDay } from './time';

// Lista de clienți din panou, ca în Barberly: clasament după cât au cheltuit, etichete (nou, top 100, în risc,
// expirat, rezervat, zi de naștere, membru TAF Club) și statistici. Istoricul adus din Barberly la import (coloanele hist_*) se
// adună cu programările făcute la noi.

export const SEGMENTS = ['all', 'new', 'top', 'risk', 'expired', 'booked', 'birthday', 'club'] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SORTS = ['rank', 'spent', 'last', 'name', 'visits', 'newest'] as const;
export type Sort = (typeof SORTS)[number];

type Row = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  birth_date: string | null;
  created_at: string;
  photo_url: string | null;
  app: number;
  preferred_barber_id: string | null;
  hist_visits: number | null;
  hist_spent_bani: number | null;
  hist_cancelled: number | null;
  hist_cancelled_bani: number | null;
  hist_noshows: number | null;
  hist_noshow_bani: number | null;
  hist_first_visit: string | null;
  hist_last_visit: string | null;
  club_manual: number | null;
  club_sub: number;
};
type Agg = {
  client_id: string;
  done: number;
  done_bani: number;
  canc: number;
  canc_bani: number;
  ns: number;
  ns_bani: number;
  first: string | null;
  last: string | null;
  up: number;
  up_bani: number;
  next: string | null;
};

export type ClientListItem = {
  id: string;
  rank: number | null;
  name: string;
  phone: string;
  email: string | null;
  birthDate: string | null;
  photoUrl: string | null;
  app: boolean;
  barberId: string | null;
  visits: number;
  spent: number;
  cancelled: number;
  cancelledAmount: number;
  noShows: number;
  noShowAmount: number;
  avg: number;
  interval: number | null;
  upcoming: number;
  upcomingAmount: number;
  firstVisit: string | null;
  lastVisit: string | null;
  nextVisit: string | null;
  createdAt: string;
  /** De ce e membru TAF Club: abonament activ sau bifat de mână în fișă (abonamentul are întâietate). */
  clubVia: 'sub' | 'manual' | null;
  tags: { new: boolean; top: boolean; risk: boolean; expired: boolean; booked: boolean; birthday: boolean; club: boolean };
};

const DAY = 86_400_000;
const lei = (bani: number | null | undefined) => Math.round(bani ?? 0) / 100;
const maxIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const minIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Câte zile până la următoarea aniversare (0 = azi); 29 februarie se serbează pe 28 în anii obișnuiți. */
function daysToBirthday(birth: string | null, today: string): number | null {
  if (!birth || birth.length < 10) return null;
  for (let i = 0; i < 366; i++) {
    const d = addDays(today, i);
    const md = birth.slice(5, 10);
    if (md === d.slice(5, 10)) return i;
    if (md === '02-29' && d.slice(5, 10) === '02-28' && Number(d.slice(0, 4)) % 4 !== 0) return i;
  }
  return null;
}

/** Toți clienții cu statisticile lor (fără filtre). `locationId` restrânge programările noastre la o locație. */
export async function clientStats(env: Env, now: Date, locationId: string | null): Promise<ClientListItem[]> {
  const nowIso = now.toISOString();
  const loc = locationId ? ' AND location_id = ?' : '';
  const bind = locationId ? [locationId] : [];
  const [clients, aggs, prefs] = await env.DB.batch([
    env.DB.prepare(
      `SELECT c.id, c.name, c.phone, c.email, c.birth_date, c.created_at, c.photo_url, c.preferred_barber_id,
         (c.terms_accepted_at IS NOT NULL OR c.password_hash IS NOT NULL) AS app,
         c.hist_visits, c.hist_spent_bani, c.hist_cancelled, c.hist_cancelled_bani, c.hist_noshows, c.hist_noshow_bani, c.hist_first_visit, c.hist_last_visit,
         c.club_member AS club_manual,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.client_id = c.id AND s.status = 'active' AND s.starts_at <= ? AND s.ends_at > ?
                 AND (s.cuts_total IS NULL OR s.cuts_used < s.cuts_total)) AS club_sub
       FROM clients c WHERE c.deleted_at IS NULL`,
    ).bind(nowIso, nowIso),
    env.DB.prepare(
      `SELECT client_id,
         sum(status = 'completed') AS done,
         sum(CASE WHEN status = 'completed' THEN coalesce(paid_bani, price_bani) ELSE 0 END) AS done_bani,
         sum(status = 'cancelled') AS canc,
         sum(CASE WHEN status = 'cancelled' THEN price_bani ELSE 0 END) AS canc_bani,
         sum(status = 'no_show') AS ns,
         sum(CASE WHEN status = 'no_show' THEN price_bani ELSE 0 END) AS ns_bani,
         min(CASE WHEN status = 'completed' THEN starts_at END) AS first,
         max(CASE WHEN status = 'completed' THEN starts_at END) AS last,
         sum(status IN ('confirmed','requested') AND starts_at > ?) AS up,
         sum(CASE WHEN status IN ('confirmed','requested') AND starts_at > ? THEN price_bani ELSE 0 END) AS up_bani,
         min(CASE WHEN status IN ('confirmed','requested') AND starts_at > ? THEN starts_at END) AS next
       FROM bookings WHERE 1 = 1${loc} GROUP BY client_id`,
    ).bind(nowIso, nowIso, nowIso, ...bind),
    env.DB.prepare(`SELECT client_id, barber_id, count(*) AS n FROM bookings WHERE status IN ('completed','confirmed')${loc} GROUP BY client_id, barber_id`).bind(...bind),
  ]);
  const agg = new Map((aggs.results as Agg[]).map((a) => [a.client_id, a]));
  // Frizerul preferat: cel la care a venit cel mai des la noi; altfel cel din Barberly.
  const pref = new Map<string, { id: string; n: number }>();
  for (const p of prefs.results as Array<{ client_id: string; barber_id: string; n: number }>) {
    const cur = pref.get(p.client_id);
    if (!cur || p.n > cur.n) pref.set(p.client_id, { id: p.barber_id, n: p.n });
  }
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const today = localDay(tz, now);
  const items: ClientListItem[] = (clients.results as Row[]).map((c) => {
    const a = agg.get(c.id);
    const visits = (c.hist_visits ?? 0) + (a?.done ?? 0);
    const spent = lei(c.hist_spent_bani) + lei(a?.done_bani);
    const cancelled = (c.hist_cancelled ?? 0) + (a?.canc ?? 0);
    const noShows = (c.hist_noshows ?? 0) + (a?.ns ?? 0);
    const firstVisit = minIso(c.hist_first_visit, a?.first ?? null);
    const lastVisit = maxIso(c.hist_last_visit, a?.last ?? null);
    const interval = visits >= 2 && firstVisit && lastVisit ? Math.max(1, Math.round((Date.parse(lastVisit) - Date.parse(firstVisit)) / DAY / (visits - 1))) : null;
    const upcoming = a?.up ?? 0;
    const since = lastVisit ? (now.getTime() - Date.parse(lastVisit)) / DAY : null;
    const bday = daysToBirthday(c.birth_date, today);
    // Aceeași regulă ca isClubMember (subscriptions.ts).
    const clubVia = c.club_sub ? 'sub' : c.club_manual ? 'manual' : null;
    const isNew = firstVisit ? now.getTime() - Date.parse(firstVisit) <= 30 * DAY : c.hist_visits === null && now.getTime() - Date.parse(c.created_at) <= 30 * DAY;
    return {
      id: c.id,
      rank: null,
      name: c.name,
      phone: c.phone,
      email: c.email,
      birthDate: c.birth_date,
      photoUrl: c.photo_url,
      app: !!c.app,
      barberId: pref.get(c.id)?.id ?? c.preferred_barber_id,
      visits,
      spent: Math.round(spent * 100) / 100,
      cancelled,
      cancelledAmount: lei(c.hist_cancelled_bani) + lei(a?.canc_bani),
      noShows,
      noShowAmount: lei(c.hist_noshow_bani) + lei(a?.ns_bani),
      avg: visits ? Math.round((spent / visits) * 100) / 100 : 0,
      interval,
      upcoming,
      upcomingAmount: lei(a?.up_bani),
      firstVisit,
      lastVisit,
      nextVisit: a?.next ?? null,
      createdAt: c.created_at,
      clubVia,
      tags: {
        new: isNew,
        top: false,
        // Regulile lui Barberly, verificate pe exportul lor: în risc = cel puțin o neprezentare sau multe anulări
        // (minim 2 și cel puțin 30% din programări); expirat = fără programare viitoare și de peste 1,5 ori intervalul lui
        // obișnuit (minim o săptămână în plus) de la ultima vizită. Cine a venit o singură dată nu are ritm, deci nu expiră.
        risk: noShows >= 1 || (cancelled >= 2 && cancelled / (cancelled + visits) >= 0.3),
        expired: !upcoming && since !== null && interval !== null && since > Math.max(1.5 * interval, interval + 7),
        booked: upcoming > 0,
        birthday: bday !== null && bday <= 7,
        club: clubVia !== null,
      },
    };
  });
  // Clasamentul: după suma cheltuită (la egalitate, după numărul de vizite); doar cine a cheltuit ceva.
  const ranked = items.filter((x) => x.spent > 0).sort((a, b) => b.spent - a.spent || b.visits - a.visits);
  ranked.forEach((x, i) => {
    x.rank = i + 1;
    x.tags.top = i < 100;
  });
  return items;
}

export type ListQuery = { segment: Segment; barberId: string | null; sort: Sort; q: string; offset: number; limit: number };

export function filterClients(items: ClientListItem[], o: ListQuery, today: string) {
  const counts = Object.fromEntries(SEGMENTS.map((s) => [s, 0])) as Record<Segment, number>;
  for (const x of items) {
    counts.all++;
    for (const s of SEGMENTS) if (s !== 'all' && x.tags[s]) counts[s]++;
  }
  const q = o.q.toLowerCase();
  const digits = o.q.replace(/\D/g, '');
  let list = items.filter(
    (x) =>
      (o.segment === 'all' || x.tags[o.segment]) &&
      (!o.barberId || x.barberId === o.barberId) &&
      (!q ||
        x.name.toLowerCase().includes(q) ||
        (x.email ?? '').toLowerCase().includes(q) ||
        (digits.length >= 3 && (x.phone.replace(/\D/g, '').includes(digits) || x.phone.replace(/^\+40/, '0').includes(digits)))),
  );
  const by: Record<Sort, (a: ClientListItem, b: ClientListItem) => number> = {
    rank: (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name, 'ro'),
    spent: (a, b) => b.spent - a.spent,
    last: (a, b) => (b.lastVisit ?? '').localeCompare(a.lastVisit ?? ''),
    name: (a, b) => (a.name || '￿').localeCompare(b.name || '￿', 'ro'),
    visits: (a, b) => b.visits - a.visits,
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  };
  // La „Zi de naștere” ordinea firească e cine își serbează primul.
  const sorter = o.segment === 'birthday' ? (a: ClientListItem, b: ClientListItem) => (daysToBirthday(a.birthDate, today) ?? 999) - (daysToBirthday(b.birthDate, today) ?? 999) : by[o.sort];
  list = list.sort(sorter);
  return { counts, total: list.length, rows: list.slice(o.offset, o.offset + o.limit) };
}
