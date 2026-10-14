import { useEffect, useMemo, useRef, useState } from 'react';
import { api, blockKind, errorText, type Barber, type BlockOccurrence, type Booking, type Client, type Location, type Me, type Service, type Slot, type TimeOff } from '../api';
import { Field, Loading, Modal, TopBar, useAction, useLoad } from '../ui';
import { BOOKINGS_CHANGED } from '../Requests';
import { addDays, date, dayOf, hm, lei, localToIso, longDate, minutesOf, STATUS, time, today } from '../util';
import { BookingPanel, Icon } from './BookingPanel';

const PX = 2; // pixeli pe minut: un rând de 15 minute = 30 px, cu ora pe fiecare linie și loc de oră, client și serviciu într-o programare de 30 de minute
/** Culorile implicite, dacă frizerul nu are una aleasă în „Frizeri”. */
export const BARBER_PALETTE = ['#F28C28', '#E5484D', '#3E7BFA', '#30A46C', '#8E4EC6', '#12A594', '#D6409F', '#AD7F58'];
export const barberColor = (b: Pick<Barber, 'color'>, i: number) => b.color || BARBER_PALETTE[i % BARBER_PALETTE.length];

const WIDE_KEY = 'taf-cal-wide';
const WIDE_FROM = 7 * 60;
const WIDE_TO = 22 * 60;
const VIEW_KEY = 'taf-cal-view';

// Eticheta scurtă a stării, pentru bulina din colțul programării.
const STATUS_SHORT: Record<string, string> = { requested: 'Cerere', confirmed: 'Confirmată', completed: 'Finalizată', no_show: 'Neprezentare' };
const durText = (min: number) => {
  const h = Math.floor(min / 60),
    m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
const countText = (n: number) => (n === 1 ? '1 programare' : `${n} programări`);
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const dayHeadF = new Intl.DateTimeFormat('ro-RO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const rangeF = new Intl.DateTimeFormat('ro-RO', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
/** Intervalele de program, unite (pentru săptămână, peste toți frizerii afișați). */
function merge(list: Array<{ start: number; end: number }>) {
  const out: Array<{ start: number; end: number }> = [];
  for (const h of [...list].sort((x, y) => x.start - y.start)) {
    const last = out[out.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else out.push({ ...h });
  }
  return out;
}
/** Programările suprapuse stau una lângă alta: banda fiecăreia și câte benzi are grupul. */
function lanes(list: Booking[]) {
  const out = new Map<string, { lane: number; n: number }>();
  let group: string[] = [];
  let ends: number[] = [];
  let groupEnd = 0;
  const flush = () => {
    for (const id of group) out.get(id)!.n = ends.length;
    group = [];
    ends = [];
    groupEnd = 0;
  };
  for (const b of [...list].sort((x, y) => Date.parse(x.start) - Date.parse(y.start))) {
    const s = Date.parse(b.start),
      e = Date.parse(b.end);
    if (group.length && s >= groupEnd) flush();
    let i = ends.findIndex((x) => x <= s);
    if (i < 0) {
      i = ends.length;
      ends.push(e);
    } else ends[i] = e;
    out.set(b.id, { lane: i, n: 1 });
    group.push(b.id);
    groupEnd = Math.max(groupEnd, e);
  }
  flush();
  return out;
}

export function CalendarPage({ me }: { me: Me }) {
  const [day, setDay] = useState(today());
  const [open, setOpen] = useState<Booking | null>(null);
  // ✓ de pe calendar: panoul se deschide direct la încasare.
  const [openCheckout, setOpenCheckout] = useState(false);
  // Fereastra mică de la trecerea cu mouse-ul peste o programare.
  const [hover, setHover] = useState<{ b: Booking; x: number; y: number } | null>(null);
  const [quickErr, setQuickErr] = useState<string | null>(null);
  const [create, setCreate] = useState<{ barberId?: string; time?: string; outside?: boolean; day?: string } | null>(null);
  const datePick = useRef<HTMLInputElement>(null);
  // „Toată ziua”: calendarul se întinde 07:00–22:00, cu orele din afara programului hașurate (și programabile). Ținut minte în browser.
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem(WIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleWide = () => {
    setWide(!wide);
    try {
      localStorage.setItem(WIDE_KEY, wide ? '0' : '1');
    } catch {
      // fără stocare: alegerea ține doar până la reîncărcare
    }
  };
  // Zi sau săptămână (ținut minte în browser).
  const [view, setView] = useState<'day' | 'week'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'day';
    } catch {
      return 'day';
    }
  });
  const pickView = (v: 'day' | 'week') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // fără stocare: alegerea ține doar până la reîncărcare
    }
  };

  const meta = useLoad(() => Promise.all([api<Barber[]>('GET', '/admin/barbers'), api<Service[]>('GET', '/admin/services')]));
  // Pasul din Setări → Reguli de programare (la fel ca orele libere și calendarul din aplicație).
  const biz = useLoad(() => api<{ slotStepMin?: number }>('GET', '/business'));
  const step = biz.data?.slotStepMin || 15;
  // Filtrul pe locație apare doar când salonul are mai multe locații active ('' = toate).
  const locs = useLoad(() => api<Location[]>('GET', '/admin/locations'));
  const [loc, setLoc] = useState('');
  const activeLocs = (locs.data ?? []).filter((l) => l.active);
  const week = view === 'week';
  // Săptămâna începe lunea.
  const days = week ? Array.from({ length: 7 }, (_, i) => addDays(day, i - ((weekdayOf(day) + 6) % 7))) : [day];
  const first = days[0];
  const last = days[days.length - 1];
  const from = localToIso(first, '00:00');
  const to = localToIso(addDays(last, 1), '00:00');
  const bookings = useLoad(() => api<Booking[]>('GET', `/admin/bookings?from=${from}&to=${to}`), [from, to]);
  const off = useLoad(() => api<TimeOff[]>('GET', `/admin/time-off?from=${from}`), [from]);
  // Blocurile din program (pauză, liber, curs, doar membri) în zilele afișate.
  const blocks = useLoad(() => api<BlockOccurrence[]>('GET', `/admin/blocks/occurrences?from=${first}&to=${last}`), [first, last]);
  const unclosed = useLoad(() => api<Booking[]>('GET', '/admin/bookings/unclosed'));
  // Câți clienți așteaptă un loc liber în zilele afișate (Listă de așteptare).
  const waiting = useLoad(() => api<Array<{ active: boolean }>>('GET', `/admin/waitlist?from=${first}&to=${last}`), [first, last]);

  const [barbers, services] = meta.data ?? [[], []];
  const own = me.permissions.bookings_all ? null : me.barberId;
  const [hidden, setHidden] = useState<string[]>([]);
  const activeBarbers = barbers.filter((b) => b.active && (!own || b.id === own) && (!loc || b.locationId === loc));
  const cols = activeBarbers.filter((b) => !hidden.includes(b.id));
  const colorOf = (id: string) => {
    const i = barbers.findIndex((b) => b.id === id);
    return i < 0 ? BARBER_PALETTE[0] : barberColor(barbers[i], i);
  };
  const shown = (bookings.data ?? []).filter((b) => b.status !== 'cancelled' && cols.some((c) => c.id === b.barberId));
  // În săptămână, concediile și blocurile unui singur frizer apar doar când e afișat doar el.
  const single = cols.length === 1 ? cols[0].id : null;

  // Intervalul afișat: de la cea mai devreme oră de program până la cea mai târzie (+ programări în afara lui).
  const [startMin, endMin] = useMemo(() => {
    let s = 9 * 60,
      e = 20 * 60;
    const wds = days.map(weekdayOf);
    const hrs = cols.flatMap((b) => b.hours.filter((h) => wds.includes(h.weekday)));
    if (hrs.length) {
      s = Math.min(...hrs.map((h) => h.start));
      e = Math.max(...hrs.map((h) => h.end));
    }
    for (const b of bookings.data ?? []) {
      s = Math.min(s, minutesOf(b.start));
      e = Math.max(e, minutesOf(b.end) || 1440);
    }
    if (wide) {
      s = Math.min(s, WIDE_FROM);
      e = Math.max(e, WIDE_TO);
    }
    return [Math.floor(s / 60) * 60, Math.ceil(e / 60) * 60];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, bookings.data, first, last, wide]);

  const height = (endMin - startMin) * PX;
  const nowMin = days.includes(today()) ? minutesOf(new Date().toISOString()) : -1;
  const nowIn = nowMin >= startMin && nowMin <= endMin;
  const reload = () => {
    bookings.reload();
    unclosed.reload();
  };
  // Clopoțelul anunță cererile noi și răspunsurile date din listă: calendarul se reîncarcă singur.
  useEffect(() => {
    const f = () => bookings.reload();
    window.addEventListener(BOOKINGS_CHANGED, f);
    return () => window.removeEventListener(BOOKINGS_CHANGED, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** O programare din calendar: ora, clientul, serviciul și starea în colț. */
  const card = (x: Booking, lane: { lane: number; n: number }, color: string, withBarber: boolean) => {
    const s = minutesOf(x.start);
    const len = (Date.parse(x.end) - Date.parse(x.start)) / 60000;
    const started = Date.parse(x.start) < Date.now();
    const canQuick = me.permissions.bookings_manage && x.status === 'confirmed';
    const h = Math.max(len * PX - 2, 22);
    return (
      <div
        key={x.id}
        className={`cal-ev ${x.status}${h < 54 ? ' short' : ''}${x.clientBirthday ? ' bday' : ''}${open?.id === x.id ? ' sel' : ''}`}
        style={{
          top: (s - startMin) * PX + 1,
          height: h,
          left: `calc(5px + (100% - 10px) * ${lane.lane / lane.n})`,
          width: `calc((100% - 10px) / ${lane.n} - ${lane.n > 1 ? 3 : 0}px)`,
          ['--c' as string]: color,
        }}
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
        {STATUS_SHORT[x.status] ? <span className={`pill ${x.status}`}>{STATUS_SHORT[x.status]}</span> : null}
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
        <span className="cal-ev-time">
          {time(x.start)} – {time(x.end)}
        </span>
        <b>
          {x.status === 'completed' ? '✓ ' : x.status === 'no_show' ? '✗ ' : ''}
          {x.clientBirthday ? '🕯️ ' : ''}
          {x.clientName || x.clientPhone}
        </b>
        <span className="cal-ev-svc">
          {x.status === 'requested' ? 'Cerere · ' : ''}
          {x.serviceName}
          {withBarber ? ` · ${x.barberName}` : ''}
        </span>
      </div>
    );
  };

  /** O coloană: un frizer (zi) sau o zi (săptămână), cu liniile, zonele hașurate, pauzele și programările. */
  const column = (key: string, d: string, barberId: string | null, hrsAll: Array<{ start: number; end: number }>, list: Booking[], withBarber: boolean) => {
    const hrs = merge(hrsAll);
    const dFrom = Date.parse(localToIso(d, '00:00'));
    const dTo = Date.parse(localToIso(addDays(d, 1), '00:00'));
    // Zonele hașurate: în afara programului. Concediile apar ca un card gri, dar contează tot ca „în afara programului”.
    const gaps: Array<[number, number]> = [];
    let cur = startMin;
    for (const h of hrs) {
      if (h.start > cur) gaps.push([cur, h.start]);
      cur = Math.max(cur, h.end);
    }
    if (cur < endMin) gaps.push([cur, endMin]);
    const offs: Array<{ s: number; e: number; label: string }> = [];
    for (const t of off.data ?? []) {
      if (t.barberId && t.barberId !== barberId) continue;
      const s = Date.parse(t.start),
        e = Date.parse(t.end);
      if (e <= dFrom || s >= dTo) continue;
      offs.push({ s: s <= dFrom ? startMin : Math.max(minutesOf(t.start), startMin), e: e >= dTo ? endMin : Math.min(minutesOf(t.end), endMin), label: t.reason || 'Concediu' });
    }
    const all: Array<[number, number]> = [...gaps, ...offs.map((o): [number, number] => [o.s, o.e])];
    const dayBlocks = (blocks.data ?? []).filter((o) => dayOf(o.start) === d && (!o.barberId || o.barberId === barberId));
    const lane = lanes(list);
    const isToday = d === today();
    return (
      <div
        key={key}
        className={`cal-col cal-empty${isToday && week ? ' today' : ''}`}
        onClick={(e) => {
          const cl = (e.target as HTMLElement).classList;
          if (e.target !== e.currentTarget && !cl.contains('cal-off') && !cl.contains('cal-line') && !cl.contains('cal-block') && !cl.contains('cal-pause')) return;
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          const m = Math.floor((startMin + y / PX) / step) * step;
          // Pe zona hașurată (în afara programului sau concediu): programarea se deschide direct „la altă oră”.
          const outside = all.some(([gs, ge]) => m >= gs && m < ge);
          if (me.permissions.bookings_create) setCreate({ barberId: barberId ?? undefined, time: hm(m), outside, day: d });
        }}
        title="Click pe o zonă liberă pentru programare nouă"
      >
        {Array.from({ length: Math.ceil((endMin - startMin) / step) }, (_, i) => (
          <div key={i} className={(i * step) % 60 ? 'cal-line' : 'cal-line hour'} style={{ top: i * step * PX }} />
        ))}
        {gaps.map(([s, e], i) => (
          <div key={i} className="cal-off" style={{ top: (s - startMin) * PX, height: (e - s) * PX }} />
        ))}
        {offs.map((o, i) =>
          o.e > o.s ? (
            <div key={'o' + i} className="cal-pause" style={{ top: (o.s - startMin) * PX + 1, height: Math.max((o.e - o.s) * PX - 2, 20) }} title={o.label}>
              <span className="cal-ev-time">
                {hm(o.s)} – {hm(o.e)} <Icon name="coffee" size={14} />
              </span>
              <b>{o.label}</b>
            </div>
          ) : null,
        )}
        {dayBlocks.map((o) => {
          const s = Math.max(minutesOf(o.start), startMin);
          const e = Math.min(minutesOf(o.end) || 1440, endMin);
          if (e <= s) return null;
          const title = `${o.label} · ${time(o.start)}–${time(o.end)}${o.repeat ? ' · în fiecare săptămână' : ''}${o.kind === 'members' ? ' · în aplicație orele le văd doar membrii' : ''}`;
          // „Doar membri” rămâne o zonă colorată (orele sunt de lucru); pauzele și liberele sunt carduri gri.
          return o.kind === 'members' ? (
            <div key={o.blockId} className="cal-block members" style={{ top: (s - startMin) * PX, height: (e - s) * PX, ['--c' as string]: blockKind(o.kind).color }} title={title}>
              <span>{o.label}</span>
            </div>
          ) : (
            <div
              key={o.blockId}
              className="cal-block cal-pause"
              style={{ top: (s - startMin) * PX + 1, height: Math.max((e - s) * PX - 2, 20), ['--c' as string]: blockKind(o.kind).color }}
              title={title}
            >
              <span className="cal-ev-time">
                {hm(s)} – {hm(e)} <Icon name="coffee" size={14} />
              </span>
              <b>{o.kind === 'lunch' ? 'Pauză' : o.label}</b>
            </div>
          );
        })}
        {week && isToday && nowIn ? <div className="cal-now" style={{ top: (nowMin - startMin) * PX }} /> : null}
        {list.map((x) => card(x, lane.get(x.id) ?? { lane: 0, n: 1 }, week ? colorOf(x.barberId) : 'var(--gold)', withBarber))}
      </div>
    );
  };

  const colW = week ? 130 : 180;
  const grid = `64px repeat(${week ? 7 : cols.length}, minmax(0, 1fr))`;
  const dateText = week ? rangeF.formatRange(new Date(first + 'T12:00:00Z'), new Date(last + 'T12:00:00Z')) : longDate(day + 'T12:00:00Z');

  return (
    <>
      <TopBar>
        <h1 className="top-title">Calendar</h1>
        <span className="cal-nav">
          <button className="ghost sq" onClick={() => setDay(addDays(day, week ? -7 : -1))} aria-label={week ? 'Săptămâna anterioară' : 'Ziua anterioară'}>
            <Icon name="chevL" size={18} />
          </button>
          <button className="ghost" onClick={() => setDay(today())}>
            Azi
          </button>
          <button className="ghost sq" onClick={() => setDay(addDays(day, week ? 7 : 1))} aria-label={week ? 'Săptămâna următoare' : 'Ziua următoare'}>
            <Icon name="chevR" size={18} />
          </button>
        </span>
        <span className="cal-date">
          <button
            className="link"
            onClick={() => {
              try {
                datePick.current?.showPicker();
              } catch {
                datePick.current?.focus();
              }
            }}
            title="Alege ziua"
          >
            {dateText.charAt(0).toUpperCase() + dateText.slice(1)}
          </button>
          <input ref={datePick} type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} tabIndex={-1} aria-label="Alege ziua" />
        </span>
        <span className="seg cal-view" role="group" aria-label="Vizualizare">
          <button className={week ? '' : 'on'} onClick={() => pickView('day')} aria-pressed={!week}>
            Zi
          </button>
          <button className={week ? 'on' : ''} onClick={() => pickView('week')} aria-pressed={week}>
            Săptămână
          </button>
        </span>
      </TopBar>

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

      <div className="cal-tools">
        {activeBarbers.length > 1 ? (
          <span className="row" style={{ gap: 6 }}>
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
          </span>
        ) : null}
        <span className="muted small">{countText(shown.length)}</span>
        {waiting.data?.some((w) => w.active) ? (
          <a className="small" href="#/waitlist">
            {waiting.data.filter((w) => w.active).length} pe lista de așteptare
          </a>
        ) : null}
        <span className="row" style={{ gap: 8, marginLeft: 'auto' }}>
          {activeLocs.length > 1 && !own ? (
            <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Locația">
              <option value="">Toate locațiile</option>
              {activeLocs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : null}
          <button className={`ghost sm${wide ? ' on' : ''}`} onClick={toggleWide} title="Arată și orele din afara programului (hașurate), ca să poți programa peste ele">
            {wide ? 'Doar programul' : 'Arată toată ziua'}
          </button>
        </span>
      </div>

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
        <div className="table-wrap cal-wrap">
          <div className={`cal${week ? ' week' : ''}`} style={{ minWidth: 64 + (week ? 7 : cols.length) * colW }}>
            <div className="cal-head" style={{ gridTemplateColumns: grid }}>
              <div />
              {week
                ? days.map((d) => {
                    const list = shown.filter((x) => dayOf(x.start) === d);
                    const mins = list.reduce((a, x) => a + (Date.parse(x.end) - Date.parse(x.start)) / 60000, 0);
                    return (
                      <button key={d} className={`cal-dayhead${d === today() ? ' today' : ''}`} onClick={() => (setDay(d), pickView('day'))} title="Deschide ziua">
                        <b>{dayHeadF.format(new Date(d + 'T12:00:00Z'))}</b>
                        <span className="muted small">{list.length ? `${countText(list.length)} · ${durText(mins)}` : 'nicio programare'}</span>
                      </button>
                    );
                  })
                : cols.map((b) => {
                    const list = shown.filter((x) => x.barberId === b.id);
                    const mins = list.reduce((a, x) => a + (Date.parse(x.end) - Date.parse(x.start)) / 60000, 0);
                    return (
                      <div key={b.id} className="cal-barber">
                        {b.photoUrl ? (
                          <img className="cal-av" src={b.photoUrl} alt="" style={{ borderColor: colorOf(b.id) }} />
                        ) : (
                          <span className="cal-av" style={{ borderColor: colorOf(b.id) }}>
                            {(b.name || b.initials).trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="cal-barber-txt">
                          <b>{b.name}</b>
                          <span className="muted small">{list.length ? `${countText(list.length)} · ${durText(mins)}` : 'nicio programare'}</span>
                        </span>
                      </div>
                    );
                  })}
            </div>
            <div className="cal-body" style={{ gridTemplateColumns: grid, height }}>
              <div className="cal-times">
                {/* Ora pe fiecare linie a pasului (ca în aplicație); orele fixe mai vizibile. */}
                {/* Ora de lângă linia de acum nu se mai scrie, ca să nu se suprapună. */}
                {Array.from({ length: Math.floor((endMin - startMin) / step) + 1 }, (_, i) =>
                  i > 0 && nowIn && Math.abs(startMin + i * step - nowMin) < 8 ? null : (
                    <span key={i} className={(i * step) % 60 ? '' : 'hour'} style={{ top: i * step * PX }}>
                      {hm(startMin + i * step)}
                    </span>
                  ),
                )}
                {nowIn ? (
                  <span className="cal-now-label" style={{ top: (nowMin - startMin) * PX }}>
                    {hm(nowMin)}
                  </span>
                ) : null}
              </div>
              {week
                ? days.map((d) => {
                    const wd = weekdayOf(d);
                    return column(
                      d,
                      d,
                      single,
                      cols.flatMap((b) => b.hours.filter((h) => h.weekday === wd)),
                      shown.filter((x) => dayOf(x.start) === d),
                      cols.length > 1,
                    );
                  })
                : cols.map((b) =>
                    column(
                      b.id,
                      day,
                      b.id,
                      b.hours.filter((h) => h.weekday === weekdayOf(day)),
                      shown.filter((x) => x.barberId === b.id),
                      false,
                    ),
                  )}
              {!week && nowIn ? <div className="cal-now span" style={{ top: (nowMin - startMin) * PX }} /> : null}
            </div>
          </div>
        </div>
      )}

      {(bookings.data ?? []).some((b) => b.status === 'cancelled') ? (
        <details style={{ marginTop: 14 }}>
          <summary className="muted">{week ? 'Anulate în această săptămână' : 'Anulate în această zi'}</summary>
          {(bookings.data ?? [])
            .filter((b) => b.status === 'cancelled')
            .map((b) => (
              <div key={b.id} className="small muted" style={{ padding: '4px 0' }}>
                {week ? `${date(b.start)} ` : ''}
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
          day={create.day ?? day}
          initial={create}
          onClose={() => setCreate(null)}
          onDone={(d) => {
            setCreate(null);
            if (!days.includes(d)) setDay(d);
            else reload();
          }}
        />
      ) : null}
    </>
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
  initial: { barberId?: string; time?: string; outside?: boolean };
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
  const [force, setForce] = useState(!!initial.outside);
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
