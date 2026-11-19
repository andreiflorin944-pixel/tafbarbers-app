import { api, type Subscription } from '../api';
import { useLoad } from '../ui';
import { lei, TZ } from '../util';

/** „19 dec. 2026”: cu anul, ca să nu fie confuzie la cardurile valabile un an. */
const dateF = new Intl.DateTimeFormat('ro-RO', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const date = (iso: string) => dateF.format(new Date(iso));
import type { GiftCard } from './GiftCards';

/** Card cadou din fișa clientului: `received` = primit de la altcineva, `bought` = cumpărat de el. */
export type ClientGiftCard = GiftCard & { role: 'bought' | 'received'; forSelf: boolean };
export type Wallet = { subscriptions: Subscription[]; giftCards: ClientGiftCard[] };

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
  if (!subs.length && !gifts.length) return giftsOnly ? null : <div className="muted small">Nu are abonament activ și nici card cadou.</div>;
  return (
    <div className="drawer-card" style={{ border: '1px solid var(--gold)' }}>
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
