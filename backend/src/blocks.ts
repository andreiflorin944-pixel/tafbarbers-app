import { newId } from './auth';
import { getBusiness } from './db';
import { HttpError, type Env } from './env';
import { addDays, iso, isDay, localDay, localMinutes, localToUtc, weekdayOf } from './time';

// Blocuri în programul unui frizer (sau al tuturor): o singură dată (zi + interval) sau recurente
// (zile ale săptămânii + interval, opțional până la o dată). Pauza, liberul, cursul și „altceva” scot
// orele din programările online; „doar membri” le lasă libere numai pentru membrii TAF Club.
// Concediile pe zile întregi și închiderea salonului rămân în time_off (pagina Concedii).

export const BLOCK_KINDS = ['lunch', 'off', 'education', 'other', 'members'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_LABELS: Record<BlockKind, string> = {
  lunch: 'Pauză de masă',
  off: 'Liber',
  education: 'Educațional',
  other: 'Altceva',
  members: 'Doar membri TAF Club',
};
/** Tipurile care scot orele din program (pentru toți clienții). */
export const blocksTime = (k: string) => k !== 'members';

export type BlockRow = {
  id: string;
  barber_id: string | null;
  kind: BlockKind;
  label: string;
  day: string | null;
  weekdays: string | null;
  start_min: number;
  end_min: number;
  from_day: string | null;
  until_day: string | null;
  created_at: string;
};

const wdList = (s: string | null) => (s ? s.split(',').filter(Boolean).map(Number) : []);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const block = (r: BlockRow) => ({
  id: r.id,
  barberId: r.barber_id,
  kind: r.kind,
  label: r.label || BLOCK_LABELS[r.kind],
  customLabel: r.label,
  repeat: !!r.weekdays,
  day: r.day,
  weekdays: wdList(r.weekdays),
  start: hhmm(r.start_min),
  end: hhmm(r.end_min),
  fromDay: r.from_day,
  untilDay: r.until_day,
  createdAt: r.created_at,
});
export type Block = ReturnType<typeof block>;

/** Blocul se aplică în ziua locală dată? */
export function blockOnDay(r: Pick<BlockRow, 'day' | 'weekdays' | 'from_day' | 'until_day'>, day: string) {
  if (r.day) return r.day === day;
  if (r.from_day && day < r.from_day) return false;
  if (r.until_day && day > r.until_day) return false;
  return wdList(r.weekdays).includes(weekdayOf(day));
}

/** Blocurile care pot cădea în intervalul de zile [fromDay, toDay] (pentru toți sau doar pentru unii frizeri). */
async function blockRows(env: Env, fromDay: string, toDay: string, barberIds?: string[] | null) {
  const only = barberIds && barberIds.length ? `AND (barber_id IS NULL OR barber_id IN (${barberIds.map(() => '?').join(',')}))` : '';
  const r = await env.DB.prepare(
    `SELECT * FROM schedule_blocks
     WHERE ((day IS NOT NULL AND day BETWEEN ? AND ?) OR (weekdays IS NOT NULL AND (from_day IS NULL OR from_day <= ?) AND (until_day IS NULL OR until_day >= ?)))
     ${only} ORDER BY start_min`,
  )
    .bind(fromDay, toDay, toDay, fromDay, ...(barberIds && barberIds.length ? barberIds : []))
    .all<BlockRow>();
  return r.results;
}

/** Blocurile dintr-o zi, cu intervalul în ms UTC (pentru calculul orelor libere). */
export async function blocksForDay(env: Env, day: string, barberIds: string[]) {
  const rows = (await blockRows(env, day, day, barberIds)).filter((r) => blockOnDay(r, day));
  return rows.map((r) => ({
    barberId: r.barber_id,
    kind: r.kind,
    s: localToUtc(env.TIMEZONE, day, r.start_min).getTime(),
    e: localToUtc(env.TIMEZONE, day, r.end_min).getTime(),
  }));
}

/** Fiecare apariție a blocurilor între două zile (inclusiv), pentru calendar. */
export async function blockOccurrences(env: Env, fromDay: string, toDay: string, barberId?: string | null) {
  const rows = await blockRows(env, fromDay, toDay, barberId ? [barberId] : null);
  const out: Array<{ blockId: string; barberId: string | null; kind: BlockKind; label: string; customLabel: string; repeat: boolean; day: string; start: string; end: string }> = [];
  for (let d = fromDay, n = 0; d <= toDay && n < 62; d = addDays(d, 1), n++) {
    for (const r of rows) {
      if (!blockOnDay(r, d)) continue;
      out.push({
        blockId: r.id,
        barberId: r.barber_id,
        kind: r.kind,
        label: r.label || BLOCK_LABELS[r.kind],
        customLabel: r.label, // aplicația arată numele tipului în limba ei când e gol
        repeat: !!r.weekdays,
        day: d,
        start: iso(localToUtc(env.TIMEZONE, d, r.start_min)),
        end: iso(localToUtc(env.TIMEZONE, d, r.end_min)),
      });
    }
  }
  return out;
}

/** Lista din panou: blocurile care încă au efect (cele cu o singură dată din ultima săptămână încolo). */
export async function listBlocks(env: Env, barberId: string | null) {
  const since = addDays(localDay(env.TIMEZONE, new Date()), -7);
  const r = await env.DB.prepare(
    `SELECT * FROM schedule_blocks WHERE ((day IS NOT NULL AND day >= ?) OR (weekdays IS NOT NULL AND (until_day IS NULL OR until_day >= ?)))
     ${barberId ? 'AND (barber_id = ? OR barber_id IS NULL)' : ''} ORDER BY weekdays IS NULL, day, start_min`,
  )
    .bind(...(barberId ? [since, since, barberId] : [since, since]))
    .all<BlockRow>();
  return r.results.map(block);
}

export type BlockInput = {
  barberId?: string | null;
  kind?: string;
  label?: string;
  repeat?: boolean;
  day?: string;
  weekdays?: number[];
  start?: string;
  end?: string;
  fromDay?: string | null;
  untilDay?: string | null;
};

/** „HH:MM” → minute de la miezul nopții (24:00 e voie, ca sfârșit). */
function minutesOf(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]),
    mm = Number(m[2]);
  if (mm > 59 || h > 24 || (h === 24 && mm)) return null;
  return h * 60 + mm;
}

/** Validează și salvează un bloc nou. Întoarce blocul și câte programări deja făcute se suprapun cu el. */
export async function createBlock(env: Env, b: BlockInput, adminId: string) {
  const kind = BLOCK_KINDS.includes(b.kind as BlockKind) ? (b.kind as BlockKind) : null;
  if (!kind) throw new HttpError(400, 'invalid_block_kind');
  const label = String(b.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (kind === 'other' && !label) throw new HttpError(400, 'block_label_required');
  const start = minutesOf(b.start);
  const end = minutesOf(b.end);
  if (start === null || end === null || start >= 1440 || end <= start) throw new HttpError(400, 'invalid_range');

  const barberId = b.barberId || null;
  if (barberId) {
    const ok = await env.DB.prepare('SELECT 1 FROM barbers WHERE id = ?').bind(barberId).first();
    if (!ok) throw new HttpError(404, 'barber_not_found');
  }
  const today = localDay(env.TIMEZONE, new Date());
  let day: string | null = null,
    weekdays: string | null = null,
    fromDay: string | null = null,
    untilDay: string | null = null;
  if (b.repeat) {
    const wd = [...new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number))].filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).sort();
    if (!wd.length) throw new HttpError(400, 'weekdays_required');
    weekdays = `,${wd.join(',')},`;
    fromDay = isDay(b.fromDay) ? b.fromDay : today;
    if (b.untilDay) {
      if (!isDay(b.untilDay)) throw new HttpError(400, 'invalid_range');
      if (b.untilDay < fromDay) throw new HttpError(400, 'invalid_range');
      untilDay = b.untilDay;
    }
  } else {
    if (!isDay(b.day)) throw new HttpError(400, 'invalid_range');
    if (b.day < today) throw new HttpError(400, 'day_passed');
    day = b.day;
  }

  const id = newId('blk');
  await env.DB.prepare(
    `INSERT INTO schedule_blocks (id, barber_id, kind, label, day, weekdays, start_min, end_min, from_day, until_day, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, barberId, kind, label, day, weekdays, start, end, fromDay, untilDay, adminId)
    .run();
  const row = (await env.DB.prepare('SELECT * FROM schedule_blocks WHERE id = ?').bind(id).first<BlockRow>())!;
  return { block: block(row), conflicts: blocksTime(kind) ? await conflictsOf(env, row) : 0 };
}

/**
 * Programările deja făcute (confirmate sau cereri) care cad peste un bloc nou, din ziua de azi
 * până la cât se poate programa în avans. Blocul nu le anulează; panoul doar avertizează.
 */
async function conflictsOf(env: Env, r: BlockRow) {
  const biz = await getBusiness(env);
  const today = localDay(env.TIMEZONE, new Date());
  const from = r.day ?? (r.from_day && r.from_day > today ? r.from_day : today);
  let to = r.day ?? addDays(today, biz.maxDaysAhead ?? 30);
  if (r.until_day && r.until_day < to) to = r.until_day;
  if (to < from) return 0;
  const bk = await env.DB.prepare(
    `SELECT starts_at, ends_at FROM bookings WHERE status IN ('confirmed','requested') AND starts_at >= ? AND starts_at < ? ${r.barber_id ? 'AND barber_id = ?' : ''} LIMIT 2000`,
  )
    .bind(...[iso(localToUtc(env.TIMEZONE, from, 0)), iso(localToUtc(env.TIMEZONE, to, 1440)), ...(r.barber_id ? [r.barber_id] : [])])
    .all<{ starts_at: string; ends_at: string }>();
  let n = 0;
  for (const x of bk.results) {
    const s = new Date(x.starts_at);
    const d = localDay(env.TIMEZONE, s);
    if (!blockOnDay(r, d)) continue;
    const sm = localMinutes(env.TIMEZONE, s);
    const em = sm + (Date.parse(x.ends_at) - s.getTime()) / 60_000;
    if (sm < r.end_min && em > r.start_min) n++;
  }
  return n;
}

/** Șterge un bloc (frizerul fără drept pe toți doar pe ale lui). Întoarce dacă a șters ceva. */
export async function deleteBlock(env: Env, id: string, scopedBarber: string | null) {
  const r = await env.DB.prepare(`DELETE FROM schedule_blocks WHERE id = ? ${scopedBarber ? 'AND barber_id = ?' : ''}`)
    .bind(...(scopedBarber ? [id, scopedBarber] : [id]))
    .run();
  return !!r.meta.changes;
}
