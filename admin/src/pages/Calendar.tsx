import { useEffect, useMemo, useState } from 'react';
import { api, blockKind, errorText, type Barber, type BlockOccurrence, type Booking, type Client, type Location, type Me, type Service, type Slot, type TimeOff } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { BOOKINGS_CHANGED } from '../Requests';
import { addDays, date, dayOf, hm, lei, localToIso, longDate, minutesOf, STATUS, time, today } from '../util';
import { BookingPanel, Icon } from './BookingPanel';

const PX = 1.2; // pixeli pe minut
/** Culorile implicite, dacă frizerul nu are una aleasă în „Frizeri”. */
export const BARBER_PALETTE = ['#F28C28', '#E5484D', '#3E7BFA', '#30A46C', '#8E4EC6', '#12A594', '#D6409F', '#AD7F58'];
export const barberColor = (b: Pick<Barber, 'color'>, i: number) => b.color || BARBER_PALETTE[i % BARBER_PALETTE.length];

type Stats = {
  upcoming: number;
  last30: { bookings: number; revenue: number | null; subscriptionsSold?: number; cancelled: number; noShow: number; newClients: number | null };
};

export function CalendarPage({ me }: { me: Me }) {
  const [day, setDay] = useState(today());
  const [open, setOpen] = useState<Booking | null>(null);
  // ✓ de pe calendar: panoul se deschide direct la încasare.
  const [openCheckout, setOpenCheckout] = useState(false);
  // Fereastra mică de la trecerea cu mouse-ul peste o programare.
  const [hover, setHover] = useState<{ b: Booking; x: number; y: number } | null>(null);
  const [quickErr, setQuickErr] = useState<string | null>(null);
  const [create, setCreate] = useState<{ barberId?: string; time?: string } | null>(null);

  const meta = useLoad(() => Promise.all([api<Barber[]>('GET', '/admin/barbers'), api<Service[]>('GET', '/admin/services')]));
  // Pasul din Setări → Reguli de programare (la fel ca orele libere și calendarul din aplicație).
  const biz = useLoad(() => api<{ slotStepMin?: number }>('GET', '/business'));
  const step = biz.data?.slotStepMin || 15;
  // Filtrul pe locație apare doar când salonul are mai multe locații active ('' = toate).
  const locs = useLoad(() => api<Location[]>('GET', '/admin/locations'));
  const [loc, setLoc] = useState('');
  const activeLocs = (locs.data ?? []).filter((l) => l.active);
  const stats = useLoad(() => api<Stats>('GET', '/admin/stats'));
  const from = localToIso(day, '00:00');
  const to = localToIso(addDays(day, 1), '00:00');
  const bookings = useLoad(() => api<Booking[]>('GET', `/admin/bookings?from=${from}&to=${to}`), [day]);
  const off = useLoad(() => api<TimeOff[]>('GET', `/admin/time-off?from=${from}`), [day]);
  // Blocurile din program (pauză, liber, curs, doar membri) în ziua afișată.
  const blocks = useLoad(() => api<BlockOccurrence[]>('GET', `/admin/blocks/occurrences?from=${day}&to=${day}`), [day]);
  const unclosed = useLoad(() => api<Booking[]>('GET', '/admin/bookings/unclosed'));
  // Câți clienți așteaptă un loc liber în ziua afișată (Listă de așteptare).
  const waiting = useLoad(() => api<Array<{ active: boolean }>>('GET', `/admin/waitlist?from=${day}&to=${day}`), [day]);

  const [barbers, services] = meta.data ?? [[], []];
  const own = me.permissions.bookings_all ? null : me.barberId;
  const [hidden, setHidden] = useState<string[]>([]);
  const activeBarbers = barbers.filter((b) => b.active && (!own || b.id === own) && (!loc || b.locationId === loc));
  const cols = activeBarbers.filter((b) => !hidden.includes(b.id));
  const colorOf = (id: string) => {
    const i = barbers.findIndex((b) => b.id === id);
    return i < 0 ? BARBER_PALETTE[0] : barberColor(barbers[i], i);
  };
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();

  // Intervalul afișat: de la cea mai devreme oră de program până la cea mai târzie (+ programări în afara lui).
  const [startMin, endMin] = useMemo(() => {
    let s = 9 * 60,
      e = 20 * 60;
    const hrs = cols.flatMap((b) => b.hours.filter((h) => h.weekday === weekday));
    if (hrs.length) {
      s = Math.min(...hrs.map((h) => h.start));
      e = Math.max(...hrs.map((h) => h.end));
    }
    for (const b of bookings.data ?? []) {
      s = Math.min(s, minutesOf(b.start));
      e = Math.max(e, minutesOf(b.end) || 1440);
    }
    return [Math.floor(s / 60) * 60, Math.ceil(e / 60) * 60];
  }, [cols, bookings.data, weekday]);

  const height = (endMin - startMin) * PX;
  const nowMin = day === today() ? minutesOf(new Date().toISOString()) : -1;
  const reload = () => {
    bookings.reload();
    stats.reload();
    unclosed.reload();
  };
  // Clopoțelul anunță cererile noi și răspunsurile date din listă: calendarul se reîncarcă singur.
  useEffect(() => {
    const f = () => bookings.reload();
    window.addEventListener(BOOKINGS_CHANGED, f);
    return () => window.removeEventListener(BOOKINGS_CHANGED, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="head">
        <h1>Calendar</h1>
        {me.permissions.bookings_create ? <button onClick={() => setCreate({})}>+ Programare nouă</button> : null}
      </div>

      {stats.data ? (
        <div className="grid stats">
          <Stat v={stats.data.upcoming} l="programări viitoare" />
          <Stat v={stats.data.last30.bookings} l="programări, ultimele 30 de zile" />
          {stats.data.last30.revenue !== null ? <Stat v={lei(stats.data.last30.revenue)} l="încasări (tunsori + abonamente), 30 de zile" /> : null}
          {stats.data.last30.subscriptionsSold ? <Stat v={stats.data.last30.subscriptionsSold} l="abonamente vândute, 30 de zile" /> : null}
          {stats.data.last30.newClients !== null ? <Stat v={stats.data.last30.newClients} l="clienți noi, 30 de zile" /> : null}
          <Stat v={stats.data.last30.cancelled + stats.data.last30.noShow} l="anulări și neprezentări" />
        </div>
      ) : null}

      {unclosed.data?.length ? (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
          <b className="err" style={{ display: 'block' }}>
            {unclosed.data.length === 1 ? 'O programare trecută nu e închisă' : `${unclosed.data.length} programări trecute nu sunt închise`}
          </b>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Fiecare tuns se închide: încheiată (cu plata), nu a venit sau anulată. Apasă pe una ca s-o închizi.
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {unclosed.data.slice(0, 12).map((b) => (
              <button key={b.id} className="ghost sm" onClick={() => setOpen(b)}>
                {date(b.start)} {time(b.start)} · {b.clientName || 'Client'} · {b.barberName}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="ghost sm" onClick={() => setDay(addDays(day, -1))} aria-label="Ziua anterioară">
          ←
        </button>
        <button className="ghost sm" onClick={() => setDay(today())}>
          Azi
        </button>
        <button className="ghost sm" onClick={() => setDay(addDays(day, 1))} aria-label="Ziua următoare">
          →
        </button>
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: 170 }} />
        <strong style={{ textTransform: 'capitalize' }}>{longDate(day + 'T12:00:00Z')}</strong>
        {activeLocs.length > 1 && !own ? (
          <select value={loc} onChange={(e) => setLoc(e.target.value)} style={{ width: 200 }} aria-label="Locația">
            <option value="">Toate locațiile</option>
            {activeLocs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        ) : null}
        <span className="muted small">
          {(bookings.data ?? []).filter((b) => b.status !== 'cancelled' && (!loc || activeBarbers.some((x) => x.id === b.barberId))).length} programări
        </span>
        {waiting.data?.some((w) => w.active) ? (
          <a className="small" href="#/waitlist">
            {waiting.data.filter((w) => w.active).length} pe lista de așteptare
          </a>
        ) : null}
      </div>

      {activeBarbers.length > 1 ? (
        <div className="row" style={{ gap: 6, marginBottom: 12 }}>
          {activeBarbers.map((b) => {
            const on = !hidden.includes(b.id);
            return (
              <button
                key={b.id}
                className={`chip${on ? ' on' : ''}`}
                style={{ ['--c' as string]: colorOf(b.id) }}
                onClick={() => setHidden(on ? [...hidden, b.id] : hidden.filter((h) => h !== b.id))}
                aria-pressed={on}
              >
                <span className="dot" style={{ background: colorOf(b.id) }} /> {b.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {blocks.data?.length ? (
        <div className="row small muted" style={{ gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          {[...new Map(blocks.data.map((o) => [o.kind === 'other' ? o.label : o.kind, o])).values()].map((o) => (
            <span key={o.blockId}>
              <span className="dot" style={{ background: blockKind(o.kind).color, marginRight: 4 }} />
              {o.label}
            </span>
          ))}
        </div>
      ) : null}

      {!meta.data || !bookings.data ? (
        <Loading error={meta.error || bookings.error} />
      ) : !cols.length ? (
        <p className="muted">{activeBarbers.length ? 'Alege cel puțin un frizer de mai sus.' : 'Nu există frizeri activi. Adaugă unul în Afaceri → Frizeri.'}</p>
      ) : (
        <div className="table-wrap">
          <div className="cal" style={{ minWidth: 60 + cols.length * 160 }}>
            <div className="cal-head" style={{ gridTemplateColumns: `60px repeat(${cols.length}, 1fr)` }}>
              <div />
              {cols.map((b) => (
                <div key={b.id} className="cal-barber">
                  {b.photoUrl ? <img src={b.photoUrl} alt="" style={{ borderColor: colorOf(b.id) }} /> : <span className="avatar sm" style={{ background: colorOf(b.id) }}>{b.initials}</span>}
                  <span>{b.name}</span>
                  <span className="muted small">{(bookings.data ?? []).filter((x) => x.barberId === b.id && x.status !== 'cancelled').length}</span>
                </div>
              ))}
            </div>
            <div className="cal-body" style={{ gridTemplateColumns: `60px repeat(${cols.length}, 1fr)`, height }}>
              <div className="cal-times">
                {Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => (
                  <span key={i} style={{ top: i * 60 * PX }}>
                    {hm(startMin + i * 60)}
                  </span>
                ))}
              </div>
              {cols.map((b) => {
                const hrs = b.hours.filter((h) => h.weekday === weekday).sort((x, y) => x.start - y.start);
                // Zonele hașurate: în afara programului și concediile.
                const gaps: Array<[number, number]> = [];
                let cur = startMin;
                for (const h of hrs) {
                  if (h.start > cur) gaps.push([cur, h.start]);
                  cur = Math.max(cur, h.end);
                }
                if (cur < endMin) gaps.push([cur, endMin]);
                for (const t of off.data ?? []) {
                  if (t.barberId && t.barberId !== b.id) continue;
                  const s = Date.parse(t.start),
                    e = Date.parse(t.end);
                  if (e <= Date.parse(from) || s >= Date.parse(to)) continue;
                  gaps.push([s <= Date.parse(from) ? startMin : minutesOf(t.start), e >= Date.parse(to) ? endMin : minutesOf(t.end)]);
                }
                return (
                  <div
                    key={b.id}
                    className="cal-col cal-empty"
                    onClick={(e) => {
                      const cl = (e.target as HTMLElement).classList;
                      if (e.target !== e.currentTarget && !cl.contains('cal-off') && !cl.contains('cal-line') && !cl.contains('cal-block')) return;
                      const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                      const m = Math.floor((startMin + y / PX) / step) * step;
                      if (me.permissions.bookings_create) setCreate({ barberId: b.id, time: hm(m) });
                    }}
                    title="Click pe o zonă liberă pentru programare nouă"
                  >
                    {Array.from({ length: Math.ceil((endMin - startMin) / step) }, (_, i) => (
                      <div key={i} className={(i * step) % 60 ? 'cal-line' : 'cal-line hour'} style={{ top: i * step * PX }} />
                    ))}
                    {gaps.map(([s, e], i) => (
                      <div key={i} className="cal-off" style={{ top: (s - startMin) * PX, height: (e - s) * PX }} />
                    ))}
                    {(blocks.data ?? [])
                      .filter((o) => !o.barberId || o.barberId === b.id)
                      .map((o) => {
                        const s = Math.max(minutesOf(o.start), startMin);
                        const e = Math.min(minutesOf(o.end) || 1440, endMin);
                        if (e <= s) return null;
                        return (
                          <div
                            key={o.blockId}
                            className={`cal-block ${o.kind}`}
                            style={{ top: (s - startMin) * PX, height: (e - s) * PX, ['--c' as string]: blockKind(o.kind).color }}
                            title={`${o.label} · ${time(o.start)}–${time(o.end)}${o.repeat ? ' · în fiecare săptămână' : ''}${o.kind === 'members' ? ' · în aplicație orele le văd doar membrii' : ''}`}
                          >
                            <span>{o.label}</span>
                          </div>
                        );
                      })}
                    {nowMin >= startMin && nowMin <= endMin ? <div className="cal-now" style={{ top: (nowMin - startMin) * PX }} /> : null}
                    {(bookings.data ?? [])
                      .filter((x) => x.barberId === b.id && x.status !== 'cancelled')
                      .map((x) => {
                        const s = minutesOf(x.start);
                        const len = (Date.parse(x.end) - Date.parse(x.start)) / 60000;
                        const started = Date.parse(x.start) < Date.now();
                        const canQuick = me.permissions.bookings_manage && x.status === 'confirmed';
                        return (
                          <div
                            key={x.id}
                            className={`cal-ev ${x.status}${x.clientBirthday ? ' bday' : ''}${open?.id === x.id ? ' sel' : ''}`}
                            style={{ top: (s - startMin) * PX + 1, height: Math.max(len * PX - 2, 22), ['--c' as string]: colorOf(b.id) }}
                            onClick={() => {
                              setHover(null);
                              setOpenCheckout(false);
                              setOpen(x);
                            }}
                            onMouseEnter={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setHover({ b: x, x: r.right, y: r.top });
                            }}
                            onMouseLeave={() => setHover(null)}
                          >
                            <span className={`cal-dot ${x.status}`} aria-hidden="true" />
                            {canQuick ? (
                              <span className="cal-quick">
                                <button
                                  type="button"
                                  className="no"
                                  title="Anulează programarea"
                                  aria-label="Anulează programarea"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    setHover(null);
                                    if (!confirm(`Anulezi programarea lui ${x.clientName || 'client'} de la ${time(x.start)}? Ora se eliberează și clientul primește mesaj.`)) return;
                                    try {
                                      setQuickErr(null);
                                      await api('PATCH', `/admin/bookings/${x.id}`, { status: 'cancelled' });
                                      reload();
                                    } catch (err) {
                                      setQuickErr(errorText(err));
                                    }
                                  }}
                                >
                                  <Icon name="x" size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="ok"
                                  disabled={!started}
                                  title={started ? 'Programare încheiată: încasează' : 'Se poate marca încheiată după ce începe'}
                                  aria-label="Programare încheiată"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setHover(null);
                                    setOpenCheckout(true);
                                    setOpen(x);
                                  }}
                                >
                                  <Icon name="check" size={14} />
                                </button>
                              </span>
                            ) : null}
                            <b>
                              {time(x.start)}–{time(x.end)} {x.status === 'completed' ? '✓ ' : x.status === 'no_show' ? '✗ ' : ''}
                              {x.clientBirthday ? '🕯️ ' : ''}
                              {x.clientName || x.clientPhone}
                            </b>
                            {x.status === 'requested' ? 'Cerere · ' : ''}
                            {x.serviceName}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {(bookings.data ?? []).some((b) => b.status === 'cancelled') ? (
        <details style={{ marginTop: 14 }}>
          <summary className="muted">Anulate în această zi</summary>
          {(bookings.data ?? [])
            .filter((b) => b.status === 'cancelled')
            .map((b) => (
              <div key={b.id} className="small muted" style={{ padding: '4px 0' }}>
                {time(b.start)} · {b.clientName || b.clientPhone} · {b.serviceName} · {b.barberName}
                {b.requestOutcome === 'refused' ? ` · cerere refuzată${b.refuseReason ? `: ${b.refuseReason}` : ''}` : b.requestOutcome === 'expired' ? ' · cerere expirată (fără răspuns)' : ''}
              </div>
            ))}
        </details>
      ) : null}

      {quickErr ? (
        <div className="err" style={{ marginTop: 10 }}>
          {quickErr}
        </div>
      ) : null}

      {hover && !open ? (
        <div className="cal-pop" style={{ left: Math.min(hover.x + 10, window.innerWidth - 300), top: Math.max(8, Math.min(hover.y, window.innerHeight - 190)) }} role="tooltip">
          <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'nowrap' }}>
            <b>
              {time(hover.b.start)} – {time(hover.b.end)}
            </b>
            <span className={`pill ${hover.b.status}`}>{STATUS[hover.b.status]}</span>
          </div>
          <div className="cal-pop-name">
            {hover.b.clientBirthday ? '🕯️ ' : ''}
            {hover.b.clientName || hover.b.clientPhone || 'Client'}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <span className="dot" style={{ background: services.find((x) => x.id === hover.b.serviceId)?.color || colorOf(hover.b.barberId) }} />
            <span style={{ flex: 1 }}>{hover.b.serviceName}</span>
            <span className="muted">{Math.round((Date.parse(hover.b.end) - Date.parse(hover.b.start)) / 60000)} min</span>
          </div>
          {hover.b.note ? <div className="muted small">📝 {hover.b.note}</div> : null}
          <div className="muted small cal-pop-foot">
            {hover.b.status === 'requested' ? 'Cerere în așteptare: apasă ca s-o accepți sau s-o refuzi' : 'Apasă ca să deschizi panoul programării'}
          </div>
        </div>
      ) : null}

      {open ? (
        <BookingPanel
          key={open.id}
          b={open}
          color={colorOf(open.barberId)}
          canManage={me.permissions.bookings_manage}
          allBarbers={!!me.permissions.bookings_all}
          owner={me.owner}
          online={!!me.onlinePayments}
          barbers={barbers}
          services={services}
          locations={locs.data ?? []}
          startCheckout={openCheckout}
          onClose={() => {
            setOpen(null);
            setOpenCheckout(false);
          }}
          onChange={reload}
        />
      ) : null}
      {create && meta.data ? (
        <NewBooking
          me={me}
          barbers={cols}
          services={services.filter((s) => s.active)}
          day={day}
          initial={create}
          onClose={() => setCreate(null)}
          onDone={(d) => {
            setCreate(null);
            if (d !== day) setDay(d);
            else reload();
          }}
        />
      ) : null}
    </>
  );
}

function Stat({ v, l }: { v: string | number; l: string }) {
  return (
    <div className="card stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

function NewBooking({
  me,
  barbers,
  services,
  day: initialDay,
  initial,
  onClose,
  onDone,
}: {
  me: Me;
  barbers: Barber[];
  services: Service[];
  day: string;
  initial: { barberId?: string; time?: string };
  onClose: () => void;
  onDone: (day: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [barberId, setBarberId] = useState(initial.barberId ?? me.barberId ?? barbers[0]?.id ?? '');
  const [day, setDay] = useState(initialDay);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [forceTime, setForceTime] = useState(initial.time ?? '10:00');
  const [notify, setNotify] = useState(true);
  // Clientul ales din bază (căutat după telefon sau nume); fără el se face client nou din telefon + nume.
  const [picked, setPicked] = useState<(Client & { visits?: number }) | null>(null);
  const [hits, setHits] = useState<(Client & { visits?: number })[]>([]);
  const [searchIn, setSearchIn] = useState<'phone' | 'name' | null>(null);
  const { busy, error, run } = useAction();

  const term = searchIn === 'phone' ? phone : searchIn === 'name' ? name : '';
  useEffect(() => {
    const q = term.trim();
    if (!me.permissions.clients || picked || q.replace(/\s/g, '').length < 3) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<(Client & { visits?: number })[]>('GET', `/admin/clients?q=${encodeURIComponent(q)}`).then(
        (r) => setHits(r.slice(0, 8)),
        () => setHits([]),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [term, picked, me.permissions.clients]);

  useEffect(() => {
    if (!serviceId || !barberId) return;
    setSlots(null);
    setStart(null);
    api<Slot[]>('GET', `/availability?serviceId=${serviceId}&barberId=${barberId}&day=${day}`).then(
      (s) => {
        setSlots(s);
        // Dacă s-a dat click pe calendar la o oră liberă, o preselectăm.
        const pre = initial.time && s.find((x) => time(x.start) === initial.time);
        if (pre) setStart(pre.start);
        else if (initial.time && s.length) setStart(null);
      },
      () => setSlots([]),
    );
  }, [serviceId, barberId, day, initial.time]);

  const submit = () =>
    run(async () => {
      await api('POST', '/admin/bookings', {
        ...(picked ? { clientId: picked.id } : { phone, name }),
        serviceId,
        barberId,
        start: force ? localToIso(day, forceTime) : start,
        force,
        notify,
      });
      onDone(day);
    });

  const ok = (picked || phone.trim().length >= 9) && serviceId && barberId && (force ? !!forceTime : !!start);

  return (
    <Modal title="Programare nouă" onClose={onClose}>
      <div className="grid">
        {picked ? (
          <div className="card row" style={{ background: 'var(--card-alt)', justifyContent: 'space-between', padding: '10px 14px' }}>
            <div>
              <strong>{picked.name || 'Fără nume'}</strong>
              <div className="muted small">
                {[picked.phone, picked.visits ? `${picked.visits} ${picked.visits === 1 ? 'vizită' : 'vizite'}` : 'nicio vizită încă'].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button type="button" className="ghost sm" onClick={() => setPicked(null)}>
              Alt client
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <div className="grid two">
              <Field label="Telefon client">
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setSearchIn('phone');
                  }}
                  placeholder="07xx xxx xxx"
                  autoFocus
                />
              </Field>
              <Field label={me.permissions.clients ? 'Nume (caută sau client nou)' : 'Nume (pentru client nou)'}>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSearchIn('name');
                  }}
                />
              </Field>
            </div>
            {hits.length ? (
              <div className="suggest">
                <div className="muted small" style={{ padding: '6px 12px' }}>
                  Clienți găsiți în bază:
                </div>
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      setPicked(h);
                      setHits([]);
                    }}
                  >
                    <strong>{h.name || 'Fără nume'}</strong>
                    <span className="muted small">
                      {[h.phone, h.visits ? `${h.visits} ${h.visits === 1 ? 'vizită' : 'vizite'}` : ''].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
        <Field label="Serviciu">
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.durationMin} min · {lei(s.price)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid two">
          <Field label="Frizer">
            <select value={barberId} onChange={(e) => setBarberId(e.target.value)} disabled={!me.permissions.bookings_all && !!me.barberId}>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ziua">
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </Field>
        </div>
        {!force ? (
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              Ore libere
            </div>
            {slots === null ? (
              <span className="muted small">Se încarcă…</span>
            ) : slots.length === 0 ? (
              <span className="muted small">Nicio oră liberă în ziua asta.</span>
            ) : (
              <>
                {slots.some((s) => s.membersOnly) ? <div className="muted small" style={{ marginBottom: 6 }}>★ = oră doar pentru membri TAF Club</div> : null}
                <div className="slots">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      className={`${s.start === start ? 'on' : ''}${s.membersOnly ? ' members' : ''}`}
                      onClick={() => setStart(s.start)}
                      title={s.membersOnly ? 'Oră doar pentru membri TAF Club (din panou o poți da oricui)' : undefined}
                    >
                      {time(s.start)}
                      {s.membersOnly ? ' ★' : ''}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <Field label="Ora (poate fi și în afara programului)">
            <input type="time" step={300} value={forceTime} onChange={(e) => setForceTime(e.target.value)} style={{ width: 140 }} />
          </Field>
        )}
        <label className="check small">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Altă oră decât cele libere
        </label>
        <label className="check small">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Trimite SMS de confirmare clientului
        </label>
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          <button disabled={!ok || busy} onClick={submit}>
            Salvează programarea
          </button>
          <button className="ghost" onClick={onClose}>
            Renunță
          </button>
        </div>
        {dayOf(new Date()) > day ? <div className="muted small">Atenție: ziua aleasă e în trecut.</div> : null}
      </div>
    </Modal>
  );
}
