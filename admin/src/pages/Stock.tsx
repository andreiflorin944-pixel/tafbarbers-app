import { useEffect, useState } from 'react';
import { api, ApiError, errorText, getToken, type Me, type Product } from '../api';
import { Field, Loading, Modal, useAction, useLoad, useSub } from '../ui';
import { addDays, lei, longDate, today } from '../util';

type NirLine = { productId: string; name: string; unit: string; qty: number; unitCost: number; vatPct: number; value: number; vat: number };
type Nir = {
  id: string;
  number: number;
  day: string;
  supplier: string;
  supplierCui: string;
  invoiceNo: string;
  invoiceDay: string | null;
  note: string;
  total: number;
  vat: number;
  createdAt: string;
  createdByName: string | null;
  cancelledAt: string | null;
  linesCount?: number;
  lines?: NirLine[];
};
type Col = { key: string; label: string; type: string };
type Report = { columns: Col[]; rows: Array<Record<string, string | number | null>>; totals: Record<string, string | number | null> | null };
const TABS = ['NIR (intrări de marfă)', 'Ieșire din stoc', 'Situația stocului', 'Fișa de magazie'] as const;
const VATS = [0, 21, 11];

// Gestiune: NIR la marfa primită, ieșiri (consum în salon, casare), situația stocului și fișa de magazie.
const TAB_SUBS = ['nir', 'iesire', 'situatie', 'fisa'];

export function StockPage({ me }: { me: Me }) {
  const [tab, setTab] = useState(0);
  const sub = useSub();
  useEffect(() => {
    const i = TAB_SUBS.indexOf(sub);
    if (i >= 0) setTab(i);
  }, [sub]);
  return (
    <>
      <div className="head">
        <h1>Stoc și NIR</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 780 }}>
        Marfa primită de la furnizor se trece pe un NIR și intră în stoc. Vânzările din magazinul aplicației scad singure stocul; ce folosiți în salon sau
        aruncați se trece la „Ieșire din stoc”. Stocul e același cu cel din <a href="#/shop">Magazin</a>.
      </p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t, i) => (
          <button key={t} className={i === tab ? 'sm' : 'ghost sm'} onClick={() => ((location.hash = `#/stock/${TAB_SUBS[i]}`), setTab(i))}>
            {t}
          </button>
        ))}
      </div>
      {tab === 0 ? <NirTab owner={me.owner} /> : tab === 1 ? <OutTab /> : tab === 2 ? <ReportTab kind="stock" /> : <ReportTab kind="stock-moves" period />}
    </>
  );
}

function NirTab({ owner }: { owner: boolean }) {
  const list = useLoad(() => api<Nir[]>('GET', '/admin/nir'));
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<string | null>(null);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => setCreating(true)}>+ NIR nou</button>
      </div>
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.length === 0 ? (
        <div className="muted">Încă nu e niciun NIR. Când primești marfă, apasă „NIR nou”.</div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Data</th>
                <th>Furnizor</th>
                <th>Factura</th>
                <th>Produse</th>
                <th style={{ textAlign: 'right' }}>Valoare fără TVA</th>
                <th style={{ textAlign: 'right' }}>TVA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((n) => (
                <tr key={n.id} className="click" onClick={() => setView(n.id)} style={{ opacity: n.cancelledAt ? 0.5 : 1 }}>
                  <td>{n.number}</td>
                  <td>{longDate(`${n.day}T12:00:00Z`)}</td>
                  <td>{n.supplier}</td>
                  <td>{n.invoiceNo}</td>
                  <td>{n.linesCount}</td>
                  <td style={{ textAlign: 'right' }}>{lei(n.total)}</td>
                  <td style={{ textAlign: 'right' }}>{lei(n.vat)}</td>
                  <td>{n.cancelledAt ? <span className="pill cancelled">anulat</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? (
        <NirForm
          onClose={() => setCreating(false)}
          onDone={(n) => {
            setCreating(false);
            list.reload();
            setView(n.id);
          }}
        />
      ) : null}
      {view ? <NirView id={view} owner={owner} onClose={() => setView(null)} onChange={list.reload} /> : null}
    </>
  );
}

type Line = { productId: string; newName: string; unit: string; forSale: boolean; price: string; qty: string; unitCost: string; vatPct: number };
const emptyLine = (vat: number): Line => ({ productId: '', newName: '', unit: 'buc', forSale: false, price: '', qty: '1', unitCost: '', vatPct: vat });

function NirForm({ onClose, onDone }: { onClose: () => void; onDone: (n: Nir) => void }) {
  const products = useLoad(() => api<Product[]>('GET', '/admin/products'));
  const [day, setDay] = useState(today());
  const [supplier, setSupplier] = useState('');
  const [supplierCui, setCui] = useState('');
  const [invoiceNo, setInvoice] = useState('');
  const [invoiceDay, setInvoiceDay] = useState(today());
  const [vat, setVat] = useState(0);
  const [lines, setLines] = useState<Line[]>([emptyLine(0)]);
  const { busy, error, run } = useAction();
  const setLine = (i: number, patch: Partial<Line>) => setLines((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const total = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
  const vatTotal = lines.reduce((n, l) => n + ((Number(l.qty) || 0) * (Number(l.unitCost) || 0) * l.vatPct) / 100, 0);
  const valid = supplier.trim() && lines.every((l) => (l.productId && l.productId !== 'new') || (l.productId === 'new' && l.newName.trim())) && lines.every((l) => Number(l.qty) >= 1 && l.unitCost !== '');

  return (
    <Modal title="NIR nou (notă de intrare-recepție)" onClose={onClose}>
      <div className="grid">
        <div className="grid two">
          <Field label="Data recepției">
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Furnizor">
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ex.: Barber Supply SRL" />
          </Field>
          <Field label="CUI furnizor (opțional)">
            <input value={supplierCui} onChange={(e) => setCui(e.target.value)} placeholder="RO12345678" />
          </Field>
          <Field label="Factura / avizul nr.">
            <input value={invoiceNo} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
          <Field label="Data facturii">
            <input type="date" value={invoiceDay} onChange={(e) => setInvoiceDay(e.target.value)} />
          </Field>
          <Field label="TVA pe factură">
            <select
              value={vat}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVat(v);
                setLines((l) => l.map((x) => ({ ...x, vatPct: v })));
              }}
            >
              <option value={0}>Fără TVA (neplătitor)</option>
              <option value={21}>21%</option>
              <option value={11}>11%</option>
            </select>
          </Field>
        </div>
        <b>Produse primite</b>
        {!products.data ? <Loading error={products.error} /> : null}
        {lines.map((l, i) => (
          <div key={i} className="card grid" style={{ gap: 8, padding: 12 }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Produs">
                <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} style={{ minWidth: 220 }}>
                  <option value="">Alege…</option>
                  {(products.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.forSale ? '' : ' (salon)'}
                    </option>
                  ))}
                  <option value="new">+ Produs nou</option>
                </select>
              </Field>
              <Field label="Cantitate">
                <input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} style={{ width: 90 }} />
              </Field>
              <Field label="Preț unitar fără TVA (lei)">
                <input type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} style={{ width: 130 }} />
              </Field>
              <Field label="TVA">
                <select value={l.vatPct} onChange={(e) => setLine(i, { vatPct: Number(e.target.value) })} style={{ width: 90 }}>
                  {VATS.map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </select>
              </Field>
              <span className="muted small" style={{ paddingBottom: 10 }}>
                = {lei(Math.round((Number(l.qty) || 0) * (Number(l.unitCost) || 0) * 100) / 100)}
              </span>
              {lines.length > 1 ? (
                <button className="ghost sm" onClick={() => setLines((x) => x.filter((_, k) => k !== i))} aria-label="Scoate linia">
                  ✕
                </button>
              ) : null}
            </div>
            {l.productId === 'new' ? (
              <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label="Nume produs nou">
                  <input value={l.newName} onChange={(e) => setLine(i, { newName: e.target.value })} style={{ minWidth: 220 }} />
                </Field>
                <Field label="U.M.">
                  <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} style={{ width: 80 }} />
                </Field>
                <label className="check" style={{ paddingBottom: 10 }}>
                  <input type="checkbox" checked={l.forSale} onChange={(e) => setLine(i, { forSale: e.target.checked })} /> Îl vindem în magazin
                </label>
                {l.forSale ? (
                  <Field label="Preț de vânzare (lei)">
                    <input type="number" min={0} step="0.5" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} style={{ width: 110 }} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        <div>
          <button className="ghost sm" onClick={() => setLines((l) => [...l, emptyLine(vat)])}>
            + Încă un produs
          </button>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            Total fără TVA: <b>{lei(Math.round(total * 100) / 100)}</b> · TVA: <b>{lei(Math.round(vatTotal * 100) / 100)}</b> · Total:{' '}
            <b>{lei(Math.round((total + vatTotal) * 100) / 100)}</b>
          </span>
        </div>
        {error ? <div className="err">{error}</div> : null}
        <button
          disabled={busy || !valid}
          onClick={() =>
            run(async () => {
              const n = await api<Nir>('POST', '/admin/nir', {
                day,
                supplier,
                supplierCui,
                invoiceNo,
                invoiceDay,
                lines: lines.map((l) => ({
                  ...(l.productId === 'new' ? { newProduct: { name: l.newName, unit: l.unit, forSale: l.forSale, price: Number(l.price) || 0 } } : { productId: l.productId }),
                  qty: Number(l.qty),
                  unitCost: Number(l.unitCost),
                  vatPct: l.vatPct,
                })),
              });
              onDone(n);
            })
          }
        >
          Salvează NIR-ul și adaugă în stoc
        </button>
      </div>
    </Modal>
  );
}

function NirView({ id, owner, onClose, onChange }: { id: string; owner: boolean; onClose: () => void; onChange: () => void }) {
  const n = useLoad(() => api<Nir>('GET', `/admin/nir/${id}`), [id]);
  const { busy, error, run } = useAction();
  const print = () => {
    const d = n.data!;
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>NIR ${d.number}</title>
<style>body{font:13px Arial,sans-serif;margin:32px;color:#000}h1{font-size:18px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #444;padding:5px 6px}th{background:#eee}td.n{text-align:right}.sig{display:flex;justify-content:space-between;margin-top:40px}</style></head><body>
<h1>NOTĂ DE INTRARE-RECEPȚIE nr. ${d.number} din ${esc(d.day.split('-').reverse().join('.'))}</h1>
<div>Furnizor: <b>${esc(d.supplier)}</b>${d.supplierCui ? `, CUI ${esc(d.supplierCui)}` : ''} · Document: ${esc(d.invoiceNo || '-')}${d.invoiceDay ? ` din ${esc(d.invoiceDay.split('-').reverse().join('.'))}` : ''}</div>
<table><thead><tr><th>Nr.</th><th>Denumire</th><th>U.M.</th><th>Cantitate</th><th>Preț unitar fără TVA</th><th>Valoare</th><th>TVA %</th><th>Valoare TVA</th></tr></thead><tbody>
${(d.lines ?? []).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="n">${l.qty}</td><td class="n">${l.unitCost.toFixed(2)}</td><td class="n">${l.value.toFixed(2)}</td><td class="n">${l.vatPct}</td><td class="n">${l.vat.toFixed(2)}</td></tr>`).join('')}
<tr><td colspan="5"><b>Total</b></td><td class="n"><b>${d.total.toFixed(2)}</b></td><td></td><td class="n"><b>${d.vat.toFixed(2)}</b></td></tr></tbody></table>
<div class="sig"><div>Comisia de recepție<br><br>...............................</div><div>Gestionar<br><br>...............................</div></div>
<script>window.print()</script></body></html>`);
    w.document.close();
  };
  return (
    <Modal title={n.data ? `NIR nr. ${n.data.number}` : 'NIR'} onClose={onClose}>
      {!n.data ? (
        <Loading error={n.error} />
      ) : (
        <div className="grid">
          <div className="muted small">
            {longDate(`${n.data.day}T12:00:00Z`)} · {n.data.supplier}
            {n.data.supplierCui ? ` (${n.data.supplierCui})` : ''} · factura {n.data.invoiceNo || '-'}
            {n.data.createdByName ? ` · operat de ${n.data.createdByName}` : ''}
          </div>
          {n.data.cancelledAt ? <div className="err">NIR anulat; marfa a ieșit din stoc.</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produs</th>
                  <th style={{ textAlign: 'right' }}>Cant.</th>
                  <th style={{ textAlign: 'right' }}>Preț fără TVA</th>
                  <th style={{ textAlign: 'right' }}>Valoare</th>
                  <th style={{ textAlign: 'right' }}>TVA</th>
                </tr>
              </thead>
              <tbody>
                {(n.data.lines ?? []).map((l) => (
                  <tr key={l.productId}>
                    <td>{l.name}</td>
                    <td style={{ textAlign: 'right' }}>
                      {l.qty} {l.unit}
                    </td>
                    <td style={{ textAlign: 'right' }}>{lei(l.unitCost)}</td>
                    <td style={{ textAlign: 'right' }}>{lei(l.value)}</td>
                    <td style={{ textAlign: 'right' }}>{l.vatPct ? `${lei(l.vat)} (${l.vatPct}%)` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            Total fără TVA <b>{lei(n.data.total)}</b> · TVA <b>{lei(n.data.vat)}</b>
          </div>
          {error ? <div className="err">{error}</div> : null}
          <div className="row">
            <button onClick={print}>Tipărește NIR-ul</button>
            {owner && !n.data.cancelledAt ? (
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  confirm('Anulezi NIR-ul? Produsele ies din stoc.') &&
                  run(async () => {
                    await api('POST', `/admin/nir/${id}/cancel`);
                    n.reload();
                    onChange();
                  })
                }
              >
                Anulează NIR-ul
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

function OutTab() {
  const products = useLoad(() => api<Product[]>('GET', '/admin/products'));
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [kind, setKind] = useState<'consum' | 'casare'>('consum');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const tracked = (products.data ?? []).filter((p) => p.stock !== null);
  const p = tracked.find((x) => x.id === productId);
  return (
    <div className="card grid" style={{ maxWidth: 560 }}>
      {!products.data ? <Loading error={products.error} /> : null}
      <Field label="Produs">
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Alege…</option>
          {tracked.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · în stoc {x.stock} {x.unit}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid two">
        <Field label="Cantitate">
          <input type="number" min={1} max={p?.stock ?? undefined} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Motiv">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'consum' | 'casare')}>
            <option value="consum">Consum în salon</option>
            <option value="casare">Casare (deteriorat, expirat)</option>
          </select>
        </Field>
      </div>
      <Field label="Observații (opțional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      {error ? <div className="err">{error}</div> : null}
      {done ? <div className="success small">{done}</div> : null}
      <div>
        <button
          disabled={busy || !productId || !(Number(qty) >= 1)}
          onClick={() =>
            run(async () => {
              await api('POST', '/admin/stock/out', { productId, qty: Number(qty), kind, note });
              setDone(`Am scos ${qty} ${p?.unit ?? 'buc'} de ${p?.name ?? 'produs'} din stoc.`);
              setNote('');
              products.reload();
            })
          }
        >
          Scoate din stoc
        </button>
      </div>
      <div className="muted small">Produsele fără stoc urmărit („fără limită” în Magazin) nu apar aici.</div>
    </div>
  );
}

function ReportTab({ kind, period }: { kind: 'stock' | 'stock-moves'; period?: boolean }) {
  const [from, setFrom] = useState(addDays(today(), -29));
  const [to, setTo] = useState(today());
  const qs = period ? `from=${from}&to=${to}` : '';
  const r = useLoad(() => api<Report>('GET', `/admin/reports/${kind}?${qs}`), [qs]);
  const [err, setErr] = useState<string | null>(null);
  const numeric = (c: Col) => c.type === 'int' || c.type === 'money';
  const cell = (c: Col, v: unknown) => (v === null || v === undefined || v === '' ? '' : c.type === 'money' ? lei(Number(v)) : String(v));
  const download = async () => {
    try {
      const res = await fetch(`/v1/admin/reports/${kind}?${qs}&format=xlsx`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'server_error', res.status);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind === 'stock' ? `Situatia stocului ${today()}` : `Fisa de magazie ${from} - ${to}`}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        {period ? (
          <>
            <Field label="De la">
              <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </Field>
            <Field label="Până la">
              <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </Field>
          </>
        ) : null}
        <button className="ghost" onClick={download} disabled={!r.data?.rows.length}>
          Descarcă Excel
        </button>
      </div>
      {err ? <div className="err">{err}</div> : null}
      {!r.data ? (
        <Loading error={r.error} />
      ) : r.data.rows.length === 0 ? (
        <div className="muted">{kind === 'stock' ? 'Niciun produs cu stoc urmărit.' : 'Nicio mișcare în perioada aleasă.'}</div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="report">
            <thead>
              <tr>
                {r.data.columns.map((c) => (
                  <th key={c.key} style={{ textAlign: numeric(c) ? 'right' : 'left' }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.data.rows.map((row, i) => (
                <tr key={i}>
                  {r.data!.columns.map((c) => (
                    <td key={c.key} style={{ textAlign: numeric(c) ? 'right' : 'left' }}>
                      {cell(c, row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {r.data.totals ? (
                <tr style={{ fontWeight: 700 }}>
                  {r.data.columns.map((c) => (
                    <td key={c.key} style={{ textAlign: numeric(c) ? 'right' : 'left' }}>
                      {cell(c, r.data!.totals![c.key])}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
