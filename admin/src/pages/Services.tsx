import { useState } from 'react';
import { api, type Barber, type Me, type Service } from '../api';
import { emptyTr, Field, ImagePicker, Loading, Modal, TranslationFields, useAction, useLoad } from '../ui';
import { lei } from '../util';

export function ServicesPage(_: { me: Me }) {
  const list = useLoad(() => api<Service[]>('GET', '/admin/services'));
  // „Extra fără timp” (ex. Spălat, Ceară pe față): listă separată, se pun doar pe o programare.
  const addons = useLoad(() => api<Service[]>('GET', '/admin/services?addons=1'));
  // Prețurile și duratele proprii ale frizerilor (Frizeri → servicii): le arătăm aici, ca să se vadă de ce aplicația
  // arată alt preț la un frizer. Un preț propriu nu se schimbă când schimbi prețul standard.
  const barbers = useLoad(() => api<Barber[]>('GET', '/admin/barbers'));
  const own = (s: Service, kind: 'prices' | 'durations') =>
    (barbers.data ?? [])
      .filter((b) => b.active && (!b.serviceIds?.length || b.serviceIds.includes(s.id)) && b[kind]?.[s.id] != null && b[kind]![s.id] !== (kind === 'prices' ? s.price : s.durationMin))
      .map((b) => `${b.name}: ${kind === 'prices' ? lei(b[kind]![s.id]!) : `${b[kind]![s.id]} min`}`);
  const [edit, setEdit] = useState<Partial<Service> | null>(null);

  return (
    <>
      <div className="head">
        <h1>Servicii</h1>
        <button onClick={() => setEdit({ durationMin: 30, price: 50, color: '#3D4BE0', sort: (list.data?.length ?? 0) + 1, active: true })}>
          + Serviciu nou
        </button>
      </div>
      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Serviciu</th>
                <th>Durată</th>
                <th>Preț</th>
                <th>Ordine</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                  <td>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 8 }} />
                    {s.name}
                    {s.description ? <div className="muted small">{s.description}</div> : null}
                  </td>
                  <td>
                    {s.durationMin} min
                    {own(s, 'durations').length ? <div className="muted small">{own(s, 'durations').join(' · ')}</div> : null}
                  </td>
                  <td>
                    {lei(s.price)}
                    {own(s, 'prices').length ? <div className="muted small">{own(s, 'prices').join(' · ')}</div> : null}
                  </td>
                  <td>{s.sort}</td>
                  <td>
                    {s.active ? null : <span className="pill off">ascuns</span>} {s.membersOnly ? <span className="pill confirmed">TAF Club</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="head" style={{ marginTop: 28 }}>
        <div>
          <h2 style={{ margin: 0 }}>Extra fără timp</h2>
          <div className="muted small">
            Ex. Spălat, Ceară pe față. Se adaugă la o programare (din calendar, din aplicația echipei sau de client la rezervare): prețul se adună, timpul nu.
            Prețul diferit pe frizer se pune la Frizeri.
          </div>
        </div>
        <button onClick={() => setEdit({ addon: true, durationMin: 0, price: 10, color: '#C9A227', sort: (addons.data?.length ?? 0) + 1, active: true })}>+ Extra nou</button>
      </div>
      {!addons.data ? (
        <Loading error={addons.error} />
      ) : addons.data.length ? (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Extra</th>
                <th>Preț</th>
                <th>Ordine</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {addons.data.map((s) => (
                <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                  <td>
                    {s.name}
                    {s.description ? <div className="muted small">{s.description}</div> : null}
                  </td>
                  <td>
                    {lei(s.price)}
                    {own(s, 'prices').length ? <div className="muted small">{own(s, 'prices').join(' · ')}</div> : null}
                  </td>
                  <td>{s.sort}</td>
                  <td>{s.active ? null : <span className="pill off">ascuns</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card muted">Încă nu ai extra fără timp. Apasă „+ Extra nou” (ex. Spălat, 10 lei).</div>
      )}
      {edit ? (
        <ServiceModal
          s={edit}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            list.reload();
            addons.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ServiceModal({ s, onClose, onDone }: { s: Partial<Service>; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ ...s });
  const [tr, setTr] = useState(s.translations ?? emptyTr());
  const { busy, error, run } = useAction();
  const set = (patch: Partial<Service>) => setV((x) => ({ ...x, ...patch }));
  const addon = !!s.addon;
  const body = {
    name: v.name,
    description: v.description ?? '',
    durationMin: Number(v.durationMin),
    price: Number(v.price),
    color: v.color,
    imageUrl: v.imageUrl || null,
    sort: Number(v.sort) || 0,
    active: v.active !== false,
    membersOnly: !!v.membersOnly,
    translations: tr,
    ...(addon && { durationMin: 0, addon: true, membersOnly: false }),
  };

  return (
    <Modal title={addon ? (s.id ? 'Editează extra' : 'Extra nou (fără timp)') : s.id ? 'Editează serviciul' : 'Serviciu nou'} onClose={onClose}>
      <div className="grid">
        <Field label="Nume">
          <input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </Field>
        <Field label="Descriere">
          <textarea value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid two">
          {addon ? null : (
            <Field label="Durată (minute)">
              <input type="number" min={5} step={5} value={v.durationMin ?? ''} onChange={(e) => set({ durationMin: Number(e.target.value) })} />
            </Field>
          )}
          <Field label="Preț (lei)">
            <input type="number" min={0} step={1} value={v.price ?? ''} onChange={(e) => set({ price: Number(e.target.value) })} />
          </Field>
          {addon ? null : (
            <Field label="Culoare în aplicație">
              <input type="color" value={v.color ?? '#3D4BE0'} onChange={(e) => set({ color: e.target.value })} style={{ height: 40, padding: 4 }} />
            </Field>
          )}
          <Field label="Ordine în listă">
            <input type="number" value={v.sort ?? 0} onChange={(e) => set({ sort: Number(e.target.value) })} />
          </Field>
        </div>
        <TranslationFields
          fields={[
            { key: 'name', label: 'Nume' },
            { key: 'description', label: 'Descriere', multiline: true },
          ]}
          ro={{ name: v.name, description: v.description }}
          initialRo={{ name: s.name, description: s.description }}
          value={tr}
          onChange={setTr}
        />
        {addon ? (
          <div className="muted small">Nu are durată: se adaugă la o programare și doar prețul se adună. Clientul îl poate alege la rezervare dacă e vizibil.</div>
        ) : (
          <Field label="Poză (opțional)">
            <ImagePicker value={v.imageUrl ?? null} onChange={(imageUrl) => set({ imageUrl })} />
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={v.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Vizibil în aplicație
        </label>
        <label className="check" style={addon ? { display: 'none' } : undefined}>
          <input type="checkbox" checked={!!v.membersOnly} onChange={(e) => set({ membersOnly: e.target.checked })} /> Doar pentru membrii TAF Club
        </label>
        {v.membersOnly ? (
          <div className="muted small" style={{ marginTop: -6 }}>
            Serviciul apare în aplicație doar clienților cu abonament activ sau marcați ca membri TAF Club în fișa lor. În panou îl vedeți toți.
          </div>
        ) : null}
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (s.id) await api('PATCH', `/admin/services/${s.id}`, body);
                else await api('POST', '/admin/services', body);
                onDone();
              })
            }
          >
            Salvează
          </button>
          {s.id ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm('Ștergi serviciul? Dacă are programări în istoric, doar se ascunde.') &&
                run(async () => {
                  await api('DELETE', `/admin/services/${s.id}`);
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
