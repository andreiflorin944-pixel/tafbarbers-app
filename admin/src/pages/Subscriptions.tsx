import { useState } from 'react';
import { api, type Me, type Plan, type Service, type Subscription } from '../api';
import { emptyTr, Field, Loading, Modal, TranslationFields, useAction, useLoad } from '../ui';
import { date, lei } from '../util';

const STATE: Record<Subscription['state'], string> = {
  active: 'Activ',
  upcoming: 'Urmează',
  used_up: 'Tunsori epuizate',
  expired: 'Expirat',
  cancelled: 'Anulat',
};
const PILL: Record<Subscription['state'], string> = { active: 'completed', upcoming: 'confirmed', used_up: 'off', expired: 'off', cancelled: 'cancelled' };

const cuts = (n: number | null) => (n === null ? 'nelimitat' : `${n} ${n === 1 ? 'tunsoare' : 'tunsori'}`);
const used = (s: Subscription) => (s.cutsTotal === null ? `${s.cutsUsed} folosite (nelimitat)` : `${s.cutsUsed} din ${s.cutsTotal} folosite`);

/** Abonamentele din fișa clientului: istoric, activare după plata la salon și anulare (proprietarul). */
export function ClientSubscriptions({ clientId, subs, owner, onChange }: { clientId: string; subs: Subscription[]; owner: boolean; onChange: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planId, setPlanId] = useState('');
  const { busy, error, run } = useAction();
  const plan = plans?.find((p) => p.id === planId);
  return (
    <div className="grid">
      {subs.length === 0 ? <div className="muted small">Nu are abonament.</div> : null}
      {subs.map((s) => (
        <div key={s.id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '6px 0', gap: 8 }}>
          <span style={{ opacity: s.state === 'active' || s.state === 'upcoming' ? 1 : 0.6 }}>
            <b>{s.name}</b>
            <span className="muted">
              {' '}
              · {date(s.startsAt)} – {date(s.endsAt)} · {used(s)} · {lei(s.price)}
              {s.createdByName ? ` · activat de ${s.createdByName}` : ''}
            </span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className={`pill ${PILL[s.state]}`}>{STATE[s.state]}</span>
            {owner && (s.state === 'active' || s.state === 'upcoming') ? (
              <button
                className="ghost sm"
                disabled={busy}
                onClick={() =>
                  confirm(`Anulezi abonamentul „${s.name}”? Plătit la salon: banii nu se returnează automat. Cumpărat online: nefolosit, banii se returnează singuri pe card; cu tunsori folosite, apare „De returnat” la Plăți online și decizi tu cât returnezi.`) &&
                  run(async () => {
                    await api('PATCH', `/admin/subscriptions/${s.id}`, { status: 'cancelled' });
                    onChange();
                  })
                }
              >
                Anulează
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {plans ? (
        <div className="card grid">
          {plans.length === 0 ? (
            <div className="muted small">Nu ai încă abonamente. Le adaugi din pagina „Abonamente”.</div>
          ) : (
            <Field label="Abonamentul plătit la salon">
              <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Alege…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {lei(p.price)} · {p.periodDays} zile · {cuts(p.cuts)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="row">
            <button
              disabled={busy || !plan}
              onClick={() =>
                plan &&
                confirm(`Clientul a plătit ${lei(plan.price)} pentru „${plan.name}”?`) &&
                run(async () => {
                  await api('POST', `/admin/clients/${clientId}/subscriptions`, { planId });
                  setPlans(null);
                  setPlanId('');
                  onChange();
                })
              }
            >
              Activează
            </button>
            <button className="ghost" onClick={() => setPlans(null)}>
              Renunță
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            className="ghost sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setPlans((await api<Plan[]>('GET', '/admin/plans')).filter((p) => p.active));
              })
            }
          >
            + Activează abonament
          </button>
        </div>
      )}
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

export function SubscriptionsPage(_: { me: Me }) {
  const plans = useLoad(() => api<Plan[]>('GET', '/admin/plans'));
  const services = useLoad(() => api<Service[]>('GET', '/admin/services'));
  const [all, setAll] = useState(false);
  const subs = useLoad(() => api<Subscription[]>('GET', `/admin/subscriptions${all ? '?all=1' : ''}`), [all]);
  const [edit, setEdit] = useState<Partial<Plan> | null>(null);
  const svcName = (ids: string[]) => (ids.length ? ids.map((id) => services.data?.find((s) => s.id === id)?.name ?? id).join(', ') : 'toate serviciile');

  return (
    <>
      <div className="head">
        <h1>Abonamente</h1>
        <button onClick={() => setEdit({ periodDays: 30, cuts: 4, price: 150, serviceIds: [], sort: (plans.data?.length ?? 0) + 1, active: true })}>+ Abonament nou</button>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Clienții văd abonamentele în aplicație (Cont → Abonamente) și le plătesc la salon (frizerul sau tu le activați din fișa clientului) sau, cu plata
        online pornită, le cumpără direct din aplicație cu cardul și se activează singure. La fiecare
        tunsoare, frizerul confirmă în aplicație „a plătit X lei” sau „pe abonament”, iar tunsoarea se scade din abonament.
      </p>
      {!plans.data ? (
        <Loading error={plans.error} />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Abonament</th>
                <th>Preț</th>
                <th>Perioadă</th>
                <th>Tunsori</th>
                <th>Servicii</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plans.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small">
                    Niciun abonament încă.
                  </td>
                </tr>
              ) : null}
              {plans.data.map((p) => (
                <tr key={p.id} className="click" onClick={() => setEdit(p)}>
                  <td>
                    {p.name}
                    {p.description ? <div className="muted small">{p.description}</div> : null}
                  </td>
                  <td>{lei(p.price)}</td>
                  <td>{p.periodDays} zile</td>
                  <td>{cuts(p.cuts)}</td>
                  <td className="small">{svcName(p.serviceIds)}</td>
                  <td>{p.active ? null : <span className="pill off">ascuns</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="head" style={{ marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>{all ? 'Toate abonamentele vândute' : 'Abonamente active'}</h2>
        <label className="check small">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Arată și cele expirate sau anulate
        </label>
      </div>
      {!subs.data ? (
        <Loading error={subs.error} />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Abonament</th>
                <th>Perioadă</th>
                <th>Tunsori</th>
                <th>Stare</th>
              </tr>
            </thead>
            <tbody>
              {subs.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small">
                    Niciunul.
                  </td>
                </tr>
              ) : null}
              {subs.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.client?.name || s.client?.phone}
                    <div className="muted small">{s.client?.phone}</div>
                  </td>
                  <td>
                    {s.name}
                    <div className="muted small">
                      {lei(s.price)}
                      {s.createdByName ? ` · activat de ${s.createdByName}` : ''}
                    </div>
                  </td>
                  <td className="small">
                    {date(s.startsAt)} – {date(s.endsAt)}
                  </td>
                  <td className="small">{used(s)}</td>
                  <td>
                    <span className={`pill ${PILL[s.state]}`}>{STATE[s.state]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit ? (
        <PlanModal
          p={edit}
          services={services.data ?? []}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            plans.reload();
          }}
        />
      ) : null}
    </>
  );
}

function PlanModal({ p, services, onClose, onDone }: { p: Partial<Plan>; services: Service[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ ...p });
  const [tr, setTr] = useState(p.translations ?? emptyTr());
  const { busy, error, run } = useAction();
  const set = (patch: Partial<Plan>) => setV((x) => ({ ...x, ...patch }));
  const ids = v.serviceIds ?? [];
  const body = {
    name: v.name,
    description: v.description ?? '',
    price: Number(v.price),
    periodDays: Number(v.periodDays),
    cuts: v.cuts === null ? null : Number(v.cuts ?? 0),
    serviceIds: ids,
    sort: Number(v.sort) || 0,
    active: v.active !== false,
    translations: tr,
  };

  return (
    <Modal title={p.id ? 'Editează abonamentul' : 'Abonament nou'} onClose={onClose}>
      <div className="grid">
        <Field label="Nume (ex. Lunar 4 tunsori)">
          <input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus maxLength={80} />
        </Field>
        <Field label="Descriere pentru client">
          <textarea value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
        </Field>
        <TranslationFields
          fields={[
            { key: 'name', label: 'Nume' },
            { key: 'description', label: 'Descriere pentru client', multiline: true },
          ]}
          ro={{ name: v.name, description: v.description }}
          initialRo={{ name: p.name, description: p.description }}
          value={tr}
          onChange={setTr}
        />
        <div className="grid two">
          <Field label="Preț (lei)">
            <input type="number" min={1} value={v.price ?? ''} onChange={(e) => set({ price: Number(e.target.value) })} />
          </Field>
          <Field label="Valabil (zile)">
            <input type="number" min={1} value={v.periodDays ?? ''} onChange={(e) => set({ periodDays: Number(e.target.value) })} />
          </Field>
          <Field label="Câte tunsori">
            <input
              type="number"
              min={1}
              value={v.cuts ?? ''}
              disabled={v.cuts === null}
              onChange={(e) => set({ cuts: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}>
            <input type="checkbox" checked={v.cuts === null} onChange={(e) => set({ cuts: e.target.checked ? null : 4 })} /> Nelimitat
          </label>
        </div>
        <Field label="Ce servicii acoperă (nimic bifat = toate)">
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {services.map((s) => (
              <label key={s.id} className="check small">
                <input
                  type="checkbox"
                  checked={ids.includes(s.id)}
                  onChange={(e) => set({ serviceIds: e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id) })}
                />{' '}
                {s.name}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Ordine în listă">
          <input type="number" value={v.sort ?? 0} onChange={(e) => set({ sort: Number(e.target.value) })} style={{ maxWidth: 120 }} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={v.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Se poate cumpăra (vizibil în aplicație)
        </label>
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (p.id) await api('PATCH', `/admin/plans/${p.id}`, body);
                else await api('POST', '/admin/plans', body);
                onDone();
              })
            }
          >
            Salvează
          </button>
          {p.id ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm('Ștergi abonamentul? Abonamentele deja vândute rămân valabile.') &&
                run(async () => {
                  await api('DELETE', `/admin/plans/${p.id}`);
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
