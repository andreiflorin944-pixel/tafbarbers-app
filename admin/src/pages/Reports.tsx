import { useEffect, useState } from 'react';
import { api, ApiError, errorText, getToken, type Barber, type Me, type Service } from '../api';
import { Field, Loading, useLoad } from '../ui';
import { addDays, lei, today } from '../util';

type ReportMeta = { kind: string; title: string; range: 'day' | 'period' | 'future' | 'months' };
type Col = { key: string; label: string; type: 'text' | 'int' | 'money' | 'pct' | 'date' | 'datetime' };
type Row = Record<string, string | number | null>;
type Report = { kind: string; title: string; from: string; to: string; columns: Col[]; rows: Row[]; totals: Row | null };

const HELP: Record<string, string> = {
  day: 'Tot ce s-a întâmplat într-o zi: programări, anulări, clienți noi, încasări și bacșiș.',
  bookings: 'Toate programările din perioadă, cu filtre după frizer, serviciu și stare.',
  'sales-barber': 'Ce a încasat fiecare frizer: servicii finalizate, abonamente vândute și bacșiș.',
  'sales-service': 'Câte servicii de fiecare fel s-au făcut și cât au adus.',
  'bookings-barber': 'Câte programări a avut fiecare frizer și cum s-au încheiat.',
  upcoming: 'Programările confirmate care urmează.',
  'cancel-staff': 'Programările anulate de echipă și cine le-a anulat.',
  'cancel-client': 'Programările anulate de clienți și cu cât timp înainte.',
  payments: 'Fiecare plată în parte: servicii, tunsori din abonament și abonamente vândute.',
  'payments-member': 'Banii încasați de fiecare cont al echipei.',
  'tips-member': 'Bacșișul primit de fiecare frizer.',
  top100: 'Cei mai buni 100 de clienți din perioadă, după cât au cheltuit.',
  retention: 'Pe luni: câți clienți au venit și câți dintre ei au mai venit în următoarele 60 de zile.',
  'new-returning': 'Clienții noi față de cei care au mai fost, pe zile (sau pe luni, pentru perioade lungi).',
};
const STATUSES: Record<string, string> = { confirmed: 'Confirmate', completed: 'Finalizate', cancelled: 'Anulate', no_show: 'Neprezentări' };
const PAGE = 50;

function presets(range: ReportMeta['range']) {
  const t = today();
  const monthStart = t.slice(0, 8) + '01';
  const prevMonthEnd = addDays(monthStart, -1);
  if (range === 'future')
    return [
      { label: 'Azi', from: t, to: t },
      { label: 'Următoarele 7 zile', from: t, to: addDays(t, 6) },
      { label: 'Următoarele 30 de zile', from: t, to: addDays(t, 29) },
    ];
  return [
    { label: 'Azi', from: t, to: t },
    { label: 'Ieri', from: addDays(t, -1), to: addDays(t, -1) },
    { label: 'Ultimele 7 zile', from: addDays(t, -6), to: t },
    { label: 'Ultimele 30 de zile', from: addDays(t, -29), to: t },
    { label: 'Luna aceasta', from: monthStart, to: t },
    { label: 'Luna trecută', from: prevMonthEnd.slice(0, 8) + '01', to: prevMonthEnd },
    { label: 'Anul acesta', from: t.slice(0, 5) + '01-01', to: t },
    { label: 'Ultimele 12 luni', from: addDays(t, -364), to: t },
  ];
}

const cell = (c: Col, v: unknown) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money') return lei(Number(v));
  if (c.type === 'pct') return `${v}%`;
  return String(v);
};

export function ReportsPage({ me }: { me: Me }) {
  const list = useLoad(() => api<ReportMeta[]>('GET', '/admin/reports'));
  const meta = useLoad(() => Promise.all([api<Barber[]>('GET', '/admin/barbers'), api<Service[]>('GET', '/admin/services')]));
  const [kind, setKind] = useState('day');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [filters, setFilters] = useState<{ barberId: string; serviceId: string; status: string }>({ barberId: '', serviceId: '', status: '' });
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const current = list.data?.find((r) => r.kind === kind);
  const query = () => {
    const p = new URLSearchParams({ from, to });
    if (filters.barberId) p.set('barberId', filters.barberId);
    if (filters.serviceId) p.set('serviceId', filters.serviceId);
    if (filters.status && kind === 'bookings') p.set('status', filters.status);
    return p;
  };

  // La schimbarea raportului alegem o perioadă potrivită lui.
  const pick = (k: string) => {
    const r = list.data?.find((x) => x.kind === k);
    setKind(k);
    const t = today();
    if (r?.range === 'day') setFrom(t), setTo(t);
    else if (r?.range === 'future') setFrom(t), setTo(addDays(t, 29));
    else if (r?.range === 'months') setFrom(addDays(t, -364).slice(0, 8) + '01'), setTo(t);
    else if (current?.range === 'day' || current?.range === 'future' || current?.range === 'months') setFrom(addDays(t, -29)), setTo(t);
  };

  useEffect(() => {
    if (!list.data) return;
    let stale = false;
    setLoading(true);
    setError(null);
    api<Report>('GET', `/admin/reports/${kind}?${query()}`)
      .then((r) => !stale && (setData(r), setPage(0)), (e) => !stale && setError(errorText(e)))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, kind, from, to, filters]);

  async function download() {
    setDownloading(true);
    try {
      const p = query();
      p.set('format', 'xlsx');
      const res = await fetch(`/v1/admin/reports/${kind}?${p}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'server_error', res.status);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${current?.title ?? 'raport'} ${from === to ? from : `${from} - ${to}`}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDownloading(false);
    }
  }

  if (!list.data) return <Loading error={list.error} />;
  const [barbers, services] = meta.data ?? [[], []];
  const rows = data?.rows ?? [];
  const pages = Math.ceil(rows.length / PAGE);
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const numeric = (c: Col) => c.type === 'int' || c.type === 'money' || c.type === 'pct';

  return (
    <>
      <div className="head">
        <h1>Rapoarte</h1>
        <button disabled={downloading || !data || !rows.length} onClick={download}>
          {downloading ? 'Se pregătește…' : 'Descarcă Excel'}
        </button>
      </div>
      {!me.permissions.bookings_all ? <p className="muted small" style={{ marginTop: -8 }}>Vezi doar programările și încasările tale.</p> : null}
      {!me.permissions.stats ? <p className="muted small" style={{ marginTop: -8 }}>Sumele de bani nu apar pentru contul tău.</p> : null}

      <div className="reports">
        <nav className="report-list">
          {list.data.map((r) => (
            <button key={r.kind} className={r.kind === kind ? 'on' : ''} onClick={() => pick(r.kind)}>
              {r.title}
            </button>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          <div className="card grid" style={{ marginBottom: 14 }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>{current?.title}</h2>
              <div className="muted small">{HELP[kind]}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {current?.range === 'day'
                ? null
                : presets(current?.range ?? 'period').map((p) => (
                    <button key={p.label} className={p.from === from && p.to === to ? 'sm' : 'ghost sm'} onClick={() => (setFrom(p.from), setTo(p.to))}>
                      {p.label}
                    </button>
                  ))}
            </div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label={current?.range === 'day' ? 'Ziua' : 'De la'}>
                <input type="date" value={from} onChange={(e) => e.target.value && (setFrom(e.target.value), current?.range === 'day' && setTo(e.target.value))} />
              </Field>
              {current?.range === 'day' ? null : (
                <Field label="Până la">
                  <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
                </Field>
              )}
              {me.permissions.bookings_all && barbers.length ? (
                <Field label="Frizer">
                  <select value={filters.barberId} onChange={(e) => setFilters({ ...filters, barberId: e.target.value })}>
                    <option value="">Toți</option>
                    {barbers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {kind === 'bookings' || kind === 'upcoming' ? (
                <Field label="Serviciu">
                  <select value={filters.serviceId} onChange={(e) => setFilters({ ...filters, serviceId: e.target.value })}>
                    <option value="">Toate</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {kind === 'bookings' ? (
                <Field label="Stare">
                  <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                    <option value="">Toate</option>
                    {Object.entries(STATUSES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
          </div>

          {error ? <div className="err">{error}</div> : null}
          {loading && !data ? <Loading /> : null}
          {data && data.kind === kind ? (
            <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
              {rows.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Nu sunt date în perioada aleasă.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="report">
                    <thead>
                      <tr>
                        {data.columns.map((c) => (
                          <th key={c.key} style={{ textAlign: numeric(c) ? 'right' : 'left' }}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r, i) => (
                        <tr key={i}>
                          {data.columns.map((c) => (
                            <td key={c.key} style={{ textAlign: numeric(c) ? 'right' : 'left' }}>
                              {cell(c, r[c.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {data.totals && page === pages - 1 ? (
                        <tr className="total">
                          {data.columns.map((c) => (
                            <td key={c.key} style={{ textAlign: numeric(c) ? 'right' : 'left' }}>
                              {cell(c, data.totals![c.key])}
                            </td>
                          ))}
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
              {pages > 1 ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Înapoi
                  </button>
                  <span className="muted small">
                    Pagina {page + 1} din {pages} · {rows.length} rânduri
                  </span>
                  <button className="ghost sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                    Înainte
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
