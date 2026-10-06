import { useState } from 'react';
import { api, type Me } from '../api';
import { Loading, useLoad } from '../ui';
import { lei, longDate, time } from '../util';

type Week = { bookings: number; revenue: number | null; clients: number; newClients: number; cancelled: number; noShow: number };
export type Dashboard = {
  today: string;
  canSeeMoney: boolean;
  upcoming: number;
  daily: Array<{ day: string; bookings: number; revenue: number | null; newClients: number; returning: number }>;
  monthly: Array<{ month: string; bookings: number; revenue: number | null }>;
  week: { current: Week; previous: Week };
  last30: { clients: number; newClients: number; returning: number };
  retention: { base: number; returned: number; rate: number };
  todayClients: Array<{ bookingId: string; name: string; start: string; status: string; barberName: string; serviceName: string; visits: number; noShows: number; cancellations: number; tags: string[] }>;
  atRisk: Array<{ clientId: string; name: string; visits: number; lastVisit: string; avgGapDays: number; daysSince: number; spent: number | null }>;
  topClients: Array<{ clientId: string; name: string; visits: number; spent: number | null }>;
};

const MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const shortDay = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
export const TAGS: Record<string, string> = { new: 'Client nou', top: 'Client de top', back: 'Revine după mult timp', risk: 'În situație de risc' };

export function DashboardPage({ me }: { me: Me }) {
  const d = useLoad(() => api<Dashboard>('GET', '/admin/dashboard'));
  const [metric, setMetric] = useState<'revenue' | 'bookings'>('revenue');
  if (!d.data) return <Loading error={d.error} />;
  const x = d.data;
  const m = x.canSeeMoney ? metric : 'bookings';
  const { current: cur, previous: prev } = x.week;

  return (
    <>
      <div className="head">
        <h1>Tablou de bord</h1>
        <a className="btn ghost sm" href="#/reports">
          Rapoarte și export Excel
        </a>
      </div>
      {!me.permissions.bookings_all ? <p className="muted small" style={{ marginTop: -8 }}>Vezi doar cifrele tale.</p> : null}

      <h2>Ultimele 7 zile, față de cele 7 dinainte</h2>
      <div className="grid stats">
        <Kpi l="programări" v={cur.bookings} p={prev.bookings} />
        {cur.revenue !== null ? <Kpi l="încasări" v={cur.revenue} p={prev.revenue ?? 0} money /> : null}
        <Kpi l="clienți serviți" v={cur.clients} p={prev.clients} />
        <Kpi l="clienți noi" v={cur.newClients} p={prev.newClients} />
        <Kpi l="anulări și neprezentări" v={cur.cancelled + cur.noShow} p={prev.cancelled + prev.noShow} inverse />
        <div className="card stat">
          <div className="v">{x.upcoming}</div>
          <div className="l">programări viitoare</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Ultimele 30 de zile</h2>
          {x.canSeeMoney ? (
            <div className="tabs" style={{ margin: 0 }}>
              <button className={m === 'revenue' ? 'on sm' : 'sm'} onClick={() => setMetric('revenue')}>
                Încasări
              </button>
              <button className={m === 'bookings' ? 'on sm' : 'sm'} onClick={() => setMetric('bookings')}>
                Programări
              </button>
            </div>
          ) : null}
        </div>
        <Bars data={x.daily.map((r) => ({ label: shortDay(r.day), value: (m === 'revenue' ? r.revenue : r.bookings) ?? 0 }))} money={m === 'revenue'} every={5} />
      </div>

      <div className="grid two" style={{ marginBottom: 18 }}>
        <div className="card">
          <h2>Ultimele 12 luni</h2>
          <Bars data={x.monthly.map((r) => ({ label: monthName(r.month), value: (m === 'revenue' ? r.revenue : r.bookings) ?? 0 }))} money={m === 'revenue'} every={1} />
        </div>
        <div className="card">
          <h2>Clienți noi și clienți care revin</h2>
          <Bars
            data={x.daily.map((r) => ({ label: shortDay(r.day), value: r.returning, value2: r.newClients }))}
            every={5}
            legend={['revin', 'noi']}
          />
          <p className="muted small" style={{ marginBottom: 0 }}>
            În ultimele 30 de zile: <b>{x.last30.clients}</b> clienți, dintre care <b>{x.last30.newClients}</b> noi și <b>{x.last30.returning}</b> care au mai fost.
          </p>
        </div>
      </div>

      <div className="grid stats">
        <div className="card stat">
          <div className="v">{x.retention.rate}%</div>
          <div className="l">
            păstrarea clienților: {x.retention.returned} din {x.retention.base} clienți din anul trecut au revenit în ultimele 30 de zile
          </div>
        </div>
        <div className="card stat">
          <div className="v">{x.last30.clients ? Math.round((x.last30.newClients / x.last30.clients) * 100) : 0}%</div>
          <div className="l">clienți noi din total, ultimele 30 de zile</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Clienții de azi ({x.todayClients.length})</h2>
        {x.todayClients.length === 0 ? <p className="muted">Nicio programare azi.</p> : null}
        <div className="table-wrap">
          <table>
            <tbody>
              {x.todayClients.map((c) => (
                <tr key={c.bookingId}>
                  <td style={{ width: 70 }}>{time(c.start)}</td>
                  <td>
                    <b>{c.name}</b> <span className="muted small">· {c.tags.includes('new') ? 'prima vizită' : c.visits === 1 ? 'o vizită' : `${c.visits} vizite`}</span>
                    {c.noShows || c.cancellations ? (
                      <div className="muted small">
                        {c.noShows} neprezentări · {c.cancellations} anulări în ultimul an
                      </div>
                    ) : null}
                    <div className="row" style={{ gap: 4, marginTop: 4 }}>
                      {c.tags.map((t) => (
                        <span key={t} className={`pill tag-${t}`}>
                          {TAGS[t]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="muted small">
                    {c.serviceName}
                    <br />
                    {c.barberName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {me.permissions.clients ? (
        <div className="grid two">
          <div className="card">
            <h2>Clienți care nu mai vin</h2>
            <p className="muted small" style={{ marginTop: -6 }}>
              Veneau regulat, dar nu au mai venit de mult și nu au nicio programare. Merită un mesaj sau o ofertă.
            </p>
            {x.atRisk.length === 0 ? <p className="muted">Niciunul acum.</p> : null}
            <table>
              <tbody>
                {x.atRisk.map((c) => (
                  <tr key={c.clientId}>
                    <td>
                      <b>{c.name}</b>
                      <div className="muted small">
                        {c.visits} vizite, de obicei la {c.avgGapDays} zile · ultima: {longDate(c.lastVisit + 'T12:00:00Z')}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span className="pill cancelled">{c.daysSince} zile</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h2>Top clienți, ultimul an</h2>
            {x.topClients.length === 0 ? <p className="muted">Încă nu sunt date.</p> : null}
            <table>
              <tbody>
                {x.topClients.map((c, i) => (
                  <tr key={c.clientId}>
                    <td style={{ width: 30 }} className="muted">
                      {i + 1}
                    </td>
                    <td>
                      <b>{c.name}</b>
                    </td>
                    <td className="muted small">{c.visits} vizite</td>
                    <td style={{ textAlign: 'right' }}>{c.spent !== null ? lei(c.spent) : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Kpi({ l, v, p, money, inverse }: { l: string; v: number; p: number; money?: boolean; inverse?: boolean }) {
  const diff = p ? Math.round(((v - p) / p) * 100) : v ? 100 : 0;
  const good = inverse ? diff < 0 : diff > 0;
  return (
    <div className="card stat">
      <div className="v">{money ? lei(v) : v}</div>
      <div className="l">
        {l}{' '}
        {diff !== 0 ? (
          <span className={good ? 'success' : 'danger'} style={{ fontWeight: 700 }}>
            {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}%
          </span>
        ) : (
          <span className="muted">= la fel</span>
        )}
        <div className="muted small">înainte: {money ? lei(p) : p}</div>
      </div>
    </div>
  );
}

/** Grafic simplu cu bare; `value2` se pune deasupra lui `value` (ex. clienți noi peste cei care revin). */
export function Bars({
  data,
  money,
  every,
  legend,
}: {
  data: Array<{ label: string; value: number; value2?: number }>;
  money?: boolean;
  every: number;
  legend?: [string, string];
}) {
  const max = Math.max(1, ...data.map((d) => d.value + (d.value2 ?? 0)));
  const fmt = (n: number) => (money ? lei(n) : String(n));
  return (
    <div>
      <div className="bars">
        <div className="bars-max muted small">{fmt(max)}</div>
        {data.map((d, i) => (
          <div key={i} className="bar" title={`${d.label}: ${legend ? `${d.value2 ?? 0} ${legend[1]}, ${d.value} ${legend[0]}` : fmt(d.value)}`}>
            {d.value2 ? <div className="bar-fill alt" style={{ height: `${(d.value2 / max) * 100}%` }} /> : null}
            <div className="bar-fill" style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="bars-labels">
        {data.map((d, i) => (
          <span key={i}>{i % every === 0 || i === data.length - 1 ? d.label : ''}</span>
        ))}
      </div>
      {legend ? (
        <div className="row small muted" style={{ marginTop: 6 }}>
          <span>
            <i className="dot" /> {legend[0]}
          </span>
          <span>
            <i className="dot alt" /> {legend[1]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
