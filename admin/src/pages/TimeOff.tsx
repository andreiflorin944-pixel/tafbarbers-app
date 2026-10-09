import { useState } from 'react';
import { api, BLOCK_KINDS, blockKind, type Barber, type Block, type BlockKind, type Me, type TimeOff } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { date, time, today, WEEKDAYS } from '../util';

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

  const add = () =>
    run(async () => {
      await api('POST', '/admin/time-off', { barberId: barberId || null, fromDay, toDay, reason });
      setReason('');
      data.reload();
    });

  const nameOf = (id: string | null) => (id ? (barbers.find((b) => b.id === id)?.name ?? '?') : 'Tot salonul');
  const fullDays = (t: TimeOff) => time(t.start) === '00:00' && time(t.end) === '00:00';

  return (
    <>
      <h2 style={{ marginTop: 28 }}>Concedii și zile libere</h2>
      <div className="card grid" style={{ marginBottom: 18, maxWidth: 640 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Zile întregi în care aplicația nu mai oferă ore (concediu, sărbătoare, salon închis). Pentru câteva ore dintr-o zi folosește blocurile de mai sus. Programările
          deja făcute rămân; verifică-le în calendar.
        </p>
        <Field label="Cine">
          <select value={barberId} onChange={(e) => setBarberId(e.target.value)} disabled={!!me.barberId}>
            {!me.barberId ? <option value="">Tot salonul (închis)</option> : null}
            {barbers
              .filter((b) => b.active && (!me.barberId || b.id === me.barberId))
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
                    <button
                      className="danger sm"
                      onClick={() =>
                        confirm('Ștergi perioada liberă?') &&
                        api('DELETE', `/admin/time-off/${t.id}`).then(data.reload)
                      }
                    >
                      Șterge
                    </button>
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
  const { busy, error, run } = useAction();

  const add = () =>
    run(async () => {
      setMsg(null);
      const r = await api<{ block: Block; conflicts: number }>('POST', '/admin/blocks', {
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
          ? `Adăugat. Atenție: ${r.conflicts === 1 ? 'o programare deja făcută se suprapune' : `${r.conflicts} programări deja făcute se suprapun`} cu blocul. Ele rămân; verifică-le în calendar.`
          : 'Adăugat.',
      );
      data.reload();
    });

  const nameOf = (id: string | null) => (id ? (barbers.find((b) => b.id === id)?.name ?? '?') : 'Toți frizerii');
  const when = (b: Block) =>
    b.repeat
      ? `${WEEK.filter((d) => b.weekdays.includes(d)).map((d) => WEEKDAYS[d]).join(', ')}${b.fromDay && b.fromDay > today() ? `, din ${date(b.fromDay + 'T12:00:00Z')}` : ''}${b.untilDay ? `, până pe ${date(b.untilDay + 'T12:00:00Z')}` : ''}`
      : date(b.day + 'T12:00:00Z');
  const canDelete = (b: Block) => me.owner || !me.barberId || b.barberId === me.barberId;
  const help = blockKind(kind).help;

  return (
    <>
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
