import { useState } from 'react';
import { api, type Subscription } from '../api';
import { useAction, useLoad } from '../ui';
import { lei, TZ } from '../util';

/** „19 dec. 2026”: cu anul, ca să nu fie confuzie la cardurile valabile un an. */
const dateF = new Intl.DateTimeFormat('ro-RO', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const date = (iso: string) => dateF.format(new Date(iso));
import type { GiftCard } from './GiftCards';

/** Card cadou din fișa clientului: `received` = primit de la altcineva, `bought` = cumpărat de el. */
export type ClientGiftCard = GiftCard & { role: 'bought' | 'received'; forSelf: boolean };
/** Rest de plată lăsat la închiderea unei programări. */
export type Debt = {
  id: string;
  bookingId: string;
  amount: number;
  createdAt: string;
  createdByName: string | null;
  bookingAt: string | null;
  serviceName: string | null;
  barberName: string | null;
  state: 'open' | 'settled' | 'cancelled';
  settledAt: string | null;
  settledMethod: string | null;
  settledByName: string | null;
};
export type FreeService = { id: string; bookingId: string; at: string; serviceName: string; barberName: string; value: number; givenByName: string | null; bonusTitle: string | null };
export type Wallet = { subscriptions: Subscription[]; giftCards: ClientGiftCard[]; debts: Debt[] };

const METHOD: Record<string, string> = { cash: 'numerar', card: 'card (POS)', transfer: 'transfer' };

/** „restul de 20 lei de la Tuns Clasic din 12 nov. 2026 (Andrei)”. */
export const debtLine = (d: Debt) =>
  `restul de ${lei(d.amount)}${d.serviceName ? ` de la ${d.serviceName}` : ''}${d.bookingAt ? ` din ${date(d.bookingAt)}` : ''}${d.barberName ? ` (${d.barberName})` : ''}`;

/** În fișa clientului: resturile de plată, cu încasare (oricine încasează) și iertare (proprietarul). */
export function ClientDebts({ clientId, debts, owner, onChange }: { clientId: string; debts: Debt[]; owner: boolean; onChange: () => void }) {
  const [method, setMethod] = useState('cash');
  const { busy, error, run } = useAction();
  if (!debts.length) return <div className="muted small">Nu are rest de plată.</div>;
  const open = debts.filter((d) => d.state === 'open');
  const total = open.reduce((n, d) => n + d.amount, 0);
  return (
    <div className="grid" style={{ gap: 0 }}>
      {open.length ? (
        <div className="row small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
          <b className="err">Are de plătit: {lei(total)}</b>
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 130 }} aria-label="Cum plătește restul">
            <option value="cash">numerar</option>
            <option value="card">card (POS)</option>
            <option value="transfer">transfer</option>
          </select>
          <button
            className="sm"
            disabled={busy}
            onClick={() =>
              confirm(`Clientul a plătit acum tot restul, ${lei(total)} (${METHOD[method]})?`) &&
              run(async () => {
                await api('POST', `/admin/clients/${clientId}/debts/settle`, { ids: open.map((d) => d.id), payMethod: method });
                onChange();
              })
            }
          >
            Încasează tot
          </button>
        </div>
      ) : null}
      {debts.map((d) => (
        <div key={d.id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '6px 0', gap: 8 }}>
          <span style={{ opacity: d.state === 'open' ? 1 : 0.6 }}>
            <b>{lei(d.amount)}</b>
            <span className="muted">
              {' '}
              · {d.serviceName ?? 'programare'}
              {d.bookingAt ? ` din ${date(d.bookingAt)}` : ''}
              {d.barberName ? ` · ${d.barberName}` : ''}
              {d.createdByName ? ` · lăsat de ${d.createdByName}` : ''}
              {d.state === 'settled' && d.settledAt ? ` · încasat pe ${date(d.settledAt)} (${METHOD[d.settledMethod ?? 'cash'] ?? d.settledMethod}${d.settledByName ? `, ${d.settledByName}` : ''})` : ''}
            </span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className={`pill ${d.state === 'open' ? 'cancelled' : 'off'}`}>{d.state === 'open' ? 'De încasat' : d.state === 'settled' ? 'Încasat' : 'Iertat'}</span>
            {d.state === 'open' ? (
              <button
                className="ghost sm"
                disabled={busy}
                onClick={() =>
                  confirm(`Clientul a plătit acum ${lei(d.amount)} (${METHOD[method]})?`) &&
                  run(async () => {
                    await api('POST', `/admin/clients/${clientId}/debts/settle`, { ids: [d.id], payMethod: method });
                    onChange();
                  })
                }
              >
                Încasează
              </button>
            ) : null}
            {owner && d.state === 'open' ? (
              <button
                className="ghost sm"
                disabled={busy}
                onClick={() =>
                  confirm(`Ierți restul de ${lei(d.amount)}? Nu se mai cere clientului și nu intră în încasări.`) &&
                  run(async () => {
                    await api('POST', `/admin/debts/${d.id}/cancel`);
                    onChange();
                  })
                }
              >
                Iartă
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {error ? <div className="err small">{error}</div> : null}
    </div>
  );
}

/** În fișa clientului: serviciile primite gratuit (oferite cadou la închidere sau printr-un bonus „serviciu gratuit”). */
export function ClientFreeServices({ list }: { list: FreeService[] }) {
  if (!list.length) return <div className="muted small">Nu a primit servicii gratuite.</div>;
  return (
    <div className="grid" style={{ gap: 0 }}>
      {list.map((f) => (
        <div key={f.id} className="small" style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
          🎁 <b>{f.serviceName}</b>
          <span className="muted">
            {' '}
            · {date(f.at)} · {f.barberName} · valoare {lei(f.value)}
            {f.bonusTitle ? ` · bonus „${f.bonusTitle}”` : ''}
            {f.givenByName ? ` · oferit de ${f.givenByName}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

const sedinte = (n: number) => `${n} ${n === 1 ? 'ședință' : 'ședințe'}`;

/** „Mai are 2 ședințe din 4 · valabil până pe 12 dec.” (sau „nelimitat”, sau „începe pe …”). */
export function subLeftText(s: Subscription) {
  const left = s.cutsTotal === null ? 'ședințe nelimitate' : `mai are ${sedinte(Math.max(0, s.cutsTotal - s.cutsUsed))} din ${s.cutsTotal}`;
  const when = s.state === 'upcoming' ? `începe pe ${date(s.startsAt)}, valabil până pe ${date(s.endsAt)}` : `valabil până pe ${date(s.endsAt)}`;
  return `${left} · ${when}`;
}

const GIFT_STATE: Record<GiftCard['status'], string> = { pending: 'neplătit încă', active: 'activ', used: 'folosit tot', cancelled: 'anulat', expired: 'expirat' };

/** O linie despre un card cadou: „TAF-AB12-CD34 · sold 80 lei din 120 lei · activ · valabil până pe …”. */
export function giftText(g: ClientGiftCard) {
  const who =
    g.role === 'received' ? `primit${g.buyerName ? ` de la ${g.buyerName}` : ''}` : g.forSelf ? 'cumpărat pentru el' : `cumpărat pentru ${g.recipientName || 'altcineva'}`;
  return [
    g.status === 'pending' ? `${lei(g.amount)}` : `sold ${lei(g.balance)} din ${lei(g.amount)}`,
    who,
    GIFT_STATE[g.status],
    g.status === 'active' && g.expiresAt ? `valabil până pe ${date(g.expiresAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Lista cardurilor cadou din fișa clientului. */
export function ClientGiftCards({ cards }: { cards: ClientGiftCard[] }) {
  if (!cards.length) return <div className="muted small">Nu are carduri cadou.</div>;
  return (
    <div className="grid" style={{ gap: 0 }}>
      {cards.map((g) => (
        <div key={g.id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '6px 0', gap: 8 }}>
          <span style={{ opacity: g.status === 'active' ? 1 : 0.6 }}>
            <b>{g.code ?? 'Card cadou'}</b>
            <span className="muted"> · {giftText(g)}</span>
          </span>
          <span className={`pill ${g.status === 'active' ? 'completed' : g.status === 'pending' ? 'confirmed' : 'off'}`}>{g.status === 'active' ? lei(g.balance) : GIFT_STATE[g.status]}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * În panoul programării: ce poate folosi clientul acum (abonamente în vigoare cu ședințele rămase, carduri cadou cu sold).
 * `onUseGift`: la încasare, completează codul cardului cu un clic.
 */
export function WalletBox({ clientId, onUseGift, giftsOnly }: { clientId: string; onUseGift?: (code: string) => void; giftsOnly?: boolean }) {
  const w = useLoad(() => api<Wallet>('GET', `/admin/clients/${clientId}/wallet`), [clientId]);
  if (!w.data) return null;
  const subs = giftsOnly ? [] : w.data.subscriptions;
  const gifts = w.data.giftCards;
  const debts = giftsOnly ? [] : (w.data.debts ?? []);
  if (!subs.length && !gifts.length && !debts.length) return giftsOnly ? null : <div className="muted small">Nu are abonament activ și nici card cadou.</div>;
  return (
    <div className="drawer-card" style={{ border: `1px solid ${debts.length ? 'var(--danger, #d33)' : 'var(--gold)'}` }}>
      {debts.length ? (
        <div className="small">
          ⚠️ <b className="err">Are rest de plată: {lei(debts.reduce((n, d) => n + d.amount, 0))}</b>
          {debts.map((d) => (
            <div key={d.id} className="muted">
              {debtLine(d)}
            </div>
          ))}
        </div>
      ) : null}
      {subs.map((s) => (
        <div key={s.id} className="small">
          🎟️ <b>{/^abonament/i.test(s.name) ? s.name : `Abonament ${s.name}`}</b>
          <div className="muted">{subLeftText(s)}</div>
        </div>
      ))}
      {gifts.map((g) => (
        <div key={g.id} className="small row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span>
            🎁 <b>Card cadou {g.code ?? ''}</b>
            <div className="muted">
              sold {lei(g.balance)} din {lei(g.amount)}
              {g.expiresAt ? ` · valabil până pe ${date(g.expiresAt)}` : ''}
            </div>
          </span>
          {onUseGift && g.code ? (
            <button type="button" className="ghost sm" onClick={() => onUseGift(g.code!)}>
              Folosește
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
