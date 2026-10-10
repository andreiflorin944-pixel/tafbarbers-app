// Tabloul de bord și rapoartele pentru echipă. Totul se calculează pe zile locale (Europe/Bucharest),
// așa că rândurile se aduc din D1 și se grupează aici. Un salon are câteva mii de programări pe an, deci încape lejer.
import { HttpError, type AdminSession, type Env } from './env';
import { addDays, iso, isDay, localToUtc, roLocal } from './time';
import type { Cell } from './xlsx';
import { listMoves, MOVE_LABELS } from './stock';

export type ColType = 'text' | 'int' | 'money' | 'pct' | 'date' | 'datetime';
export type Col = { key: string; label: string; type: ColType };
export type Row = Record<string, string | number | null>;
export type Report = { kind: string; title: string; from: string; to: string; columns: Col[]; rows: Row[]; totals: Row | null };

/** Ce rapoarte există, în ordinea din meniu. `clients` = conține liste de clienți (cere dreptul „Clienți”). */
export const REPORTS = [
  { kind: 'day', title: 'Raportul zilei', range: 'day' },
  { kind: 'bookings', title: 'Lista programărilor', range: 'period' },
  { kind: 'sales-barber', title: 'Vânzări pe membru de echipă', range: 'period' },
  { kind: 'sales-service', title: 'Vânzări pe servicii', range: 'period' },
  { kind: 'bookings-barber', title: 'Rezervări pe membru de echipă', range: 'period' },
  { kind: 'upcoming', title: 'Rezervări viitoare', range: 'future' },
  { kind: 'cancel-staff', title: 'Anulări din partea echipei', range: 'period' },
  { kind: 'cancel-client', title: 'Anulări de către client', range: 'period' },
  { kind: 'payments', title: 'Plăți', range: 'period' },
  { kind: 'payments-member', title: 'Plăți în funcție de membrul echipei', range: 'period' },
  { kind: 'online-payments', title: 'Plăți online (card în aplicație)', range: 'period' },
  { kind: 'tips-member', title: 'Bacșișuri pe membru de echipă', range: 'period' },
  { kind: 'top100', title: 'Clienți TOP-100', range: 'period', clients: true },
  { kind: 'retention', title: 'Păstrarea clienților', range: 'months' },
  { kind: 'new-returning', title: 'Clienți noi vs. clienți care revin', range: 'period' },
  { kind: 'register', title: 'Registrul de încasări', range: 'day' },
  { kind: 'stock', title: 'Situația stocului', range: 'day', shop: true },
  { kind: 'stock-moves', title: 'Intrări și ieșiri de produse', range: 'period', shop: true },
] as const;
export type ReportKind = (typeof REPORTS)[number]['kind'];

const TZ = 'Europe/Bucharest';
const MAX_DAYS = 400;

const STATUS: Record<string, string> = { requested: 'Cerere în așteptare', confirmed: 'Confirmată', completed: 'Finalizată', cancelled: 'Anulată', no_show: 'Neprezentare' };
const SOURCE: Record<string, string> = { app: 'Aplicație', admin: 'Echipă', web: 'Site' };
const PAYMENT: Record<string, string> = { paid: 'Plătită', subscription: 'Abonament' };
const METHOD: Record<string, string> = { cash: 'Numerar', card: 'Card (POS)', transfer: 'Transfer', online: 'Online', app: 'În aplicație (neplătită încă)' };

type BRow = {
  id: string;
  client_id: string;
  barber_id: string;
  service_id: string;
  starts_at: string;
  created_at: string;
  price_bani: number;
  status: string;
  source: string;
  payment: string | null;
  paid_bani: number | null;
  tip_bani: number | null;
  gift_bani: number | null;
  pay_method: string | null;
  ends_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  request_outcome: string | null;
  completed_by: string | null;
  client_name: string;
  client_phone: string;
  client_email: string | null;
  service_name: string;
  barber_name: string;
  canceller_name: string | null;
  completer_name: string | null;
  day: string;
};
/** Cererile la care nu a răspuns nimeni se anulează singure: nu sunt anulări ale echipei. */
const expiredRequest = (b: BRow) => b.status === 'cancelled' && b.request_outcome === 'expired';
const staffCancelled = (b: BRow) => b.status === 'cancelled' && b.cancelled_by !== 'client' && !expiredRequest(b);

type SRow = {
  id: string;
  client_id: string;
  name: string;
  price_bani: number;
  created_at: string;
  created_by: string | null;
  admin_name: string | null;
  admin_barber: string | null;
  admin_barber_name: string | null;
  client_name: string;
  kind: 'sub' | 'gift';
  pay_method: string | null;
  day: string;
};

export type Scope = { session: AdminSession; barberId: string | null };

const dayKey = (t: string | Date) => roLocal(t).day;
const lei = (bani: number | null | undefined) => Math.round(bani ?? 0) / 100;
const localDT = (t: string) => {
  const l = roLocal(t);
  return `${l.day} ${l.hm}`;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
/** Vizită = programare care a avut loc (nu anulată, nu neprezentare, ora a trecut). */
const isVisit = (b: { status: string; starts_at: string }, now: string) => (b.status === 'completed' || b.status === 'confirmed') && b.starts_at <= now;
// Plata cerută în aplicație și încă neplătită („app”) nu e încasată: intră când vine plata (devine „online”).
const collected = (b: BRow) => (b.payment === 'paid' && b.pay_method !== 'app' ? (b.paid_bani ?? 0) : 0);

function range(from: string, to: string) {
  return { start: iso(localToUtc(TZ, from, 0)), end: iso(localToUtc(TZ, addDays(to, 1), 0)) };
}

async function loadBookings(env: Env, scope: Scope, from: string, to: string, f: { serviceId?: string; barberId?: string } = {}) {
  const { start, end } = range(from, to);
  const where = ['b.starts_at >= ?', 'b.starts_at < ?'];
  const vals: unknown[] = [start, end];
  const barber = scope.barberId ?? f.barberId;
  if (barber) where.push('b.barber_id = ?'), vals.push(barber);
  if (f.serviceId) where.push('b.service_id = ?'), vals.push(f.serviceId);
  const r = await env.DB.prepare(
    `SELECT b.id, b.client_id, b.barber_id, b.service_id, b.starts_at, b.created_at, b.price_bani, b.status, b.source, b.payment, b.paid_bani,
       b.tip_bani, b.gift_bani, b.pay_method, b.ends_at, b.cancelled_at, b.cancelled_by, b.request_outcome, b.completed_by, c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
       s.name AS service_name, br.name AS barber_name, coalesce(nullif(ca.name, ''), ca.email) AS canceller_name,
       coalesce(nullif(cb.name, ''), cb.email) AS completer_name
     FROM bookings b JOIN clients c ON c.id = b.client_id JOIN services s ON s.id = b.service_id JOIN barbers br ON br.id = b.barber_id
     LEFT JOIN admins ca ON ca.id = b.cancelled_by_admin LEFT JOIN admins cb ON cb.id = b.completed_by
     WHERE ${where.join(' AND ')} ORDER BY b.starts_at LIMIT 30000`,
  )
    .bind(...vals)
    .all<BRow>();
  for (const b of r.results) b.day = dayKey(b.starts_at);
  return r.results;
}

/** Abonamentele și cardurile cadou vândute în perioadă (cardul se numără la încasare). Un cont fără „toate programările” vede doar ce a încasat el. */
async function loadSubscriptions(env: Env, scope: Scope, from: string, to: string) {
  const { start, end } = range(from, to);
  const own = scope.barberId ? 'AND s.created_by = ?' : '';
  const ownG = scope.barberId ? 'AND g.paid_by = ?' : '';
  const r = await env.DB.prepare(
    `SELECT * FROM (
       SELECT s.id, s.client_id, s.name, s.price_bani, s.created_at, s.created_by, coalesce(nullif(a.name, ''), a.email) AS admin_name,
         a.barber_id AS admin_barber, br.name AS admin_barber_name, c.name AS client_name, 'sub' AS kind, s.pay_method
       FROM subscriptions s JOIN clients c ON c.id = s.client_id LEFT JOIN admins a ON a.id = s.created_by LEFT JOIN barbers br ON br.id = a.barber_id
       WHERE s.status != 'cancelled' AND s.created_at >= ? AND s.created_at < ? ${own}
       UNION ALL
       SELECT g.id, coalesce(g.buyer_client_id, 'gift:' || g.id), 'Card cadou ' || g.code, g.amount_bani, g.paid_at, g.paid_by, coalesce(nullif(a.name, ''), a.email),
         a.barber_id, br.name, coalesce(c.name, g.recipient_name), 'gift', g.pay_method
       FROM gift_cards g LEFT JOIN clients c ON c.id = g.buyer_client_id LEFT JOIN admins a ON a.id = g.paid_by LEFT JOIN barbers br ON br.id = a.barber_id
       WHERE g.paid_at IS NOT NULL AND g.status != 'cancelled' AND g.paid_at >= ? AND g.paid_at < ? ${ownG}
     ) ORDER BY created_at`,
  )
    .bind(...(scope.barberId ? [start, end, scope.session.adminId, start, end, scope.session.adminId] : [start, end, start, end]))
    .all<SRow>();
  for (const x of r.results) x.day = dayKey(x.created_at);
  return r.results;
}

/** Prima vizită a fiecărui client la salon (pentru „nou” vs „revine”). */
async function firstVisits(env: Env): Promise<Map<string, string>> {
  const r = await env.DB.prepare(
    `SELECT client_id, min(starts_at) AS first FROM bookings WHERE status IN ('completed','confirmed') AND starts_at <= ? GROUP BY client_id`,
  )
    .bind(iso(new Date()))
    .all<{ client_id: string; first: string }>();
  return new Map(r.results.map((x) => [x.client_id, x.first]));
}

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const a = m.get(k);
    if (a) a.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function sumRows(rows: Row[], cols: Col[], label: string): Row {
  const t: Row = {};
  cols.forEach((c, i) => {
    if (i === 0) t[c.key] = label;
    else if (c.type === 'int' || c.type === 'money') t[c.key] = Math.round(rows.reduce((n, r) => n + (Number(r[c.key]) || 0), 0) * 100) / 100;
    else t[c.key] = null;
  });
  return t;
}

export function parsePeriod(q: Record<string, string>, kind: ReportKind) {
  const today = dayKey(new Date());
  const meta = REPORTS.find((r) => r.kind === kind)!;
  let from = isDay(q.from) ? q.from : meta.range === 'future' ? today : meta.range === 'months' ? addDays(today, -364) : meta.range === 'day' ? today : addDays(today, -29);
  let to = isDay(q.to) ? q.to : meta.range === 'future' ? addDays(today, 30) : today;
  if (meta.range === 'day') to = from;
  if (from > to) [from, to] = [to, from];
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 86_400_000) throw new HttpError(400, 'range_too_long');
  return { from, to };
}

export async function buildReport(env: Env, scope: Scope, kind: ReportKind, q: Record<string, string>): Promise<Report> {
  const meta = REPORTS.find((r) => r.kind === kind);
  if (!meta) throw new HttpError(404, 'not_found');
  const perms = scope.session.perms;
  if ('clients' in meta && meta.clients && !perms.clients) throw new HttpError(403, 'no_permission');
  if ('shop' in meta && meta.shop && !perms.shop) throw new HttpError(403, 'no_permission');
  const { from, to } = parsePeriod(q, kind);
  const now = iso(new Date());
  const filters = { serviceId: q.serviceId || undefined, barberId: q.barberId || undefined };
  const base = { kind, title: meta.title, from, to };

  let columns: Col[] = [];
  let rows: Row[] = [];
  let totals: Row | null = null;

  const bookingCols = (extra: Col[] = []): Col[] => [
    { key: 'start', label: 'Data și ora', type: 'datetime' },
    { key: 'client', label: 'Client', type: 'text' },
    ...(perms.contacts ? [{ key: 'phone', label: 'Telefon', type: 'text' as const }] : []),
    { key: 'barber', label: 'Frizer', type: 'text' },
    { key: 'service', label: 'Serviciu', type: 'text' },
    ...extra,
  ];
  const bookingRow = (b: BRow): Row => ({
    start: localDT(b.starts_at),
    client: b.client_name || 'Fără nume',
    ...(perms.contacts && { phone: b.client_phone }),
    barber: b.barber_name,
    service: b.service_name,
  });

  switch (kind) {
    case 'day': {
      const [bk, subs, firsts] = await Promise.all([loadBookings(env, scope, from, to, filters), loadSubscriptions(env, scope, from, to), firstVisits(env)]);
      const visits = bk.filter((b) => isVisit(b, now));
      const clientsSeen = new Set(visits.map((b) => b.client_id));
      const newClients = [...clientsSeen].filter((id) => (firsts.get(id) ?? '') >= range(from, to).start).length;
      const tips = bk.reduce((n, b) => n + (b.tip_bani ?? 0), 0);
      const cuts = bk.reduce((n, b) => n + collected(b), 0);
      const subsSum = subs.reduce((n, s) => n + s.price_bani, 0);
      columns = [
        { key: 'name', label: 'Indicator', type: 'text' },
        { key: 'value', label: 'Valoare', type: 'text' },
      ];
      const line = (name: string, value: string | number) => ({ name, value: String(value) });
      rows = [
        line('Programări în ziua aleasă', bk.length),
        line('Finalizate', bk.filter((b) => b.status === 'completed').length),
        line('Încă de confirmat', bk.filter((b) => b.status === 'confirmed').length),
        line('Anulate de client', bk.filter((b) => b.status === 'cancelled' && b.cancelled_by === 'client').length),
        line('Anulate de echipă', bk.filter(staffCancelled).length),
        line('Cereri expirate (fără răspuns)', bk.filter(expiredRequest).length),
        line('Neprezentări', bk.filter((b) => b.status === 'no_show').length),
        line('Clienți serviți', clientsSeen.size),
        line('din care clienți noi', newClients),
        line('Tunsori pe abonament', bk.filter((b) => b.payment === 'subscription').length),
        line('Abonamente vândute', subs.filter((s) => s.kind !== 'gift').length),
        line('Carduri cadou vândute', subs.filter((s) => s.kind === 'gift').length),
        line('Plătit cu carduri cadou (lei)', lei(bk.reduce((n, b) => n + (b.gift_bani ?? 0), 0))),
      ];
      if (perms.stats)
        rows.push(
          line('Încasat din servicii (lei)', lei(cuts)),
          line('Încasat din abonamente și carduri cadou (lei)', lei(subsSum)),
          line('Bacșiș (lei)', lei(tips)),
          line('Total încasat, fără bacșiș (lei)', lei(cuts + subsSum)),
        );
      for (const [, list] of group(bk.filter((b) => b.status !== 'cancelled'), (b) => b.barber_name)) {
        const done = list.filter((b) => b.status === 'completed');
        rows.push(line(`${list[0].barber_name}: programări / finalizate`, `${list.length} / ${done.length}${perms.stats ? ` · ${lei(done.reduce((n, b) => n + collected(b), 0))} lei` : ''}`));
      }
      break;
    }

    case 'bookings':
    case 'upcoming': {
      let bk = await loadBookings(env, scope, from, to, filters);
      if (kind === 'upcoming') bk = bk.filter((b) => b.status === 'confirmed' && b.starts_at > now);
      else if (q.status) bk = bk.filter((b) => b.status === q.status);
      if (q.source) bk = bk.filter((b) => b.source === q.source);
      columns = bookingCols([
        { key: 'source', label: 'Făcută din', type: 'text' },
        { key: 'status', label: 'Stare', type: 'text' },
        { key: 'price', label: 'Preț (lei)', type: 'money' },
        ...(kind === 'bookings'
          ? ([
              { key: 'payment', label: 'Plată', type: 'text' },
              { key: 'paid', label: 'Încasat (lei)', type: 'money' },
              { key: 'tip', label: 'Bacșiș (lei)', type: 'money' },
            ] as Col[])
          : []),
      ]);
      rows = bk.map((b) => ({
        ...bookingRow(b),
        source: SOURCE[b.source] ?? b.source,
        status: STATUS[b.status] ?? b.status,
        price: lei(b.price_bani),
        payment: b.payment ? PAYMENT[b.payment] : '',
        paid: b.payment === 'paid' ? lei(b.paid_bani) : null,
        tip: b.tip_bani ? lei(b.tip_bani) : null,
      }));
      totals = sumRows(rows, columns, `Total: ${rows.length} programări`);
      break;
    }

    case 'sales-barber': {
      const [bk, subs] = await Promise.all([loadBookings(env, scope, from, to, filters), loadSubscriptions(env, scope, from, to)]);
      const names = new Map<string, string>();
      bk.forEach((b) => names.set(b.barber_id, b.barber_name));
      subs.forEach((s) => s.admin_barber && names.set(s.admin_barber, s.admin_barber_name ?? ''));
      const subsBy = group(subs, (s) => s.admin_barber ?? `admin:${s.admin_name ?? 'Echipă'}`);
      const bkBy = group(bk, (b) => b.barber_id);
      const keys = new Set([...bkBy.keys(), ...subsBy.keys()]);
      columns = [
        { key: 'member', label: 'Membru echipă', type: 'text' },
        { key: 'services', label: 'Servicii finalizate', type: 'int' },
        { key: 'subCuts', label: 'Din care pe abonament', type: 'int' },
        { key: 'servicesSum', label: 'Încasat servicii (lei)', type: 'money' },
        { key: 'subs', label: 'Abonamente și carduri cadou', type: 'int' },
        { key: 'subsSum', label: 'Încasat abonamente și carduri (lei)', type: 'money' },
        { key: 'tips', label: 'Bacșiș (lei)', type: 'money' },
        { key: 'total', label: 'Total încasat (lei)', type: 'money' },
      ];
      rows = [...keys].map((k) => {
        const done = (bkBy.get(k) ?? []).filter((b) => b.status === 'completed');
        const s = subsBy.get(k) ?? [];
        const servicesSum = done.reduce((n, b) => n + collected(b), 0);
        const subsSum = s.reduce((n, x) => n + x.price_bani, 0);
        return {
          member: names.get(k) ?? `${k.replace(/^admin:/, '')} (cont fără frizer)`,
          services: done.length,
          subCuts: done.filter((b) => b.payment === 'subscription').length,
          servicesSum: lei(servicesSum),
          subs: s.length,
          subsSum: lei(subsSum),
          tips: lei(done.reduce((n, b) => n + (b.tip_bani ?? 0), 0)),
          total: lei(servicesSum + subsSum),
        };
      });
      rows.sort((a, b) => Number(b.total) - Number(a.total) || Number(b.services) - Number(a.services));
      totals = sumRows(rows, columns, 'Total');
      break;
    }

    case 'sales-service': {
      const bk = (await loadBookings(env, scope, from, to, filters)).filter((b) => b.status === 'completed');
      columns = [
        { key: 'service', label: 'Serviciu', type: 'text' },
        { key: 'count', label: 'Finalizate', type: 'int' },
        { key: 'subCuts', label: 'Pe abonament', type: 'int' },
        { key: 'paid', label: 'Încasat (lei)', type: 'money' },
        { key: 'avg', label: 'Medie pe plată (lei)', type: 'money' },
        { key: 'share', label: '% din încasări', type: 'pct' },
      ];
      const all = bk.reduce((n, b) => n + collected(b), 0);
      rows = [...group(bk, (b) => b.service_id).values()].map((list) => {
        const paid = list.filter((b) => b.payment === 'paid');
        const sum = paid.reduce((n, b) => n + collected(b), 0);
        return {
          service: list[0].service_name,
          count: list.length,
          subCuts: list.filter((b) => b.payment === 'subscription').length,
          paid: lei(sum),
          avg: paid.length ? lei(sum / paid.length) : 0,
          share: pct(sum, all),
        };
      });
      rows.sort((a, b) => Number(b.paid) - Number(a.paid) || Number(b.count) - Number(a.count));
      totals = sumRows(rows, columns, 'Total');
      totals.share = all ? 100 : 0;
      break;
    }

    case 'bookings-barber': {
      const bk = await loadBookings(env, scope, from, to, filters);
      columns = [
        { key: 'member', label: 'Membru echipă', type: 'text' },
        { key: 'total', label: 'Rezervări', type: 'int' },
        { key: 'completed', label: 'Finalizate', type: 'int' },
        { key: 'confirmed', label: 'Confirmate (de făcut)', type: 'int' },
        { key: 'cancelled', label: 'Anulate', type: 'int' },
        { key: 'noShow', label: 'Neprezentări', type: 'int' },
        { key: 'fromApp', label: 'Din aplicație / site', type: 'int' },
        { key: 'fromStaff', label: 'Adăugate de echipă', type: 'int' },
        { key: 'value', label: 'Valoare la preț de listă (lei)', type: 'money' },
      ];
      rows = [...group(bk, (b) => b.barber_id).values()].map((list) => ({
        member: list[0].barber_name,
        total: list.length,
        completed: list.filter((b) => b.status === 'completed').length,
        confirmed: list.filter((b) => b.status === 'confirmed').length,
        cancelled: list.filter((b) => b.status === 'cancelled').length,
        noShow: list.filter((b) => b.status === 'no_show').length,
        fromApp: list.filter((b) => b.source !== 'admin').length,
        fromStaff: list.filter((b) => b.source === 'admin').length,
        value: lei(list.filter((b) => b.status !== 'cancelled').reduce((n, b) => n + b.price_bani, 0)),
      }));
      rows.sort((a, b) => Number(b.total) - Number(a.total));
      totals = sumRows(rows, columns, 'Total');
      break;
    }

    case 'cancel-staff':
    case 'cancel-client': {
      const bk = (await loadBookings(env, scope, from, to, filters)).filter(
        (b) => (kind === 'cancel-client' ? b.status === 'cancelled' && b.cancelled_by === 'client' : staffCancelled(b)),
      );
      columns = bookingCols([
        { key: 'cancelledAt', label: 'Anulată la', type: 'datetime' },
        { key: 'hoursBefore', label: 'Cu câte ore înainte', type: 'int' },
        ...(kind === 'cancel-staff' ? [{ key: 'by', label: 'Anulată de', type: 'text' as const }] : []),
        { key: 'price', label: 'Valoare (lei)', type: 'money' },
      ]);
      rows = bk.map((b) => ({
        ...bookingRow(b),
        cancelledAt: b.cancelled_at ? localDT(b.cancelled_at) : '',
        hoursBefore: b.cancelled_at ? Math.max(0, Math.round((Date.parse(b.starts_at) - Date.parse(b.cancelled_at)) / 3_600_000)) : null,
        by: b.canceller_name ?? (b.cancelled_by ? 'Echipă' : 'Necunoscut'),
        price: lei(b.price_bani),
      }));
      totals = sumRows(rows, columns, `Total: ${rows.length} anulări`);
      totals.hoursBefore = null;
      break;
    }

    case 'payments': {
      const [bk, subs] = await Promise.all([loadBookings(env, scope, from, to, filters), loadSubscriptions(env, scope, from, to)]);
      columns = [
        { key: 'date', label: 'Data', type: 'datetime' },
        { key: 'client', label: 'Client', type: 'text' },
        { key: 'what', label: 'Pentru', type: 'text' },
        { key: 'method', label: 'Tip', type: 'text' },
        { key: 'how', label: 'Cum', type: 'text' },
        { key: 'amount', label: 'Sumă (lei)', type: 'money' },
        { key: 'tip', label: 'Bacșiș (lei)', type: 'money' },
        { key: 'by', label: 'Încasat de', type: 'text' },
      ];
      const items = [
        ...bk
          .filter((b) => b.payment)
          .map((b) => ({
            t: b.starts_at,
            row: {
              date: localDT(b.starts_at),
              client: b.client_name || 'Fără nume',
              what: `${b.service_name} · ${b.barber_name}`,
              method: b.payment === 'paid' ? (b.gift_bani ? 'Plată serviciu (și card cadou)' : 'Plată serviciu') : 'Tunsoare din abonament',
              how: b.pay_method ? METHOD[b.pay_method] ?? b.pay_method : '',
              amount: lei(collected(b)),
              tip: b.tip_bani ? lei(b.tip_bani) : null,
              by: b.completer_name ?? '',
            },
          })),
        ...subs.map((s) => ({
          t: s.created_at,
          row: { date: localDT(s.created_at), client: s.client_name || 'Fără nume', what: s.name, method: s.kind === 'gift' ? 'Card cadou vândut' : 'Abonament vândut', how: s.pay_method ? METHOD[s.pay_method] ?? s.pay_method : '', amount: lei(s.price_bani), tip: null, by: s.admin_name ?? '' },
        })),
      ];
      items.sort((a, b) => a.t.localeCompare(b.t));
      rows = items.map((i) => i.row);
      totals = sumRows(rows, columns, `Total: ${rows.length} plăți`);
      break;
    }

    case 'payments-member': {
      const [bk, subs] = await Promise.all([loadBookings(env, scope, from, to, filters), loadSubscriptions(env, scope, from, to)]);
      const paid = bk.filter((b) => b.payment);
      const keys = new Set([...paid.map((b) => b.completer_name ?? 'Necunoscut'), ...subs.map((s) => s.admin_name ?? 'Necunoscut')]);
      columns = [
        { key: 'member', label: 'Cont echipă', type: 'text' },
        { key: 'count', label: 'Plăți servicii', type: 'int' },
        { key: 'servicesSum', label: 'Sumă servicii (lei)', type: 'money' },
        { key: 'subs', label: 'Abonamente și carduri cadou', type: 'int' },
        { key: 'subsSum', label: 'Sumă abonamente și carduri (lei)', type: 'money' },
        { key: 'tips', label: 'Bacșiș (lei)', type: 'money' },
        { key: 'total', label: 'Total încasat (lei)', type: 'money' },
      ];
      rows = [...keys].map((k) => {
        const p = paid.filter((b) => (b.completer_name ?? 'Necunoscut') === k);
        const s = subs.filter((x) => (x.admin_name ?? 'Necunoscut') === k);
        const a = p.reduce((n, b) => n + collected(b), 0);
        const ss = s.reduce((n, x) => n + x.price_bani, 0);
        return { member: k, count: p.length, servicesSum: lei(a), subs: s.length, subsSum: lei(ss), tips: lei(p.reduce((n, b) => n + (b.tip_bani ?? 0), 0)), total: lei(a + ss) };
      });
      rows.sort((a, b) => Number(b.total) - Number(a.total));
      totals = sumRows(rows, columns, 'Total');
      break;
    }

    case 'tips-member': {
      const bk = (await loadBookings(env, scope, from, to, filters)).filter((b) => b.status === 'completed');
      columns = [
        { key: 'member', label: 'Membru echipă', type: 'text' },
        { key: 'services', label: 'Servicii finalizate', type: 'int' },
        { key: 'withTip', label: 'Cu bacșiș', type: 'int' },
        { key: 'share', label: '% cu bacșiș', type: 'pct' },
        { key: 'tips', label: 'Bacșiș total (lei)', type: 'money' },
        { key: 'avg', label: 'Bacșiș mediu (lei)', type: 'money' },
      ];
      rows = [...group(bk, (b) => b.barber_id).values()].map((list) => {
        const w = list.filter((b) => (b.tip_bani ?? 0) > 0);
        const sum = w.reduce((n, b) => n + (b.tip_bani ?? 0), 0);
        return { member: list[0].barber_name, services: list.length, withTip: w.length, share: pct(w.length, list.length), tips: lei(sum), avg: w.length ? lei(sum / w.length) : 0 };
      });
      rows.sort((a, b) => Number(b.tips) - Number(a.tips));
      totals = sumRows(rows, columns, 'Total');
      totals.share = pct(Number(totals.withTip), Number(totals.services));
      totals.avg = Number(totals.withTip) ? Math.round((Number(totals.tips) / Number(totals.withTip)) * 100) / 100 : 0;
      break;
    }

    case 'top100': {
      const [bk, subs] = await Promise.all([loadBookings(env, scope, from, to, filters), loadSubscriptions(env, scope, from, to)]);
      const visits = bk.filter((b) => isVisit(b, now));
      const by = new Map<string, { name: string; phone: string; email: string | null; visits: number; spent: number; last: string; cancelled: number; noShow: number }>();
      const get = (id: string, name: string, phone = '', email: string | null = null) => {
        let x = by.get(id);
        if (!x) by.set(id, (x = { name, phone, email, visits: 0, spent: 0, last: '', cancelled: 0, noShow: 0 }));
        if (phone) x.phone = phone;
        return x;
      };
      for (const b of bk) {
        const x = get(b.client_id, b.client_name, b.client_phone, b.client_email);
        if (b.status === 'cancelled') x.cancelled++;
        if (b.status === 'no_show') x.noShow++;
      }
      for (const b of visits) {
        const x = get(b.client_id, b.client_name);
        x.visits++;
        x.spent += collected(b);
        if (b.starts_at > x.last) x.last = b.starts_at;
      }
      for (const s of subs) if (!s.client_id.startsWith('gift:')) get(s.client_id, s.client_name).spent += s.price_bani;
      columns = [
        { key: 'rank', label: 'Loc', type: 'int' },
        { key: 'client', label: 'Client', type: 'text' },
        ...(perms.contacts
          ? ([
              { key: 'phone', label: 'Telefon', type: 'text' },
              { key: 'email', label: 'E-mail', type: 'text' },
            ] as Col[])
          : []),
        { key: 'visits', label: 'Vizite', type: 'int' },
        { key: 'spent', label: 'Cheltuit (lei)', type: 'money' },
        { key: 'avg', label: 'Medie pe vizită (lei)', type: 'money' },
        { key: 'last', label: 'Ultima vizită', type: 'date' },
        { key: 'cancelled', label: 'Anulări', type: 'int' },
        { key: 'noShow', label: 'Neprezentări', type: 'int' },
      ];
      const list = [...by.values()].filter((x) => x.visits > 0 || x.spent > 0);
      list.sort((a, b) => (perms.stats ? b.spent - a.spent : 0) || b.visits - a.visits || b.last.localeCompare(a.last));
      rows = list.slice(0, 100).map((x, i) => ({
        rank: i + 1,
        client: x.name || 'Fără nume',
        ...(perms.contacts && { phone: x.phone, email: x.email ?? '' }),
        visits: x.visits,
        spent: lei(x.spent),
        avg: x.visits ? lei(x.spent / x.visits) : 0,
        last: x.last ? dayKey(x.last) : '',
        cancelled: x.cancelled,
        noShow: x.noShow,
      }));
      break;
    }

    case 'retention': {
      // Pe luni: câți clienți au venit, câți erau noi, și câți dintre ei au mai venit o dată în următoarele 60 de zile.
      const fromMonth = from.slice(0, 7) + '-01';
      const [bk, firsts] = await Promise.all([loadBookings(env, scope, fromMonth, addDays(to, 60)), firstVisits(env)]);
      const visits = bk.filter((b) => isVisit(b, now));
      const byClient = group(visits, (b) => b.client_id);
      columns = [
        { key: 'month', label: 'Luna', type: 'text' },
        { key: 'clients', label: 'Clienți', type: 'int' },
        { key: 'new', label: 'Noi', type: 'int' },
        { key: 'returning', label: 'Reveniți', type: 'int' },
        { key: 'cameBack', label: 'Au revenit în 60 de zile', type: 'int' },
        { key: 'rate', label: 'Rata de revenire', type: 'pct' },
      ];
      for (let m = fromMonth; m <= to; m = nextMonth(m)) {
        const mEnd = nextMonth(m);
        const { start, end } = range(m, addDays(mEnd, -1));
        const inMonth = group(
          visits.filter((b) => b.starts_at >= start && b.starts_at < end),
          (b) => b.client_id,
        );
        let fresh = 0;
        let back = 0;
        for (const [cid, list] of inMonth) {
          if ((firsts.get(cid) ?? '') >= start) fresh++;
          const last = list[list.length - 1].starts_at;
          const limit = iso(new Date(Date.parse(last) + 60 * 86_400_000));
          if ((byClient.get(cid) ?? []).some((b) => b.starts_at > last && b.starts_at <= limit && dayKey(b.starts_at) !== dayKey(last))) back++;
        }
        rows.push({
          month: m.slice(0, 7),
          clients: inMonth.size,
          new: fresh,
          returning: inMonth.size - fresh,
          cameBack: back,
          // Pentru lunile recente rata poate încă să crească: nu au trecut 60 de zile pentru toți.
          rate: pct(back, inMonth.size),
        });
      }
      break;
    }

    case 'new-returning': {
      const [bk, firsts] = await Promise.all([loadBookings(env, scope, from, to, filters), firstVisits(env)]);
      const visits = bk.filter((b) => isVisit(b, now));
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
      const bucket = (day: string) => (days > 92 ? day.slice(0, 7) : day);
      columns = [
        { key: 'period', label: days > 92 ? 'Luna' : 'Ziua', type: 'text' },
        { key: 'new', label: 'Clienți noi', type: 'int' },
        { key: 'returning', label: 'Clienți care revin', type: 'int' },
        { key: 'total', label: 'Total clienți', type: 'int' },
        { key: 'share', label: '% noi', type: 'pct' },
      ];
      const seen = new Map<string, { n: Set<string>; r: Set<string> }>();
      for (const b of visits) {
        const k = bucket(b.day);
        let x = seen.get(k);
        if (!x) seen.set(k, (x = { n: new Set(), r: new Set() }));
        const first = firsts.get(b.client_id);
        if (first && dayKey(first) === b.day) x.n.add(b.client_id);
        else x.r.add(b.client_id);
      }
      rows = [...seen.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => ({ period: k, new: x.n.size, returning: x.r.size, total: x.n.size + x.r.size, share: pct(x.n.size, x.n.size + x.r.size) }));
      totals = sumRows(rows, columns, 'Total');
      totals.share = pct(Number(totals.new), Number(totals.total));
      break;
    }

    case 'online-payments': {
      // Plățile online cu cardul (Stripe), pe ziua plății: păstrate, returnate pe card sau de returnat de mână.
      const { start, end } = range(from, to);
      const own = scope.barberId ? `AND p.kind = 'booking' AND b.barber_id = ?` : '';
      const r = await env.DB.prepare(
        `SELECT p.kind, p.ref, p.amount_bani, p.status, p.note, p.created_at, p.payment_intent, p.session_id, c.name AS client_name, s.name AS service_name, sb.name AS sub_name
         FROM online_payments p LEFT JOIN clients c ON c.id = p.client_id
         LEFT JOIN bookings b ON p.kind = 'booking' AND b.id = p.ref LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN subscriptions sb ON p.kind = 'sub' AND sb.id = p.ref
         WHERE p.created_at >= ? AND p.created_at < ? ${own} ORDER BY p.created_at LIMIT 30000`,
      )
        .bind(...(scope.barberId ? [start, end, scope.barberId] : [start, end]))
        .all<{ kind: string; ref: string; amount_bani: number; status: string; note: string; created_at: string; payment_intent: string | null; session_id: string; client_name: string | null; service_name: string | null; sub_name: string | null }>();
      const KIND: Record<string, string> = { booking: 'Programare', order: 'Comandă magazin', gift: 'Card cadou', sub: 'Abonament' };
      const ST: Record<string, string> = { paid: 'Plătită', refunded: 'Returnată', to_refund: 'De returnat' };
      columns = [
        { key: 'date', label: 'Data', type: 'datetime' },
        { key: 'client', label: 'Client', type: 'text' },
        { key: 'kind', label: 'Tip', type: 'text' },
        { key: 'what', label: 'Pentru', type: 'text' },
        { key: 'state', label: 'Stare', type: 'text' },
        { key: 'note', label: 'Motiv', type: 'text' },
        { key: 'paid', label: 'Încasat (lei)', type: 'money' },
        { key: 'refunded', label: 'Returnat (lei)', type: 'money' },
        { key: 'toRefund', label: 'De returnat (lei)', type: 'money' },
        { key: 'ref', label: 'Referință Stripe', type: 'text' },
      ];
      rows = r.results.map((p) => ({
        date: localDT(p.created_at),
        client: p.client_name || 'Fără nume',
        kind: KIND[p.kind] ?? p.kind,
        what: p.kind === 'booking' ? (p.service_name ?? '') : p.kind === 'order' ? `Comanda ${p.ref.slice(-5).toUpperCase()}` : p.kind === 'sub' ? (p.sub_name ?? '') : '',
        state: ST[p.status] ?? p.status,
        note: p.note,
        paid: p.status === 'paid' ? lei(p.amount_bani) : null,
        refunded: p.status === 'refunded' ? lei(p.amount_bani) : null,
        toRefund: p.status === 'to_refund' ? lei(p.amount_bani) : null,
        ref: p.payment_intent ?? p.session_id,
      }));
      totals = sumRows(rows, columns, `Total: ${rows.length} plăți`);
      break;
    }

    case 'register': {
      // Registrul de încasări: fiecare programare din zi (sau perioadă) cu felul în care s-a închis și cum s-a plătit.
      const [bk, subs] = await Promise.all([loadBookings(env, scope, from, to, filters), loadSubscriptions(env, scope, from, to)]);
      columns = [
        { key: 'date', label: 'Data și ora', type: 'datetime' },
        { key: 'client', label: 'Client', type: 'text' },
        { key: 'barber', label: 'Frizer', type: 'text' },
        { key: 'what', label: 'Serviciu / vânzare', type: 'text' },
        { key: 'state', label: 'Cum s-a închis', type: 'text' },
        { key: 'cash', label: 'Numerar (lei)', type: 'money' },
        { key: 'card', label: 'Card POS (lei)', type: 'money' },
        { key: 'other', label: 'Transfer / online (lei)', type: 'money' },
        { key: 'gift', label: 'Din card cadou (lei)', type: 'money' },
        { key: 'tip', label: 'Bacșiș (lei)', type: 'money' },
      ];
      const split = (method: string | null, bani: number) => ({
        cash: method === 'cash' || (!method && bani) ? lei(bani) : null,
        card: method === 'card' ? lei(bani) : null,
        other: method === 'transfer' || method === 'online' ? lei(bani) : null,
      });
      const stateOf = (b: BRow) =>
        b.status === 'completed'
          ? b.payment === 'subscription'
            ? 'Încheiată · din abonament'
            : b.pay_method === 'app'
              ? 'Încheiată · așteaptă plata în aplicație'
              : 'Încheiată · plătită'
          : b.status === 'no_show'
            ? 'Nu a venit'
            : b.status === 'cancelled'
              ? b.cancelled_by === 'client'
                ? 'Anulată de client'
                : expiredRequest(b)
                  ? 'Cerere expirată'
                  : 'Anulată de salon'
              : b.ends_at < now
                ? 'NEÎNCHISĂ'
                : 'Urmează';
      const items = [
        ...bk.map((b) => ({
          t: b.starts_at,
          row: {
            date: localDT(b.starts_at),
            client: b.client_name || 'Fără nume',
            barber: b.barber_name,
            what: b.service_name,
            state: stateOf(b),
            ...split(b.pay_method, collected(b)),
            gift: b.gift_bani ? lei(b.gift_bani) : null,
            tip: b.tip_bani ? lei(b.tip_bani) : null,
          } as Row,
        })),
        ...subs.map((x) => ({
          t: x.created_at,
          row: {
            date: localDT(x.created_at),
            client: x.client_name || 'Fără nume',
            barber: x.admin_barber_name ?? x.admin_name ?? '',
            what: x.kind === 'gift' ? x.name : `Abonament: ${x.name}`,
            state: 'Vândut',
            ...split(x.pay_method ?? 'cash', x.price_bani),
            gift: null,
            tip: null,
          } as Row,
        })),
      ];
      items.sort((a, b) => a.t.localeCompare(b.t));
      rows = items.map((i) => i.row);
      const open = rows.filter((r) => r.state === 'NEÎNCHISĂ').length;
      totals = sumRows(rows, columns, open ? `Total · ${open} neînchise` : `Total: ${rows.length}`);
      break;
    }

    case 'stock': {
      const r = await env.DB.prepare(
        `SELECT name, unit, stock, cost_bani, price_bani, for_sale, active FROM products WHERE stock IS NOT NULL ORDER BY active DESC, name`,
      ).all<{ name: string; unit: string; stock: number; cost_bani: number | null; price_bani: number; for_sale: number; active: number }>();
      columns = [
        { key: 'name', label: 'Produs', type: 'text' },
        { key: 'kind', label: 'Tip', type: 'text' },
        { key: 'unit', label: 'U.M.', type: 'text' },
        { key: 'stock', label: 'Stoc', type: 'int' },
        { key: 'cost', label: 'Preț achiziție (lei)', type: 'money' },
        { key: 'value', label: 'Valoare la achiziție (lei)', type: 'money' },
        { key: 'price', label: 'Preț vânzare (lei)', type: 'money' },
        { key: 'saleValue', label: 'Valoare la vânzare (lei)', type: 'money' },
      ];
      rows = r.results.map((p) => ({
        name: p.name + (p.active ? '' : ' (ascuns)'),
        kind: p.for_sale ? 'De vânzare' : 'Pentru salon',
        unit: p.unit,
        stock: p.stock,
        cost: p.cost_bani === null ? null : lei(p.cost_bani),
        value: p.cost_bani === null ? null : lei(p.cost_bani * p.stock),
        price: p.for_sale ? lei(p.price_bani) : null,
        saleValue: p.for_sale ? lei(p.price_bani * p.stock) : null,
      }));
      totals = sumRows(rows, columns, `Total: ${rows.length} produse`);
      totals.cost = null;
      totals.price = null;
      break;
    }

    case 'stock-moves': {
      const { start, end } = range(from, to);
      const moves = await listMoves(env, { productId: q.productId || undefined, start, end });
      columns = [
        { key: 'date', label: 'Data', type: 'datetime' },
        { key: 'product', label: 'Produs', type: 'text' },
        { key: 'kind', label: 'Tip mișcare', type: 'text' },
        { key: 'doc', label: 'Document', type: 'text' },
        { key: 'in', label: 'Intrare', type: 'int' },
        { key: 'out', label: 'Ieșire', type: 'int' },
        { key: 'value', label: 'Valoare la achiziție (lei)', type: 'money' },
        { key: 'note', label: 'Observații', type: 'text' },
        { key: 'by', label: 'Operat de', type: 'text' },
      ];
      rows = moves.map((m) => ({
        date: localDT(m.created_at),
        product: `${m.product_name} (${m.unit})`,
        kind: MOVE_LABELS[m.kind] ?? m.kind,
        doc: m.nir_number ? `NIR ${m.nir_number}` : m.order_id ? `Comanda ${m.order_id.slice(-5).toUpperCase()}` : '',
        in: m.qty > 0 ? m.qty : null,
        out: m.qty < 0 ? -m.qty : null,
        value: m.unit_cost_bani === null ? null : lei(Math.abs(m.qty) * m.unit_cost_bani),
        note: m.note,
        by: m.created_by_name ?? (m.kind.startsWith('vanzare') ? 'Aplicație' : ''),
      }));
      totals = sumRows(rows, columns, `Total: ${rows.length} mișcări`);
      totals.value = null;
      break;
    }
  }

  // Fără dreptul „Încasări”, coloanele cu bani nu pleacă de pe server.
  // Excepție: în registrul lui, frizerul își vede încasările (le-a încasat chiar el).
  if (!perms.stats && !(kind === 'register' && scope.barberId)) {
    const money = new Set(columns.filter((c) => c.type === 'money' || (c.key === 'share' && kind === 'sales-service')).map((c) => c.key));
    columns = columns.filter((c) => !money.has(c.key));
    const keep = new Set(columns.map((c) => c.key));
    const strip = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k)));
    rows = rows.map(strip);
    if (totals) totals = strip(totals);
  }
  return { ...base, columns, rows, totals };
}

function nextMonth(day: string) {
  const [y, m] = day.split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
}

export function reportCells(r: Report): Cell[][] {
  const out: Cell[][] = [r.columns.map((c) => c.label)];
  const val = (c: Col, v: unknown): Cell => (v === null || v === undefined ? null : c.type === 'int' || c.type === 'money' || c.type === 'pct' ? Number(v) : String(v));
  for (const row of r.rows) out.push(r.columns.map((c) => val(c, row[c.key])));
  if (r.totals) out.push(r.columns.map((c) => val(c, r.totals![c.key])));
  return out;
}

// --- Tabloul de bord ---

export async function buildDashboard(env: Env, scope: Scope) {
  const perms = scope.session.perms;
  const nowD = new Date();
  const now = iso(nowD);
  const today = dayKey(nowD);
  const yearAgo = addDays(today, -364);
  const [bk, subs, firsts] = await Promise.all([
    loadBookings(env, scope, yearAgo, addDays(today, 1)),
    loadSubscriptions(env, scope, yearAgo, today),
    firstVisits(env),
  ]);
  const dayOf = (t: string) => dayKey(t);
  const firstDay = new Map([...firsts].map(([k, v]) => [k, dayKey(v)]));
  const visits = bk.filter((b) => isVisit(b, now));
  const money = (n: number) => (perms.stats ? lei(n) : null);
  const isNewVisit = (b: BRow) => {
    return firstDay.get(b.client_id) === b.day;
  };

  // Pe zile, ultimele 30.
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i);
    const list = bk.filter((b) => b.day === d);
    const v = list.filter((b) => isVisit(b, now));
    const s = subs.filter((x) => x.day === d);
    daily.push({
      day: d,
      bookings: list.filter((b) => b.status !== 'cancelled').length,
      revenue: money(list.reduce((n, b) => n + collected(b), 0) + s.reduce((n, x) => n + x.price_bani, 0)),
      newClients: new Set(v.filter(isNewVisit).map((b) => b.client_id)).size,
      returning: new Set(v.filter((b) => !isNewVisit(b)).map((b) => b.client_id)).size,
    });
  }

  // Pe luni, ultimele 12.
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const [y, m] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = dt.toISOString().slice(0, 7);
    const list = bk.filter((b) => b.day.startsWith(key));
    const s = subs.filter((x) => x.day.startsWith(key));
    monthly.push({
      month: key,
      bookings: list.filter((b) => b.status !== 'cancelled').length,
      revenue: money(list.reduce((n, b) => n + collected(b), 0) + s.reduce((n, x) => n + x.price_bani, 0)),
    });
  }

  // Ultimele 7 zile față de cele 7 dinainte.
  const week = (fromDay: string, toDay: string) => {
    const list = bk.filter((b) => {
      const d = b.day;
      return d >= fromDay && d <= toDay;
    });
    const v = list.filter((b) => isVisit(b, now));
    const s = subs.filter((x) => {
      const d = x.day;
      return d >= fromDay && d <= toDay;
    });
    return {
      bookings: list.filter((b) => b.status !== 'cancelled').length,
      revenue: money(list.reduce((n, b) => n + collected(b), 0) + s.reduce((n, x) => n + x.price_bani, 0)),
      clients: new Set(v.map((b) => b.client_id)).size,
      newClients: new Set(v.filter(isNewVisit).map((b) => b.client_id)).size,
      cancelled: list.filter((b) => b.status === 'cancelled').length,
      noShow: list.filter((b) => b.status === 'no_show').length,
    };
  };

  // Păstrare: dintre clienții veniți în cele 330 de zile dinainte, câți au revenit în ultimele 30.
  const d30 = addDays(today, -29);
  const recent = new Set(visits.filter((b) => b.day >= d30).map((b) => b.client_id));
  const before = new Set(visits.filter((b) => b.day < d30).map((b) => b.client_id));
  const returned = [...before].filter((id) => recent.has(id)).length;
  const last30 = visits.filter((b) => b.day >= d30);

  // Clienții de azi, cu etichete: nou, client de top, la ziua lui (din calendar), revine după mult timp.
  const spent = new Map<string, number>();
  for (const b of visits) spent.set(b.client_id, (spent.get(b.client_id) ?? 0) + collected(b));
  for (const s of subs) if (!s.client_id.startsWith('gift:')) spent.set(s.client_id, (spent.get(s.client_id) ?? 0) + s.price_bani);
  const visitCount = new Map<string, number>();
  for (const b of visits) visitCount.set(b.client_id, (visitCount.get(b.client_id) ?? 0) + 1);
  const ranked = [...spent.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const topSet = new Set(ranked.slice(0, Math.max(10, Math.ceil(ranked.length * 0.1))).map(([id]) => id));
  const lastBefore = (cid: string, t: string) => {
    let last = '';
    for (const b of visits) if (b.client_id === cid && b.starts_at < t && b.day !== dayOf(t) && b.starts_at > last) last = b.starts_at;
    return last;
  };
  // „În situație de risc” (cum cere florin): a lipsit fără să anunțe sau a anulat de mai multe ori.
  const misses = new Map<string, { noShow: number; cancelled: number }>();
  for (const b of bk) {
    if (b.starts_at > now || (b.status !== 'no_show' && !(b.status === 'cancelled' && b.cancelled_by === 'client'))) continue;
    const m = misses.get(b.client_id) ?? { noShow: 0, cancelled: 0 };
    if (b.status === 'no_show') m.noShow++;
    else m.cancelled++;
    misses.set(b.client_id, m);
  }
  const m0 = (id: string) => misses.get(id) ?? { noShow: 0, cancelled: 0 };
  const todayList = bk
    .filter((b) => b.day === today && b.status !== 'cancelled')
    .map((b) => {
      const f = firstDay.get(b.client_id);
      const prev = lastBefore(b.client_id, b.starts_at);
      const tags: string[] = [];
      if (!f || f === today) tags.push('new');
      if (topSet.has(b.client_id)) tags.push('top');
      if (prev && Date.parse(b.starts_at) - Date.parse(prev) > 60 * 86_400_000) tags.push('back');
      const m = misses.get(b.client_id);
      if (m && (m.noShow >= 1 || m.cancelled >= 2)) tags.push('risk');
      return {
        bookingId: b.id,
        clientId: b.client_id,
        name: b.client_name || 'Fără nume',
        start: b.starts_at,
        status: b.status,
        barberName: b.barber_name,
        serviceName: b.service_name,
        visits: visitCount.get(b.client_id) ?? 0,
        noShows: m0(b.client_id).noShow,
        cancellations: m0(b.client_id).cancelled,
        tags,
      };
    });

  // Clienți în pericol: au venit de cel puțin 2 ori, nu au programare viitoare
  // și nu au mai venit de peste dublul ritmului lor obișnuit (minim 35 de zile).
  const upcomingClients = new Set(bk.filter((b) => b.status === 'confirmed' && b.starts_at > now).map((b) => b.client_id));
  const atRisk = perms.clients
    ? [...group(visits, (b) => b.client_id).entries()]
        .filter(([cid, list]) => list.length >= 2 && !upcomingClients.has(cid))
        .map(([cid, list]) => {
          const first = Date.parse(list[0].starts_at);
          const last = Date.parse(list[list.length - 1].starts_at);
          const gap = (last - first) / (list.length - 1) / 86_400_000;
          const since = (nowD.getTime() - last) / 86_400_000;
          return { clientId: cid, name: list[0].client_name || 'Fără nume', visits: list.length, lastVisit: list[list.length - 1].day, avgGapDays: Math.round(gap), daysSince: Math.round(since), spent: money(spent.get(cid) ?? 0) };
        })
        .filter((x) => x.daysSince > Math.max(35, x.avgGapDays * 2))
        .sort((a, b) => b.visits - a.visits || a.daysSince - b.daysSince)
        .slice(0, 15)
    : [];

  const topClients = perms.clients
    ? (perms.stats ? ranked.map(([id]) => id) : [...visitCount.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)).slice(0, 10).map((id) => ({
        clientId: id,
        name: visits.find((b) => b.client_id === id)?.client_name || subs.find((s) => s.client_id === id)?.client_name || 'Fără nume',
        visits: visitCount.get(id) ?? 0,
        spent: money(spent.get(id) ?? 0),
      }))
    : [];

  return {
    today,
    canSeeMoney: perms.stats,
    upcoming: bk.filter((b) => b.status === 'confirmed' && b.starts_at > now).length,
    daily,
    monthly,
    week: { current: week(addDays(today, -6), today), previous: week(addDays(today, -13), addDays(today, -7)) },
    last30: {
      clients: new Set(last30.map((b) => b.client_id)).size,
      newClients: new Set(last30.filter(isNewVisit).map((b) => b.client_id)).size,
      returning: new Set(last30.filter((b) => !isNewVisit(b)).map((b) => b.client_id)).size,
    },
    retention: { base: before.size, returned, rate: pct(returned, before.size) },
    todayClients: todayList,
    atRisk,
    topClients,
  };
}
