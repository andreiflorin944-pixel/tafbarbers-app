import { useState } from 'react';
import { api, type Me } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { date, lei, time } from '../util';

type Payment = {
  id: string;
  kind: 'booking' | 'order' | 'gift' | 'sub';
  kindLabel: string;
  ref: string;
  what: string;
  bookingStart: string | null;
  clientId: string | null;
  clientName: string;
  clientPhone?: string;
  amount: number;
  status: 'paid' | 'refunded' | 'to_refund';
  note: string;
  stripeRef: string;
  refundRef: string | null;
  createdAt: string;
  refundedAt: string | null;
  refundedBy: string | null;
};
type List = { from: string; to: string; items: Payment[]; totals: { count: number; paid: number; refunded: number; toRefund: number; toRefundCount: number } };

const STATUS: Record<Payment['status'], { label: string; pill: string }> = {
  paid: { label: 'Plătită', pill: 'completed' },
  refunded: { label: 'Returnată', pill: 'off' },
  to_refund: { label: 'De returnat', pill: 'cancelled' },
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' });

/**
 * Plățile online (Stripe): ce s-a plătit din aplicație, ce s-a returnat singur pe card și ce trebuie returnat de mână
 * („De returnat”: ex. plătită după ce a fost anulată și Stripe n-a putut returna singur).
 */
export function PaymentsPage({ me }: { me: Me }) {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const q = new URLSearchParams({ from, to, ...(status && { status }), ...(kind && { kind }) });
  const list = useLoad(() => api<List>('GET', `/admin/payments?${q}`), [from, to, status, kind]);
  const { busy, error, run } = useAction();
  const [msg, setMsg] = useState<string | null>(null);

  const retry = (p: Payment) =>
    run(async () => {
      const r = await api<{ refunded: boolean }>('POST', `/admin/payments/${p.id}/retry`);
      setMsg(r.refunded ? `Returnarea de ${lei(p.amount)} a fost acceptată de Stripe.` : 'Stripe tot n-a acceptat returnarea. Returneaz-o din contul Stripe și apasă „Am returnat-o”.');
      list.reload();
    });
  const manual = (p: Payment) =>
    run(async () => {
      if (!confirm(`Ai returnat ${lei(p.amount)} clientului ${p.clientName || ''} (din contul Stripe → Payments → Refund)? Plata va apărea „Returnată”.`)) return;
      await api('POST', `/admin/payments/${p.id}/refunded`);
      setMsg('Plata e marcată returnată.');
      list.reload();
    });

  const d = list.data;
  return (
    <>
      <div className="head">
        <h1>Plăți online</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 820 }}>
        Tot ce s-a plătit cu cardul din aplicație (programări, comenzi, carduri cadou, abonamente). La anulare banii se returnează singuri pe card; o plată
        care nu s-a putut returna singură apare „De returnat”: o returnezi din contul Stripe și apoi apeși „Am returnat-o”. Setările sunt la{' '}
        {me.owner ? <a href="#/settings/plati">Setări → Plăți online</a> : 'Setări → Plăți online'}.
      </p>

      <div className="card row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
        <Field label="De la">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Până la">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Stare">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Toate</option>
            <option value="paid">Plătite</option>
            <option value="to_refund">De returnat</option>
            <option value="refunded">Returnate</option>
          </select>
        </Field>
        <Field label="Pentru">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Orice</option>
            <option value="booking">Programări</option>
            <option value="order">Comenzi magazin</option>
            <option value="gift">Carduri cadou</option>
            <option value="sub">Abonamente</option>
          </select>
        </Field>
      </div>

      {!d ? (
        <Loading error={list.error} />
      ) : (
        <>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="card stat">
              <div className="v">{lei(d.totals.paid)}</div>
              <div className="l">Încasat online (păstrat)</div>
            </div>
            <div className="card stat">
              <div className="v">{lei(d.totals.refunded)}</div>
              <div className="l">Returnat pe card</div>
            </div>
            <div className="card stat" style={d.totals.toRefundCount ? { borderColor: 'var(--danger)' } : undefined}>
              <div className="v">{lei(d.totals.toRefund)}</div>
              <div className="l">De returnat ({d.totals.toRefundCount})</div>
            </div>
            <div className="card stat">
              <div className="v">{d.totals.count}</div>
              <div className="l">Plăți în perioadă</div>
            </div>
          </div>
          {msg ? <div className="success small" style={{ marginBottom: 8 }}>{msg}</div> : null}
          {error ? <div className="err" style={{ marginBottom: 8 }}>{error}</div> : null}
          {d.items.length === 0 ? (
            <p className="muted">Nicio plată online în perioada aleasă.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Client</th>
                    <th>Pentru</th>
                    <th style={{ textAlign: 'right' }}>Sumă</th>
                    <th>Stare</th>
                    <th>Referință Stripe</th>
                    {me.owner ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {date(p.createdAt)}, {time(p.createdAt)}
                      </td>
                      <td>
                        {p.clientId && p.clientName ? <a href={`#/clients/${p.clientId}`}>{p.clientName}</a> : p.clientName || <span className="muted">fără nume</span>}
                        {p.clientPhone ? <div className="muted small">{p.clientPhone}</div> : null}
                      </td>
                      <td>
                        <b>{p.kindLabel}</b>
                        <div className="small">
                          {p.what}
                          {p.bookingStart ? ` · ${date(p.bookingStart)}, ${time(p.bookingStart)}` : ''}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{lei(p.amount)}</td>
                      <td>
                        <span className={`pill ${STATUS[p.status].pill}`}>{STATUS[p.status].label}</span>
                        {p.note ? <div className="muted small">{p.note}</div> : null}
                        {p.refundedAt ? (
                          <div className="muted small">
                            {date(p.refundedAt)}
                            {p.refundedBy ? ` · ${p.refundedBy}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <code className="small">{p.stripeRef}</code>
                        {p.refundRef ? <div className="muted small">returnare: {p.refundRef}</div> : null}
                      </td>
                      {me.owner ? (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {p.status === 'to_refund' ? (
                            <div className="grid" style={{ gap: 4 }}>
                              <button className="ghost sm" disabled={busy} onClick={() => retry(p)}>
                                Încearcă returnarea automată
                              </button>
                              <button className="ghost sm" disabled={busy} onClick={() => manual(p)}>
                                Am returnat-o de mână
                              </button>
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">
            Plățile apar și în <a href="#/reports/online-payments">Rapoarte → Plăți online</a> (cu descărcare Excel). În registrul de încasări, o programare plătită
            din aplicație apare la „Transfer / online”, nu la numerar sau card.
          </p>
        </>
      )}
    </>
  );
}
