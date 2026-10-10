import { useState } from 'react';
import { api, type Me, type Service } from '../api';
import { emptyTr, Field, ImagePicker, Loading, Modal, TranslationFields, useAction, useLoad } from '../ui';
import { lei } from '../util';

export function ServicesPage(_: { me: Me }) {
  const list = useLoad(() => api<Service[]>('GET', '/admin/services'));
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
                  <td>{s.durationMin} min</td>
                  <td>{lei(s.price)}</td>
                  <td>{s.sort}</td>
                  <td>{s.active ? null : <span className="pill off">ascuns</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit ? (
        <ServiceModal
          s={edit}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            list.reload();
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
  const body = {
    name: v.name,
    description: v.description ?? '',
    durationMin: Number(v.durationMin),
    price: Number(v.price),
    color: v.color,
    imageUrl: v.imageUrl || null,
    sort: Number(v.sort) || 0,
    active: v.active !== false,
    translations: tr,
  };

  return (
    <Modal title={s.id ? 'Editează serviciul' : 'Serviciu nou'} onClose={onClose}>
      <div className="grid">
        <Field label="Nume">
          <input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </Field>
        <Field label="Descriere">
          <textarea value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid two">
          <Field label="Durată (minute)">
            <input type="number" min={5} step={5} value={v.durationMin ?? ''} onChange={(e) => set({ durationMin: Number(e.target.value) })} />
          </Field>
          <Field label="Preț (lei)">
            <input type="number" min={0} step={1} value={v.price ?? ''} onChange={(e) => set({ price: Number(e.target.value) })} />
          </Field>
          <Field label="Culoare în aplicație">
            <input type="color" value={v.color ?? '#3D4BE0'} onChange={(e) => set({ color: e.target.value })} style={{ height: 40, padding: 4 }} />
          </Field>
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
        <Field label="Poză (opțional)">
          <ImagePicker value={v.imageUrl ?? null} onChange={(imageUrl) => set({ imageUrl })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={v.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Vizibil în aplicație
        </label>
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
