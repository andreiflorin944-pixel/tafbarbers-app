import { useState } from 'react';
import { api, type Me, type Order, type OrderStatus, type Product } from '../api';
import { emptyTr, Field, ImagePicker, Loading, Modal, TranslationFields, useAction, useLoad } from '../ui';
import { date, lei, time } from '../util';

const ORDER_STATUS: Record<OrderStatus, string> = { new: 'Nouă', ready: 'Gata de ridicare', picked_up: 'Ridicată', cancelled: 'Anulată' };
const FILTERS = [
  { key: 'open', label: 'De pregătit' },
  { key: 'picked_up', label: 'Ridicate' },
  { key: 'cancelled', label: 'Anulate' },
] as const;

export function ShopPage({ me }: { me: Me }) {
  const [tab, setTab] = useState<'orders' | 'products'>(me.permissions.shop ? 'orders' : 'products');
  return (
    <>
      <div className="head">
        <h1>Magazin</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Clienții comandă din aplicație și plătesc la ridicare, în salon. Când apeși „Gata de ridicare”, clientul primește SMS. Stocul scade la comandă
        și revine dacă o comandă se anulează.
      </p>
      {me.owner ? (
        <div className="tabs">
          <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
            Comenzi
          </button>
          <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>
            Produse
          </button>
        </div>
      ) : null}
      {tab === 'orders' ? <Orders /> : <Products />}
    </>
  );
}

function Orders() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('open');
  const list = useLoad(() => api<Order[]>('GET', `/admin/orders?status=${filter}`), [filter]);
  const { busy, error, run } = useAction();
  const [method, setMethod] = useState<Record<string, string>>({});
  const setStatus = (o: Order, status: OrderStatus) =>
    run(async () => {
      await api('PATCH', `/admin/orders/${o.id}`, { status, payMethod: method[o.id] ?? 'cash' });
      list.reload();
    });

  return (
    <>
      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.key} className={f.key === filter ? 'on sm' : 'sm'} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {error ? <div className="err">{error}</div> : null}
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.length === 0 ? (
        <p className="muted">{filter === 'open' ? 'Nicio comandă de pregătit.' : 'Nicio comandă aici.'}</p>
      ) : (
        <div className="orders">
          {list.data.map((o) => (
            <div key={o.id} className="card grid" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>Comanda {o.code}</strong>
                <span className={`pill ${o.status}`}>{ORDER_STATUS[o.status]}</span>
              </div>
              <div className="muted small">
                {date(o.createdAt)}, {time(o.createdAt)} · {o.clientName || 'client'}
                {o.clientPhone ? (
                  <>
                    {' · '}
                    <a href={`tel:${o.clientPhone}`}>{o.clientPhone}</a>
                  </>
                ) : null}
              </div>
              <div>
                {o.items.map((i) => (
                  <div key={i.productId} className="row small" style={{ justifyContent: 'space-between' }}>
                    <span>
                      {i.qty} × {i.name}
                    </span>
                    <span>{lei(i.price * i.qty)}</span>
                  </div>
                ))}
              </div>
              {o.note ? <div className="small">„{o.note}”</div> : null}
              {o.paidAt ? (
                <div className="small" style={{ color: 'var(--ok, #8FC79A)' }}>
                  Plătită {o.payMethod === 'online' ? 'online, cu cardul' : o.payMethod === 'card' ? 'cu cardul (POS)' : o.payMethod === 'transfer' ? 'prin transfer' : 'numerar'}
                  {o.status === 'cancelled' && o.payMethod === 'online' ? ' · banii trebuie returnați din Stripe' : ''}
                </div>
              ) : null}
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>Total {lei(o.total)}</strong>
                <div className="row">
                  {o.status === 'new' ? (
                    <button className="sm" disabled={busy} onClick={() => setStatus(o, 'ready')}>
                      Gata de ridicare
                    </button>
                  ) : null}
                  {o.status === 'new' || o.status === 'ready' ? (
                    <>
                      {!o.paidAt ? (
                        <select className="sm" value={method[o.id] ?? 'cash'} onChange={(e) => setMethod({ ...method, [o.id]: e.target.value })} aria-label="Încasez cu">
                          <option value="cash">Numerar</option>
                          <option value="card">Card (POS)</option>
                        </select>
                      ) : null}
                      <button className={o.status === 'ready' ? 'sm' : 'ghost sm'} disabled={busy} onClick={() => setStatus(o, 'picked_up')}>
                        {o.paidAt ? 'Ridicată' : 'Ridicată și plătită'}
                      </button>
                      <button
                        className="danger sm"
                        disabled={busy}
                        onClick={() =>
                          confirm(
                            `Anulezi comanda ${o.code}? Produsele revin în stoc.${o.payMethod === 'online' ? ' Comanda e plătită online: returnează banii din contul Stripe.' : ''}`,
                          ) && setStatus(o, 'cancelled')
                        }
                      >
                        Anulează
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Products() {
  const list = useLoad(() => api<Product[]>('GET', '/admin/products'));
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => setEdit({ price: 50, stock: null, sort: (list.data?.length ?? 0) + 1, active: true, forSale: true, unit: 'buc' })}>+ Produs nou</button>
      </div>
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.length === 0 ? (
        <p className="muted">Încă nu ai produse. Când adaugi primul produs, magazinul apare în aplicație.</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Preț</th>
                <th>Stoc</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="click" onClick={() => setEdit(p)}>
                  <td>
                    <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} /> : null}
                      <div>
                        {p.name}
                        {p.description ? <div className="muted small">{p.description}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td>{lei(p.price)}</td>
                  <td>{p.stock === null ? <span className="muted">fără limită</span> : p.stock === 0 ? <span className="pill cancelled">epuizat</span> : p.stock}</td>
                  <td>
                    {p.active ? null : <span className="pill off">ascuns</span>} {p.forSale ? null : <span className="pill off">doar pentru salon</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit ? (
        <ProductModal
          p={edit}
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

function ProductModal({ p, onClose, onDone }: { p: Partial<Product>; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(p);
  const [tr, setTr] = useState(p.translations ?? emptyTr());
  const [stock, setStock] = useState(p.stock === null || p.stock === undefined ? '' : String(p.stock));
  const { busy, error, run } = useAction();
  const set = (patch: Partial<Product>) => setV((x) => ({ ...x, ...patch }));
  const body = {
    name: v.name ?? '',
    description: v.description ?? '',
    price: Number(v.price),
    imageUrl: v.imageUrl || null,
    stock: stock.trim() === '' ? null : Number(stock),
    sort: v.sort ?? 0,
    active: v.active !== false,
    forSale: v.forSale !== false,
    unit: v.unit || 'buc',
    cost: v.cost === undefined || v.cost === null || (v.cost as unknown) === '' ? null : Number(v.cost),
    translations: tr,
  };

  return (
    <Modal title={p.id ? 'Editează produsul' : 'Produs nou'} onClose={onClose}>
      <div className="grid">
        <Field label="Nume">
          <input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Ceară de păr mată 100 ml" />
        </Field>
        <Field label="Descriere (opțional)">
          <textarea value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} style={{ minHeight: 60 }} />
        </Field>
        <TranslationFields
          fields={[
            { key: 'name', label: 'Nume' },
            { key: 'description', label: 'Descriere', multiline: true },
          ]}
          ro={{ name: v.name, description: v.description }}
          initialRo={{ name: p.name, description: p.description }}
          value={tr}
          onChange={setTr}
        />
        <div className="grid two">
          <Field label="Preț (lei)">
            <input type="number" min={0} step="0.5" value={v.price ?? ''} onChange={(e) => set({ price: Number(e.target.value) })} />
          </Field>
          <Field label="Stoc (gol = fără limită)">
            <input type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} placeholder="fără limită" />
          </Field>
        </div>
        <div className="grid two">
          <Field label="Preț de achiziție, fără TVA (lei, se completează și din NIR)">
            <input type="number" min={0} step="0.01" value={v.cost ?? ''} onChange={(e) => set({ cost: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Unitate de măsură">
            <input value={v.unit ?? 'buc'} onChange={(e) => set({ unit: e.target.value })} maxLength={12} placeholder="buc, ml, flacon" />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={v.forSale !== false} onChange={(e) => set({ forSale: e.target.checked })} /> Se vinde în magazinul din aplicație (debifat =
          produs folosit doar în salon, ex. ceară, lame)
        </label>
        <Field label="Poză">
          <ImagePicker value={v.imageUrl ?? null} onChange={(imageUrl) => set({ imageUrl })} />
        </Field>
        <Field label="Ordine în listă">
          <input type="number" value={v.sort ?? 0} onChange={(e) => set({ sort: Number(e.target.value) })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={v.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Vizibil în aplicație
        </label>
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          <button
            disabled={busy || !body.name.trim()}
            onClick={() =>
              run(async () => {
                if (p.id) await api('PATCH', `/admin/products/${p.id}`, body);
                else await api('POST', '/admin/products', body);
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
                confirm('Ștergi produsul? Dacă a fost deja comandat, doar se ascunde.') &&
                run(async () => {
                  await api('DELETE', `/admin/products/${p.id}`);
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
