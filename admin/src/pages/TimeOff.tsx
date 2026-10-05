import { useState } from 'react';
import { api, type Barber, type Me, type TimeOff } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { date, localToIso, time, today } from '../util';

export function TimeOffPage({ me }: { me: Me }) {
  const data = useLoad(() => Promise.all([api<TimeOff[]>('GET', '/admin/time-off'), api<Barber[]>('GET', '/admin/barbers')]));
  const [list, barbers] = data.data ?? [[], []];
  const [barberId, setBarberId] = useState(me.barberId ?? '');
  const [fromDay, setFromDay] = useState(today());
  const [toDay, setToDay] = useState(today());
  const [partial, setPartial] = useState(false);
  const [fromTime, setFromTime] = useState('12:00');
  const [toTime, setToTime] = useState('14:00');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();

  const add = () =>
    run(async () => {
      const body = partial
        ? { barberId: barberId || null, start: localToIso(fromDay, fromTime), end: localToIso(fromDay, toTime), reason }
        : { barberId: barberId || null, fromDay, toDay, reason };
      await api('POST', '/admin/time-off', body);
      setReason('');
      data.reload();
    });

  const nameOf = (id: string | null) => (id ? (barbers.find((b) => b.id === id)?.name ?? '?') : 'Tot salonul');
  const fullDays = (t: TimeOff) => time(t.start) === '00:00' && time(t.end) === '00:00';

  return (
    <>
      <div className="head">
        <h1>Concedii și zile libere</h1>
      </div>
      <div className="card grid" style={{ marginBottom: 18, maxWidth: 640 }}>
        <h2 style={{ margin: 0 }}>Adaugă</h2>
        <p className="muted small" style={{ margin: 0 }}>
          În perioada asta aplicația nu mai oferă ore. Programările deja făcute rămân; verifică-le în calendar.
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
        <label className="check small">
          <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Doar câteva ore dintr-o zi
        </label>
        {partial ? (
          <div className="grid two">
            <Field label="Ziua">
              <input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
            </Field>
            <div className="row">
              <Field label="De la">
                <input type="time" step={900} value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
              </Field>
              <Field label="Până la">
                <input type="time" step={900} value={toTime} onChange={(e) => setToTime(e.target.value)} />
              </Field>
            </div>
          </div>
        ) : (
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
        )}
        <Field label="Motiv (opțional, doar pentru voi)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Concediu, sărbătoare, curs…" />
        </Field>
        {error ? <div className="err">{error}</div> : null}
        <div>
          <button disabled={busy} onClick={add}>
            Adaugă
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
