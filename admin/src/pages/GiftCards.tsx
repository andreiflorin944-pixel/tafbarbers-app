import { useState } from 'react';
import { api, errorText, type Me } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { date, lei, longDate } from '../util';

export type GiftCard = {
  id: string;
  code: string | null;
  amount: number;
  balance: number;
  recipientName: string;
  recipientPhone: string | null;
  message: string;
  status: 'pending' | 'active' | 'used' | 'cancelled' | 'expired';
  paidAt: string | null;
  payMethod?: string | null;
  expiresAt: string | null;
  createdAt: string;
  buyerName?: string | null;
  paidByName?: string | null;
  price?: number;
  promoCode?: string | null;
  packageName?: string | null;
  packageItems?: string | null;
  buyerPhone?: string | null;
  buyerEmail?: string | null;
};
const STATUS: Record<GiftCard['status'], string> = { pending: 'De încasat', active: 'Activ', used: 'Folosit', cancelled: 'Anulat', expired: 'Expirat' };
const FILTERS: Array<{ v: string; label: string }> = [
  { v: 'pending', label: 'De încasat' },
  { v: 'active', label: 'Active' },
  { v: 'paid', label: 'Registru vândute' },
  { v: '', label: 'Toate' },
];

// Cardurile cadou: cele cerute din aplicație așteaptă plata la salon; după încasare, destinatarul primește codul.
export function GiftCardsPage({ me }: { me: Me }) {
  const [filter, setFilter] = useState('pending');
  const list = useLoad(() => api<GiftCard[]>('GET', `/admin/gift-cards${filter ? `?status=${filter}` : ''}`), [filter]);
  const [selling, setSelling] = useState(false);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<GiftCard | string | null>(null);
  const [method, setMethod] = useState('cash');
  const [q, setQ] = useState('');
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const rows = (list.data ?? []).filter((g) => {
    if (!q.trim()) return true;
    const hay = norm([g.code, g.recipientName, g.recipientPhone, g.buyerName, g.buyerPhone, g.buyerEmail, g.promoCode, g.packageName].filter(Boolean).join(' '));
    return hay.includes(norm(q.trim()));
  });
  const paid = rows.filter((g) => g.status !== 'pending' && g.status !== 'cancelled');
  const sum = (f: (g: GiftCard) => number) => Math.round(paid.reduce((a, g) => a + f(g), 0) * 100) / 100;
  const csv = () => {
    const head = ['Data', 'Cumpărat de', 'Telefon cumpărător', 'E-mail cumpărător', 'Pentru', 'Telefon destinatar', 'Pachet', 'Valoare (lei)', 'Plătit (lei)', 'Cod reducere', 'Cod voucher', 'Folosit (lei)', 'Rămas (lei)', 'Stare', 'Plătit prin', 'Valabil până'];
    const cell = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((g) =>
      [date(g.createdAt), g.buyerName ?? 'vândut la salon', g.buyerPhone, g.buyerEmail, g.recipientName, g.recipientPhone, g.packageName, g.amount, g.price ?? g.amount, g.promoCode, g.code, g.status === 'pending' ? '' : Math.round((g.amount - g.balance) * 100) / 100, g.status === 'pending' ? '' : g.balance, STATUS[g.status], g.payMethod, g.expiresAt ? longDate(g.expiresAt) : '']
        .map(cell)
        .join(','),
    );
    const blob = new Blob(['\ufeff' + [head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vouchere-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const { busy, error, run } = useAction();

  const act = (g: GiftCard, status: 'active' | 'cancelled') =>
    run(async () => {
      if (status === 'cancelled' && !confirm(`Anulezi cardul de ${lei(g.amount)} pentru ${g.recipientName || 'destinatar'}?${g.payMethod === 'online' ? ' E plătit online: nefolosit, banii se returnează singuri pe card; folosit parțial, apare „De returnat” la Plăți online.' : ''}`)) return;
      await api('PATCH', `/admin/gift-cards/${g.id}`, { status, payMethod: method });
      list.reload();
    });

  return (
    <>
      <div className="head">
        <h1>Carduri cadou și vouchere</h1>
        <button onClick={() => setSelling(true)}>+ Vinde un card la salon</button>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Cardurile cerute din aplicație apar „De încasat”. Când clientul plătește la salon, apeși „Încasat”: cardul devine activ, iar destinatarul
        primește codul. La plata unei tunsori, codul se scrie la „Card cadou” când marchezi programarea ca plătită. Textul mesajului se schimbă din{' '}
        <a href="#/notifications">Notificări</a>.
      </p>

      <div className="card row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
        <Field label="Verifică un cod">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TAF-XXXX-XXXX" style={{ maxWidth: 200 }} />
        </Field>
        <button
          className="ghost"
          disabled={!code.trim()}
          onClick={() => api<GiftCard>('GET', `/admin/gift-cards/check?code=${encodeURIComponent(code)}`).then(setChecked, (e) => setChecked(errorText(e)))}
        >
          Verifică
        </button>
        {typeof checked === 'string' ? <span className="err">{checked}</span> : null}
        {checked && typeof checked !== 'string' ? (
          <span className={checked.status === 'active' ? 'success' : 'muted'}>
            {checked.code}: {STATUS[checked.status]}, mai are {lei(checked.balance)} din {lei(checked.amount)}
            {checked.expiresAt ? `, valabil până pe ${longDate(checked.expiresAt)}` : ''}
          </span>
        ) : null}
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted small">Încasez cu</span>
        <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 130 }} aria-label="Cum se încasează">
          <option value="cash">numerar</option>
          <option value="card">card (POS)</option>
          <option value="transfer">transfer</option>
        </select>
        <span style={{ width: 12 }} />
        {FILTERS.map((f) => (
          <button key={f.v} className={f.v === filter ? 'sm' : 'ghost sm'} onClick={() => setFilter(f.v)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută: nume, telefon, cod voucher, cod reducere…" style={{ maxWidth: 340 }} />
        <button className="ghost sm" disabled={!rows.length} onClick={csv}>
          Descarcă tabelul (Excel / CSV)
        </button>
        {paid.length ? (
          <span className="muted small">
            {paid.length} vândute · încasat {lei(sum((g) => g.price ?? g.amount))} · valoare {lei(sum((g) => g.amount))} · folosit la salon {lei(sum((g) => g.amount - g.balance))}
          </span>
        ) : null}
      </div>
      {error ? <div className="err">{error}</div> : null}
      {!list.data ? (
        <Loading error={list.error} />
      ) : rows.length === 0 ? (
        <div className="muted">Niciun card aici.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Cerut pe</th>
                <th>De la</th>
                <th>Pentru</th>
                <th>Valoare</th>
                <th>Plătit</th>
                <th>Folosit</th>
                <th>Cod</th>
                <th>Stare</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td>{date(g.createdAt)}</td>
                  <td>
                    {g.buyerName || <span className="muted">vândut la salon</span>}
                    {g.buyerPhone && !(g.buyerName ?? '').includes(g.buyerPhone) ? <div className="muted small">{g.buyerPhone}</div> : null}
                    {g.buyerEmail ? <div className="muted small">{g.buyerEmail}</div> : null}
                  </td>
                  <td>
                    {g.recipientName || '—'}
                    {g.recipientPhone ? <div className="muted small">{g.recipientPhone}</div> : null}
                    {g.message ? <div className="muted small">„{g.message}”</div> : null}
                  </td>
                  <td>
                    {lei(g.amount)}
                    {g.packageName ? <div className="muted small">{g.packageName}</div> : null}
                  </td>
                  <td>
                    {lei(g.price ?? g.amount)}
                    {g.promoCode ? <div className="muted small">cu codul {g.promoCode}</div> : null}
                  </td>
                  <td>
                    {g.status === 'pending' ? (
                      '—'
                    ) : g.balance >= g.amount ? (
                      <span className="muted">nefolosit</span>
                    ) : g.balance <= 0 ? (
                      <span>tot ({lei(g.amount)})</span>
                    ) : (
                      <span>
                        {lei(Math.round((g.amount - g.balance) * 100) / 100)}
                        <div className="muted small">rămas {lei(g.balance)}</div>
                      </span>
                    )}
                  </td>
                  <td style={{ fontFamily: 'monospace' }}>{g.code ?? '—'}</td>
                  <td>
                    {STATUS[g.status]}
                    {g.paidByName ? <div className="muted small">încasat de {g.paidByName}</div> : null}
                    {g.payMethod === 'online' ? <div className="muted small">plătit online, cu cardul</div> : null}
                    {g.expiresAt && g.status !== 'pending' ? <div className="muted small">până pe {longDate(g.expiresAt)}</div> : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {g.status === 'pending' ? (
                      <button className="sm" disabled={busy} onClick={() => act(g, 'active')}>
                        Încasat
                      </button>
                    ) : null}{' '}
                    {me.owner && (g.status === 'pending' || g.status === 'active') ? (
                      <button className="ghost sm" disabled={busy} onClick={() => act(g, 'cancelled')}>
                        Anulează
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selling ? (
        <SellModal
          method={method}
          onClose={() => setSelling(false)}
          onDone={(g) => {
            setSelling(false);
            setChecked(g);
            setFilter('active');
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function SellModal({ method, onClose, onDone }: { method: string; onClose: () => void; onDone: (g: GiftCard) => void }) {
  const [amount, setAmount] = useState('100');
  const [recipientName, setName] = useState('');
  const [recipientPhone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<{ price: number; discount: number } | null>(null);
  const { busy, error, run } = useAction();
  return (
    <Modal title="Card cadou vândut la salon" onClose={onClose}>
      <div className="grid">
        <Field label="Sumă (lei)">
          <input type="number" min={10} max={5000} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 140 }} />
        </Field>
        <Field label="Pentru (nume)">
          <input value={recipientName} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Telefonul celui care îl primește (opțional; primește codul prin SMS)">
          <input value={recipientPhone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
        </Field>
        <Field label="Urare (opțional)">
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Cod de reducere (opțional)">
          <div className="row" style={{ gap: 8 }}>
            <input
              value={promo}
              onChange={(e) => {
                setPromo(e.target.value.toUpperCase());
                setQuote(null);
              }}
              placeholder="ex. CRACIUN-AB3CD"
              style={{ maxWidth: 220 }}
            />
            <button
              type="button"
              className="ghost"
              disabled={busy || !promo.trim()}
              onClick={() => run(async () => setQuote(await api<{ price: number; discount: number }>('POST', '/admin/gift-promos/quote', { code: promo, amount: Number(amount) })))}
            >
              Verifică
            </button>
          </div>
          {quote ? (
            <div className="small success" style={{ marginTop: 4 }}>
              Încasezi {lei(quote.price)} (reducere {lei(quote.discount)}); cardul rămâne de {lei(Number(amount))}.
            </div>
          ) : null}
        </Field>
        {error ? <div className="err">{error}</div> : null}
        <button
          disabled={busy}
          onClick={() => run(async () => onDone(await api<GiftCard>('POST', '/admin/gift-cards', { amount: Number(amount), recipientName, recipientPhone, message, payMethod: method, promoCode: promo.trim() || undefined })))}
        >
          Încasat{quote ? ` ${lei(quote.price)}` : ''} ({method === 'card' ? 'card' : method === 'transfer' ? 'transfer' : 'numerar'}), generează codul
        </button>
      </div>
    </Modal>
  );
}
