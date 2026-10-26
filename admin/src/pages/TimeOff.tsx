import { useState } from 'react';
import { barberColor } from './Calendar';
import { api, BLOCK_KINDS, blockKind, type Barber, type Block, type BlockKind, type Booking, type Me, type TimeOff } from '../api';
import { AffectedBookings } from './AffectedBookings';
import { Field, Loading, useAction, useLoad } from '../ui';
import { addDays, date, dayOf, time, today, WEEKDAYS } from '../util';

/**
 * Cine poate șterge o perioadă liberă sau un bloc, după regula serverului (aceeași și în aplicația echipei): proprietarul orice;
 * un cont legat de un frizer doar pe ale lui; un administrator fără frizer, cu „toate programările”, orice.
 */
const canEditOff = (me: Me, barberId: string | null) => me.owner || (me.barberId ? barberId === me.barberId : me.permissions.bookings_all);

/** Pauze, ore pentru membri și concedii: blocurile din program sus, zilele libere întregi jos. */
export function TimeOffPage({ me }: { me: Me }) {
  return (
    <>
      <div className="head">
        <h1>Pauze, ore speciale și concedii</h1>
      </div>
      <BlocksSection me={me} />
      <TimeOffSection me={me} />
    </>
  );
}

function TimeOffSection({ me }: { me: Me }) {
  const data = useLoad(() => Promise.all([api<TimeOff[]>('GET', '/admin/time-off'), api<Barber[]>('GET', '/admin/barbers')]));
  const [list, barbers] = data.data ?? [[], []];
  const [barberId, setBarberId] = useState(me.barberId ?? '');
  const [fromDay, setFromDay] = useState(today());
  const [toDay, setToDay] = useState(today());
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  // Condica se reîncarcă după fiecare adăugare sau ștergere.
  const [ver, setVer] = useState(0);
  const reload = () => {
    data.reload();
    setVer((v) => v + 1);
  };

  // Programările deja făcute în zilele libere: se arată imediat, ca să fie anulate sau păstrate.
  const [affected, setAffected] = useState<Booking[]>([]);
  const add = () =>
    run(async () => {
      const r = await api<{ affected?: Booking[] }>('POST', '/admin/time-off', { barberId: barberId || null, fromDay, toDay, reason });
      setReason('');
      setAffected(r.affected ?? []);
      reload();
    });

  const nameOf = (id: string | null) => (id ? (barbers.find((b) => b.id === id)?.name ?? '?') : 'Tot salonul');
  const fullDays = (t: TimeOff) => time(t.start) === '00:00' && time(t.end) === '00:00';

  return (
    <>
      <h2 style={{ marginTop: 28 }}>Concedii și zile libere</h2>
      <div className="card grid" style={{ marginBottom: 18, maxWidth: 640 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Zile întregi în care aplicația nu mai oferă ore (concediu, sărbătoare, salon închis). Pentru câteva ore dintr-o zi folosește blocurile de mai sus. Dacă sunt
          deja programări în acele zile, ți le arătăm imediat, ca să le anulezi (clientul primește mesaj) sau să le păstrezi.
        </p>
        <Field label="Cine">
          <select value={barberId} onChange={(e) => setBarberId(e.target.value)} disabled={!me.owner && !!me.barberId}>
            {me.owner || !me.barberId ? <option value="">Tot salonul (închis)</option> : null}
            {barbers
              .filter((b) => b.active && (me.owner || !me.barberId || b.id === me.barberId))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </Field>
        <div className="grid two">
          <Field label="Din ziua">
            <input
              type="date"
              value={fromDay}
              onChange={(e) => {
                setFromDay(e.target.value);
                if (e.target.value > toDay) setToDay(e.target.value);
              }}
            />
          </Field>
          <Field label="Până în ziua (inclusiv)">
            <input type="date" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} />
          </Field>
        </div>
        <Field label="Motiv (opțional, doar pentru voi)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Concediu, sărbătoare, curs…" />
        </Field>
        {error ? <div className="err">{error}</div> : null}
        <div>
          <button disabled={busy} onClick={add}>
            Adaugă zilele libere
          </button>
        </div>
      </div>

      {affected.length ? <AffectedBookings list={affected} what="Zilele libere au fost adăugate." onClose={() => setAffected([])} /> : null}
      {me.owner || me.permissions.bookings_all ? <LeavePlanner barbers={barbers} ver={ver} /> : null}

      {!data.data ? (
        <Loading error={data.error} />
      ) : list.length === 0 ? (
        <p className="muted">Nicio perioadă liberă programată.</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Cine</th>
                <th>Perioada</th>
                <th>Motiv</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{nameOf(t.barberId)}</td>
                  <td>
                    {fullDays(t)
                      ? `${date(t.start)} – ${date(new Date(Date.parse(t.end) - 60_000))}`
                      : `${date(t.start)}, ${time(t.start)}–${time(t.end)}`}
                  </td>
                  <td className="muted">{t.reason}</td>
                  <td>
                    {canEditOff(me, t.barberId) ? (
                      <button
                        className="danger sm"
                        onClick={() =>
                          confirm('Ștergi perioada liberă?') &&
                          api('DELETE', `/admin/time-off/${t.id}`).then(reload)
                        }
                      >
                        Șterge
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const STICKY = { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, whiteSpace: 'nowrap' } as const;

/**
 * Condica de concedii pe o lună: un rând pe frizer, o coloană pe zi; zilele libere colorate (cu perioada și motivul la mouse),
 * zilele cu tot salonul închis hașurate pe toate rândurile. O văd proprietarul și cine vede programările tuturor.
 */
function LeavePlanner({ barbers, ver }: { barbers: Barber[]; ver: number }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const days = Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => addDays(first, i));
  const last = days[days.length - 1];
  // Tot ce se termină după începutul lunii (cu o zi în plus, pentru fusul orar); ce începe după ea se sare mai jos.
  const data = useLoad(() => api<TimeOff[]>('GET', `/admin/time-off?from=${encodeURIComponent(new Date(Date.UTC(y, m - 1, 0)).toISOString())}`), [month, ver]);
  const shift = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));

  // Pentru fiecare perioadă: zilele locale pe care le acoperă (zi întreagă sau doar câteva ore din ea).
  type Mark = { full: boolean; title: string };
  const marks = new Map<string, Map<string, Mark>>();
  for (const t of data.data ?? []) {
    const full = time(t.start) === '00:00' && time(t.end) === '00:00';
    const endAt = new Date(Date.parse(t.end) - 60_000);
    const s = dayOf(t.start);
    const e = dayOf(endAt);
    if (e < first || s > last) continue;
    const period = full ? (s === e ? date(t.start) : `${date(t.start)} – ${date(endAt)}`) : `${date(t.start)}, ${time(t.start)}–${time(t.end)}`;
    const title = t.reason ? `${period} · ${t.reason}` : period;
    const key = t.barberId ?? '';
    if (!marks.has(key)) marks.set(key, new Map());
    for (let d = s < first ? first : s; d <= e && d <= last; d = addDays(d, 1)) marks.get(key)!.set(d, { full, title });
  }
  const salon = marks.get('') ?? new Map<string, Mark>();
  const rows = barbers.filter((b) => b.active || marks.has(b.id));
  const weekend = (d: string) => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay());
  const now = today();

  const cell = (d: string, mk: Mark | undefined, color: string) => (
    <td
      key={d}
      title={mk?.title}
      style={{
        padding: 0,
        height: 30,
        minWidth: 26,
        borderLeft: '1px solid rgba(127,127,127,.15)',
        background: mk
          ? mk.full
            ? color
            : `linear-gradient(to top, ${color} 45%, transparent 45%)`
          : salon.has(d)
            ? 'repeating-linear-gradient(45deg, rgba(127,127,127,.3), rgba(127,127,127,.3) 4px, transparent 4px, transparent 8px)'
            : weekend(d)
              ? 'rgba(127,127,127,.08)'
              : undefined,
      }}
    />
  );

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <b>Condica de concedii</b>
        <span className="row" style={{ gap: 6 }}>
          <button className="ghost sm" onClick={() => shift(-1)} aria-label="Luna trecută">
            ‹
          </button>
          <span style={{ minWidth: 130, textAlign: 'center' }}>
            {MONTHS[m - 1]} {y}
          </span>
          <button className="ghost sm" onClick={() => shift(1)} aria-label="Luna următoare">
            ›
          </button>
        </span>
      </div>
      {!data.data ? (
        <Loading error={data.error} />
      ) : (
        <div className="table-wrap">
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={STICKY} />
                {days.map((d) => (
                  <th key={d} className="small" style={{ padding: '2px 0', textAlign: 'center', fontWeight: d === now ? 800 : 500, opacity: weekend(d) ? 0.6 : 1 }}>
                    {Number(d.slice(8))}
                  </th>
                ))}
                <th className="small" title="Zile libere întregi în luna asta">
                  Zile
                </th>
              </tr>
            </thead>
            <tbody>
              {salon.size ? (
                <tr>
                  <td style={STICKY} className="muted">
                    Tot salonul
                  </td>
                  {days.map((d) => cell(d, salon.get(d), 'rgba(127,127,127,.45)'))}
                  <td className="small muted">{[...salon.values()].filter((x) => x.full).length || ''}</td>
                </tr>
              ) : null}
              {rows.map((b) => {
                const own = marks.get(b.id);
                return (
                  <tr key={b.id}>
                    <td style={STICKY}>{b.name}</td>
                    {days.map((d) => cell(d, own?.get(d), barberColor(b, barbers.indexOf(b))))}
                    <td className="small muted">{own ? [...own.values()].filter((x) => x.full).length || '' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Plin = zi liberă întreagă, jumătate = doar câteva ore, hașurat = salonul e închis. Ține mouse-ul pe o zi ca să vezi perioada și motivul.
      </p>
    </div>
  );
}

// Zilele în ordinea de la noi: luni întâi, duminica la sfârșit.
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'];

/** Blocuri în program: pauză de masă, liber, educațional, altceva și ore doar pentru membrii TAF Club. */
function BlocksSection({ me }: { me: Me }) {
  const data = useLoad(() => Promise.all([api<Block[]>('GET', '/admin/blocks'), api<Barber[]>('GET', '/admin/barbers')]));
  const [list, barbers] = data.data ?? [[], []];
  const active = barbers.filter((b) => b.active && (me.owner || !me.barberId || b.id === me.barberId));
  const [barberId, setBarberId] = useState(me.owner ? '' : (me.barberId ?? ''));
  const who = barberId;
  const [kind, setKind] = useState<BlockKind>('lunch');
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [day, setDay] = useState(today());
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('14:00');
  const [fromDay, setFromDay] = useState(today());
  const [untilDay, setUntilDay] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [affected, setAffected] = useState<Booking[]>([]);
  const { busy, error, run } = useAction();

  const add = () =>
    run(async () => {
      setMsg(null);
      const r = await api<{ block: Block; conflicts: number; affected?: Booking[] }>('POST', '/admin/blocks', {
        barberId: who || null,
        kind,
        label,
        repeat,
        ...(repeat ? { weekdays, fromDay, untilDay: untilDay || null } : { day }),
        start,
        end,
      });
      setLabel('');
      setMsg(
        r.conflicts
          ? `Adăugat. Atenție: ${r.conflicts === 1 ? 'o programare deja făcută se suprapune' : `${r.conflicts} programări deja făcute se suprapun`} cu blocul.`
          : 'Adăugat.',
      );
      setAffected(r.affected ?? []);
      data.reload();
    });

  const nameOf = (id: string | null) => (id ? (barbers.find((b) => b.id === id)?.name ?? '?') : 'Toți frizerii');
  const when = (b: Block) =>
    b.repeat
      ? `${WEEK.filter((d) => b.weekdays.includes(d)).map((d) => WEEKDAYS[d]).join(', ')}${b.fromDay && b.fromDay > today() ? `, din ${date(b.fromDay + 'T12:00:00Z')}` : ''}${b.untilDay ? `, până pe ${date(b.untilDay + 'T12:00:00Z')}` : ''}`
      : date(b.day + 'T12:00:00Z');
  const canDelete = (b: Block) => canEditOff(me, b.barberId);
  const help = blockKind(kind).help;

  return (
    <>
      {affected.length ? <AffectedBookings list={affected} what="Blocul a fost adăugat." onClose={() => setAffected([])} /> : null}
      <h2>Pauze și ore speciale</h2>
      <div className="card grid" style={{ marginBottom: 18, maxWidth: 640 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Blocuri în programul de lucru, o singură dată sau în fiecare săptămână. Apar și în calendar, cu culoarea tipului.
        </p>
        <Field label="Cine">
          <select value={who} onChange={(e) => setBarberId(e.target.value)} disabled={!me.owner && !!me.barberId}>
            {me.owner || !me.barberId ? <option value="">Toți frizerii</option> : null}
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Tip
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {BLOCK_KINDS.map((k) => (
              <button key={k.kind} type="button" className={`chip${kind === k.kind ? ' on' : ''}`} style={{ ['--c' as string]: k.color }} onClick={() => setKind(k.kind)} aria-pressed={kind === k.kind}>
                <span className="dot" style={{ background: k.color }} /> {k.label}
              </button>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {help}
          </div>
        </div>
        {kind === 'other' ? (
          <Field label="Nume (îl vedeți în calendar)">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ședință foto, inventar…" maxLength={60} />
          </Field>
        ) : null}
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button type="button" className={!repeat ? 'on' : ''} onClick={() => setRepeat(false)}>
            O singură dată
          </button>
          <button type="button" className={repeat ? 'on' : ''} onClick={() => setRepeat(true)}>
            În fiecare săptămână
          </button>
        </div>
        {repeat ? (
          <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {WEEK.map((d) => (
                <label key={d} className="check small">
                  <input
                    type="checkbox"
                    checked={weekdays.includes(d)}
                    onChange={(e) => setWeekdays(e.target.checked ? [...weekdays, d] : weekdays.filter((x) => x !== d))}
                  />{' '}
                  {SHORT[d]}
                </label>
              ))}
            </div>
            <div className="grid two">
              <Field label="Începând cu">
                <input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
              </Field>
              <Field label="Până pe (opțional, inclusiv)">
                <input type="date" value={untilDay} min={fromDay} onChange={(e) => setUntilDay(e.target.value)} />
              </Field>
            </div>
          </>
        ) : (
          <Field label="Ziua">
            <input type="date" value={day} min={today()} onChange={(e) => setDay(e.target.value)} />
          </Field>
        )}
        <div className="row">
          <Field label="De la">
            <input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Până la">
            <input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="small">{msg}</div> : null}
        <div>
          <button disabled={busy || (repeat && !weekdays.length) || (kind === 'other' && !label.trim())} onClick={add}>
            Adaugă blocul
          </button>
        </div>
      </div>

      {!data.data ? (
        <Loading error={data.error} />
      ) : list.length === 0 ? (
        <p className="muted">Niciun bloc în program.</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Cine</th>
                <th>Tip</th>
                <th>Când</th>
                <th>Ore</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td>{nameOf(b.barberId)}</td>
                  <td>
                    <span className="dot" style={{ background: blockKind(b.kind).color, marginRight: 6 }} />
                    {b.label}
                  </td>
                  <td>{when(b)}</td>
                  <td>
                    {b.start}–{b.end}
                  </td>
                  <td>
                    {canDelete(b) ? (
                      <button className="danger sm" onClick={() => confirm('Ștergi blocul? Orele redevin libere.') && api('DELETE', `/admin/blocks/${b.id}`).then(data.reload)}>
                        Șterge
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
