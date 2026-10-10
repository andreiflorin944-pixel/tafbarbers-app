import { useState } from 'react';
import { api, ApiError, type Barber, type Hours, type Location, type Me, type Service } from '../api';
import { emptyTr, Field, ImagePicker, Loading, Modal, TranslationFields, useAction, useLoad } from '../ui';
import { hm, parseHm, WEEKDAYS } from '../util';
import { BARBER_PALETTE, barberColor } from './Calendar';

// Luni primul, duminica la final.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function BarbersPage(_: { me: Me }) {
  const data = useLoad(() =>
    Promise.all([api<Barber[]>('GET', '/admin/barbers'), api<Service[]>('GET', '/admin/services'), api<Location[]>('GET', '/admin/locations')]),
  );
  const [edit, setEdit] = useState<Partial<Barber> | null>(null);
  const [barbers, services, locations] = data.data ?? [[], [], []];
  // Locația se arată pe fișe doar când salonul are mai multe.
  const locName = (id: string | null) => (locations.length > 1 ? (locations.find((l) => l.id === id)?.name ?? '') : '');

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
              locationId: locations.find((l) => l.active)?.id ?? null,
              color: BARBER_PALETTE.find((c) => !barbers.some((x, i) => barberColor(x, i) === c)) ?? BARBER_PALETTE[0],
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
          {barbers.map((b, i) => (
            <div key={b.id} className="card" style={{ cursor: 'pointer', borderTop: `4px solid ${barberColor(b, i)}` }} onClick={() => setEdit({ ...b, color: barberColor(b, i) })}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>
                  <span className="dot" style={{ background: barberColor(b, i) }} /> {b.name}
                </h2>
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
                {locName(b.locationId) ? ` · ${locName(b.locationId)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit ? (
        <BarberModal
          b={edit}
          services={services}
          locations={locations}
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

function BarberModal({
  b,
  services,
  locations,
  onClose,
  onDone,
}: {
  b: Partial<Barber>;
  services: Service[];
  locations: Location[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [locationId, setLocationId] = useState(b.locationId ?? locations.find((l) => l.active)?.id ?? '');
  const [name, setName] = useState(b.name ?? '');
  const [role, setRole] = useState(b.role ?? 'Barber');
  const [bio, setBio] = useState(b.bio ?? '');
  const [tr, setTr] = useState(b.translations ?? emptyTr());
  const [photoUrl, setPhotoUrl] = useState(b.photoUrl ?? '');
  const [active, setActive] = useState(b.active !== false);
  const [sort, setSort] = useState(b.sort ?? 0);
  const [color, setColor] = useState(b.color ?? BARBER_PALETTE[0]);
  const [svc, setSvc] = useState<string[]>(b.serviceIds ?? []);
  const [hours, setHours] = useState<Hours[]>(b.hours ?? []);
  // Preț propriu pe serviciu, ca text; gol = prețul standard al serviciului.
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(Object.entries(b.prices ?? {}).map(([k, v]) => [k, String(v)])));
  // Durată proprie în minute, ca text; gol = durata standard.
  const [durs, setDurs] = useState<Record<string, string>>(Object.fromEntries(Object.entries(b.durations ?? {}).map(([k, v]) => [k, String(v)])));
  const { busy, error, run } = useAction();

  const setInterval = (i: number, patch: Partial<Hours>) => setHours((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const save = () =>
    run(async () => {
      const own = Object.fromEntries(
        services.map((s) => {
          const t = (prices[s.id] ?? '').trim().replace(',', '.');
          return [s.id, t === '' || Number(t) === s.price ? null : Number(t)];
        }),
      );
      if (Object.values(own).some((v) => v !== null && !(v >= 0))) throw new ApiError('invalid_price', 400);
      const ownDur = Object.fromEntries(
        services.map((s) => {
          const t = (durs[s.id] ?? '').trim();
          return [s.id, t === '' || Number(t) === s.durationMin ? null : Math.round(Number(t))];
        }),
      );
      if (Object.values(ownDur).some((v) => v !== null && !(v >= 5 && v <= 480))) throw new ApiError('invalid_duration', 400);
      const body = {
        name,
        role,
        bio,
        translations: tr,
        photoUrl: photoUrl || null,
        color,
        active,
        sort,
        serviceIds: svc,
        prices: own,
        durations: ownDur,
        hours,
        ...(locationId && { locationId }),
      };
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
        <TranslationFields
          fields={[
            { key: 'role', label: 'Rol' },
            { key: 'bio', label: 'Despre', multiline: true },
          ]}
          ro={{ role, bio }}
          initialRo={{ role: b.role, bio: b.bio }}
          value={tr}
          onChange={setTr}
        />
        <div className="grid two">
          <Field label="Poză (opțional)">
            <ImagePicker value={photoUrl || null} onChange={(u) => setPhotoUrl(u ?? '')} round maxPx={600} />
          </Field>
          <Field label="Ordine">
            <input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value))} />
          </Field>
        </div>

        <Field label="Locația în care lucrează">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.active ? '' : ' (dezactivată)'}
              </option>
            ))}
          </select>
          {b.id && b.locationId && locationId !== b.locationId && (
            <div className="muted small" style={{ marginTop: 4 }}>
              Programările lui viitoare se mută și ele în locația nouă (clienții văd adresa nouă în aplicație). Cele trecute rămân la locația veche.
            </div>
          )}
        </Field>

        <Field label="Culoarea în calendar">
          <div className="row" style={{ gap: 8 }}>
            <div className="swatches">
              {BARBER_PALETTE.map((c) => (
                <button key={c} type="button" className={c === color.toUpperCase() ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Culoarea ${c}`} />
              ))}
            </div>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} style={{ width: 48, height: 34, padding: 2 }} aria-label="Altă culoare" />
          </div>
        </Field>

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

        <h2 style={{ marginTop: 6, marginBottom: 0 }}>Servicii, prețuri și durate</h2>
        <p className="muted" style={{ margin: 0 }}>
          Bifează serviciile pe care le face. Lasă prețul sau durata goale ca să folosească valorile standard ale serviciului, sau scrie valori doar pentru acest frizer.
          Durata contează la orele libere din aplicație.
        </p>
        <div className="grid">
          {services.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 10 }}>
              <label className="check small" style={{ flex: 1 }}>
                <input type="checkbox" checked={svc.includes(s.id)} onChange={(e) => setSvc((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                {s.name}
              </label>
              <input
                aria-label={`Preț ${s.name}`}
                style={{ width: 110 }}
                inputMode="decimal"
                disabled={!svc.includes(s.id)}
                placeholder={`${s.price} lei`}
                value={prices[s.id] ?? ''}
                onChange={(e) => setPrices((p) => ({ ...p, [s.id]: e.target.value }))}
              />
              <input
                aria-label={`Durată ${s.name}`}
                style={{ width: 90 }}
                inputMode="numeric"
                disabled={!svc.includes(s.id)}
                placeholder={`${s.durationMin} min`}
                value={durs[s.id] ?? ''}
                onChange={(e) => setDurs((p) => ({ ...p, [s.id]: e.target.value.replace(/\D/g, '') }))}
              />
            </div>
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
