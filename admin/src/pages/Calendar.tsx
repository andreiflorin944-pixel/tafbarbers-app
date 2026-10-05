import { useEffect, useMemo, useState } from 'react';
import { api, type Barber, type Booking, type Me, type Service, type Slot, type TimeOff } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { addDays, dayOf, hm, lei, localToIso, longDate, minutesOf, STATUS, time, today } from '../util';

const PX = 1.2; // pixeli pe minut

type Stats = {
  upcoming: number;
  last30: { bookings: number; revenue: number | null; cancelled: number; noShow: number; newClients: number | null };
};

export function CalendarPage({ me }: { me: Me }) {
  const [day, setDay] = useState(today());
  const [open, setOpen] = useState<Booking | null>(null);
  const [create, setCreate] = useState<{ barberId?: string; time?: string } | null>(null);

  const meta = useLoad(() => Promise.all([api<Barber[]>('GET', '/admin/barbers'), api<Service[]>('GET', '/admin/services')]));
  const stats = useLoad(() => api<Stats>('GET', '/admin/stats'));
  const from = localToIso(day, '00:00');
  const to = localToIso(addDays(day, 1), '00:00');
  const bookings = useLoad(() => api<Booking[]>('GET', `/admin/bookings?from=${from}&to=${to}`), [day]);
  const off = useLoad(() => api<TimeOff[]>('GET', `/admin/time-off?from=${from}`), [day]);

  const [barbers, services] = meta.data ?? [[], []];
  const own = me.permissions.bookings_all ? null : me.barberId;
  const cols = barbers.filter((b) => b.active && (!own || b.id === own));
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
  };

  return (
    <>
      <div className="head">
        <h1>Programări</h1>
        {me.permissions.bookings_create ? <button onClick={() => setCreate({})}>+ Programare nouă</button> : null}
      </div>

      {stats.data ? (
        <div className="grid stats">
          <Stat v={stats.data.upcoming} l="programări viitoare" />
          <Stat v={stats.data.last30.bookings} l="programări, ultimele 30 de zile" />
          {stats.data.last30.revenue !== null ? <Stat v={lei(stats.data.last30.revenue)} l="valoare, ultimele 30 de zile" /> : null}
          {stats.data.last30.newClients !== null ? <Stat v={stats.data.last30.newClients} l="clienți noi, 30 de zile" /> : null}
          <Stat v={stats.data.last30.cancelled + stats.data.last30.noShow} l="anulări și neprezentări" />
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
        <span className="muted small">{(bookings.data ?? []).filter((b) => b.status !== 'cancelled').length} programări</span>
      </div>

      {!meta.data || !bookings.data ? (
        <Loading error={meta.error || bookings.error} />
      ) : !cols.length ? (
        <p className="muted">Nu există frizeri activi. Adaugă unul în „Frizeri și program”.</p>
      ) : (
        <div className="table-wrap">
          <div className="cal" style={{ minWidth: 60 + cols.length * 160 }}>
            <div className="cal-head" style={{ gridTemplateColumns: `60px repeat(${cols.length}, 1fr)` }}>
              <div />
              {cols.map((b) => (
                <div key={b.id}>{b.name}</div>
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
                      if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('cal-off') && !(e.target as HTMLElement).classList.contains('cal-line')) return;
                      const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                      const m = Math.floor((startMin + y / PX) / 15) * 15;
                      if (me.permissions.bookings_create) setCreate({ barberId: b.id, time: hm(m) });
                    }}
                    title="Click pe o zonă liberă pentru programare nouă"
                  >
                    {Array.from({ length: (endMin - startMin) / 30 }, (_, i) => (
                      <div key={i} className="cal-line" style={{ top: i * 30 * PX }} />
                    ))}
                    {gaps.map(([s, e], i) => (
                      <div key={i} className="cal-off" style={{ top: (s - startMin) * PX, height: (e - s) * PX }} />
                    ))}
                    {nowMin >= startMin && nowMin <= endMin ? <div className="cal-now" style={{ top: (nowMin - startMin) * PX }} /> : null}
                    {(bookings.data ?? [])
                      .filter((x) => x.barberId === b.id && x.status !== 'cancelled')
                      .map((x) => {
                        const s = minutesOf(x.start);
                        const len = (Date.parse(x.end) - Date.parse(x.start)) / 60000;
                        return (
                          <div
                            key={x.id}
                            className={`cal-ev ${x.status}`}
                            style={{ top: (s - startMin) * PX + 1, height: Math.max(len * PX - 2, 22) }}
                            onClick={() => setOpen(x)}
                          >
                            <b>
                              {time(x.start)} {x.clientName || x.clientPhone}
                            </b>
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
              </div>
            ))}
        </details>
      ) : null}

      {open ? <BookingModal b={open} canManage={me.permissions.bookings_manage} onClose={() => setOpen(null)} onChange={reload} /> : null}
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

function BookingModal({ b, canManage, onClose, onChange }: { b: Booking; canManage: boolean; onClose: () => void; onChange: () => void }) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState(b.note);
  const set = (patch: Record<string, string>) =>
    run(async () => {
      await api('PATCH', `/admin/bookings/${b.id}`, patch);
      onChange();
      onClose();
    });
  const past = Date.parse(b.start) < Date.now();

  return (
    <Modal title={`${time(b.start)} · ${b.serviceName}`} onClose={onClose}>
      <div className="grid" style={{ gap: 8 }}>
        <div>
          <strong>{b.clientName || 'Client fără nume'}</strong> ·{' '}
          <a href={`tel:${b.clientPhone}`}>{b.clientPhone}</a>
        </div>
        <div className="muted">
          {longDate(b.start)}, {time(b.start)}–{time(b.end)} · cu {b.barberName} · {lei(b.price)}
        </div>
        <div>
          <span className={`pill ${b.status}`}>{STATUS[b.status]}</span>{' '}
          <span className="muted small">{b.source === 'admin' ? 'adăugată din panou' : 'din aplicație'}</span>
        </div>
        <Field label="Notiță internă">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!canManage} />
        </Field>
        {error ? <div className="err">{error}</div> : null}
        <div className="row" style={{ display: canManage ? undefined : 'none' }}>
          {note !== b.note ? (
            <button disabled={busy} onClick={() => set({ note })}>
              Salvează notița
            </button>
          ) : null}
          {b.status === 'confirmed' && past ? (
            <>
              <button disabled={busy} onClick={() => set({ status: 'completed' })}>
                Finalizată
              </button>
              <button className="ghost" disabled={busy} onClick={() => set({ status: 'no_show' })}>
                Nu s-a prezentat
              </button>
            </>
          ) : null}
          {b.status !== 'confirmed' && b.status !== 'cancelled' ? (
            <button className="ghost" disabled={busy} onClick={() => set({ status: 'confirmed' })}>
              Readu la confirmată
            </button>
          ) : null}
          {b.status === 'confirmed' ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() => confirm('Anulezi programarea? Clientul primește SMS.') && set({ status: 'cancelled' })}
            >
              Anulează
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
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
  const { busy, error, run } = useAction();

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
        phone,
        name,
        serviceId,
        barberId,
        start: force ? localToIso(day, forceTime) : start,
        force,
        notify,
      });
      onDone(day);
    });

  const ok = phone.trim().length >= 9 && serviceId && barberId && (force ? !!forceTime : !!start);

  return (
    <Modal title="Programare nouă" onClose={onClose}>
      <div className="grid">
        <div className="grid two">
          <Field label="Telefon client">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" autoFocus />
          </Field>
          <Field label="Nume (pentru client nou)">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
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
              <div className="slots">
                {slots.map((s) => (
                  <button key={s.start} type="button" className={s.start === start ? 'on' : ''} onClick={() => setStart(s.start)}>
                    {time(s.start)}
                  </button>
                ))}
              </div>
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
