import { useState } from 'react';
import { api, type Barber, type Hours, type Me, type Service } from '../api';
import { Field, ImagePicker, Loading, Modal, useAction, useLoad } from '../ui';
import { hm, parseHm, WEEKDAYS } from '../util';

// Luni primul, duminica la final.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function BarbersPage(_: { me: Me }) {
  const data = useLoad(() => Promise.all([api<Barber[]>('GET', '/admin/barbers'), api<Service[]>('GET', '/admin/services')]));
  const [edit, setEdit] = useState<Partial<Barber> | null>(null);
  const [barbers, services] = data.data ?? [[], []];

  return (
    <>
      <div className="head">
        <h1>Frizeri și program</h1>
        <button
          onClick={() =>
            setEdit({
              role: 'Barber',
              active: true,
              sort: barbers.length + 1,
              serviceIds: services.map((s) => s.id),
              hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: 600, end: 1200 })),
            })
          }
        >
          + Frizer nou
        </button>
      </div>
      {!data.data ? (
        <Loading error={data.error} />
      ) : (
        <div className="grid two">
          {barbers.map((b) => (
            <div key={b.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setEdit(b)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>{b.name}</h2>
                {b.active ? <span className="muted small">{b.role}</span> : <span className="pill off">inactiv</span>}
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                {ORDER.map((d) => {
                  const hs = b.hours.filter((h) => h.weekday === d);
                  return (
                    <div key={d} className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="muted">{WEEKDAYS[d]}</span>
                      <span>{hs.length ? hs.map((h) => `${hm(h.start)}–${hm(h.end)}`).join(', ') : 'liber'}</span>
                    </div>
                  );
                })}
              </div>
              <div className="muted small" style={{ marginTop: 8 }}>
                {b.serviceIds.length} din {services.length} servicii
              </div>
            </div>
          ))}
        </div>
      )}
      {edit ? (
        <BarberModal
          b={edit}
          services={services}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            data.reload();
          }}
        />
      ) : null}
    </>
  );
}

function BarberModal({ b, services, onClose, onDone }: { b: Partial<Barber>; services: Service[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(b.name ?? '');
  const [role, setRole] = useState(b.role ?? 'Barber');
  const [bio, setBio] = useState(b.bio ?? '');
  const [photoUrl, setPhotoUrl] = useState(b.photoUrl ?? '');
  const [active, setActive] = useState(b.active !== false);
  const [sort, setSort] = useState(b.sort ?? 0);
  const [svc, setSvc] = useState<string[]>(b.serviceIds ?? []);
  const [hours, setHours] = useState<Hours[]>(b.hours ?? []);
  const { busy, error, run } = useAction();

  const setInterval = (i: number, patch: Partial<Hours>) => setHours((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const save = () =>
    run(async () => {
      const body = { name, role, bio, photoUrl: photoUrl || null, active, sort, serviceIds: svc, hours };
      if (b.id) await api('PATCH', `/admin/barbers/${b.id}`, body);
      else await api('POST', '/admin/barbers', body);
      onDone();
    });

  return (
    <Modal title={b.id ? `Editează: ${b.name}` : 'Frizer nou'} onClose={onClose}>
      <div className="grid">
        <div className="grid two">
          <Field label="Nume">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Rol (ex. Barber, Senior Barber)">
            <input value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
        </div>
        <Field label="Despre (opțional)">
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} style={{ minHeight: 60 }} />
        </Field>
        <div className="grid two">
          <Field label="Poză (opțional)">
            <ImagePicker value={photoUrl || null} onChange={(u) => setPhotoUrl(u ?? '')} round maxPx={600} />
          </Field>
          <Field label="Ordine">
            <input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value))} />
          </Field>
        </div>

        <h2 style={{ marginTop: 6, marginBottom: 0 }}>Program săptămânal</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Pentru pauză, adaugă două intervale în aceeași zi (ex. 10:00–14:00 și 15:00–20:00).
        </p>
        <div>
          {ORDER.map((d) => {
            const idx = hours.map((h, i) => [h, i] as const).filter(([h]) => h.weekday === d);
            return (
              <div key={d} className="hours-row">
                <strong className="small">{WEEKDAYS[d]}</strong>
                <div>
                  {idx.length === 0 ? <span className="muted small">liber </span> : null}
                  {idx.map(([h, i]) => (
                    <div key={i} className="interval">
                      <input type="time" step={900} value={hm(h.start)} onChange={(e) => setInterval(i, { start: parseHm(e.target.value) })} />
                      <span>–</span>
                      <input type="time" step={900} value={hm(h.end)} onChange={(e) => setInterval(i, { end: parseHm(e.target.value) })} />
                      <button className="ghost sm" onClick={() => setHours((hs) => hs.filter((_, j) => j !== i))} aria-label="Șterge intervalul">
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    className="link small"
                    onClick={() => {
                      const last = idx.at(-1)?.[0];
                      setHours((hs) => [...hs, last ? { weekday: d, start: Math.min(last.end + 60, 1380), end: Math.min(last.end + 240, 1440) } : { weekday: d, start: 600, end: 1200 }]);
                    }}
                  >
                    + interval
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <h2 style={{ marginTop: 6, marginBottom: 0 }}>Servicii pe care le face</h2>
        <div className="grid">
          {services.map((s) => (
            <label key={s.id} className="check small">
              <input type="checkbox" checked={svc.includes(s.id)} onChange={(e) => setSvc((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
              {s.name}
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activ (apare în aplicație și primește programări)
        </label>
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          <button disabled={busy || !name.trim()} onClick={save}>
            Salvează
          </button>
          {b.id ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm('Ștergi frizerul? Dacă are programări în istoric, doar se dezactivează.') &&
                run(async () => {
                  await api('DELETE', `/admin/barbers/${b.id}`);
                  onDone();
                })
              }
            >
              Șterge
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
