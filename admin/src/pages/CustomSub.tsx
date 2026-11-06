import { useEffect, useState } from 'react';
import { api, type CustomQuote, type CustomSubSettings, type Service, type Subscription } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { lei } from '../util';

// Abonamentul personalizat: clientul își alege singur serviciile pe o lună, iar reducerea crește cu numărul de vizite.
// Aici: setările (proprietarul) și activarea unuia plătit la salon, din fișa clientului.

/** „Barbă 1/1 · Tuns Clasic 1/2”: cât s-a folosit din fiecare serviciu al abonamentului personalizat. */
export const itemsUsedText = (s: Subscription, services: Array<Pick<Service, 'id' | 'name'>>) =>
  (s.items ?? []).map((i) => `${services.find((x) => x.id === i.serviceId)?.name ?? i.serviceId} ${i.used}/${i.qty}`).join(' · ');

/** Prețul pentru `n` vizite, ca în server: treapta cea mai mare până la n. */
const discountFor = (d: Record<string, number>, n: number) => {
  let best = 0;
  let at = 0;
  for (const [k, v] of Object.entries(d)) if (Number(k) <= n && Number(k) >= at) [best, at] = [v, Number(k)];
  return best;
};

export function CustomSubSettingsCard({ owner, services }: { owner: boolean; services: Service[] }) {
  const cur = useLoad(() => api<CustomSubSettings>('GET', '/admin/custom-sub'));
  const [v, setV] = useState<CustomSubSettings | null>(null);
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (cur.data) setV(cur.data);
  }, [cur.data]);
  if (!v) return <Loading error={cur.error} />;
  const set = (p: Partial<CustomSubSettings>) => {
    setSaved(false);
    setV({ ...v, ...p });
  };
  const steps = Array.from({ length: Math.max(0, v.maxVisits - v.minVisits + 1) }, (_, i) => v.minVisits + i);
  const ids = v.serviceIds;
  const active = services.filter((s) => s.active);
  // Exemplu cu cel mai ieftin tuns din listă, ca să se vadă efectul procentelor.
  const sample = active.find((s) => /clasic|classic/i.test(s.name)) ?? active[0];

  return (
    <div className="card grid" style={{ maxWidth: 760 }}>
      <div className="head" style={{ margin: 0 }}>
        <h2 style={{ margin: 0 }}>Abonament personalizat</h2>
        <label className="check">
          <input type="checkbox" disabled={!owner} checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Pornit în aplicație
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Clientul își construiește singur abonamentul din aplicație: alege serviciile și de câte ori (ex. 2 × Skin Fade + 2 × Barbă), iar reducerea crește
        cu numărul de vizite. Un serviciu combinat (tuns + barbă) e o singură vizită. Prețul se rotunjește în jos la leu. La plată alege „Retragere
        automată lunară” de pe card sau „Plătesc eu în fiecare lună”. La salon îl activezi din fișa clientului.
      </p>
      <div className="grid two">
        <Field label="Minim vizite">
          <input type="number" min={1} max={20} disabled={!owner} value={v.minVisits} onChange={(e) => set({ minVisits: Number(e.target.value) })} />
        </Field>
        <Field label="Maxim vizite pe lună">
          <input type="number" min={1} max={20} disabled={!owner} value={v.maxVisits} onChange={(e) => set({ maxVisits: Number(e.target.value) })} />
        </Field>
        <Field label="Valabil (zile)">
          <input type="number" min={7} max={365} disabled={!owner} value={v.periodDays} onChange={(e) => set({ periodDays: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Reducere după numărul de vizite (%)">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {steps.map((n) => (
            <label key={n} className="small" style={{ display: 'grid', gap: 2 }}>
              {n} vizite
              <input
                type="number"
                min={0}
                max={90}
                disabled={!owner}
                style={{ width: 80 }}
                value={v.discounts[String(n)] ?? ''}
                onChange={(e) => set({ discounts: { ...v.discounts, [String(n)]: Number(e.target.value) } })}
              />
              {sample ? (
                <span className="muted">
                  {n} × {lei(sample.price)} → {lei(Math.floor((sample.price * n * (100 - discountFor(v.discounts, n))) / 100))}
                </span>
              ) : null}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Ce servicii pot intra (nimic bifat = toate)">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {active.map((s) => (
            <label key={s.id} className="check small">
              <input
                type="checkbox"
                disabled={!owner}
                checked={ids.includes(s.id)}
                onChange={(e) => set({ serviceIds: e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id) })}
              />{' '}
              {s.name}
            </label>
          ))}
        </div>
      </Field>
      {error ? <div className="err">{error}</div> : null}
      {owner ? (
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                // Doar treptele dintre minim și maxim.
                const discounts = Object.fromEntries(steps.map((n) => [String(n), Number(v.discounts[String(n)] ?? 0)]));
                setV(await api<CustomSubSettings>('PUT', '/admin/custom-sub', { ...v, discounts }));
                setSaved(true);
              })
            }
          >
            Salvează
          </button>
          {saved ? <span className="muted small">Salvat.</span> : null}
        </div>
      ) : (
        <div className="muted small">Doar proprietarul schimbă setările.</div>
      )}
    </div>
  );
}

/** Din fișa clientului: alegi serviciile, vezi prețul cu reducere și activezi abonamentul plătit la salon. */
export function CustomSubBuilder({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const settings = useLoad(() => api<CustomSubSettings>('GET', '/admin/custom-sub'));
  const services = useLoad(() => api<Service[]>('GET', '/admin/services'));
  const [qty, setQty] = useState<Record<string, number>>({});
  const [payMethod, setPayMethod] = useState('cash');
  const [quote, setQuote] = useState<CustomQuote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const items = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([serviceId, q]) => ({ serviceId, qty: q }));
  const visits = items.reduce((a, i) => a + i.qty, 0);
  const key = JSON.stringify(items);
  useEffect(() => {
    setQuote(null);
    setQErr(null);
    if (!settings.data || visits < settings.data.minVisits) return;
    let live = true;
    api<CustomQuote>('POST', '/admin/custom-sub/quote', { items }).then(
      (q) => live && setQuote(q),
      (e: Error) => live && setQErr(e.message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settings.data]);

  if (!settings.data || !services.data) return <Loading error={settings.error ?? services.error} />;
  const st = settings.data;
  const list = services.data.filter((s) => s.active && (!st.serviceIds.length || st.serviceIds.includes(s.id)));
  return (
    <div className="card grid">
      <b>Abonament personalizat plătit la salon</b>
      <div className="muted small">
        {st.minVisits}–{st.maxVisits} vizite în {st.periodDays} zile ·{' '}
        {Object.entries(st.discounts)
          .map(([n, p]) => `${n} vizite: ${p}%`)
          .join(' · ')}
      </div>
      <div className="grid" style={{ gap: 6 }}>
        {list.map((s) => {
          const q = qty[s.id] ?? 0;
          return (
            <div key={s.id} className="row small" style={{ justifyContent: 'space-between' }}>
              <span>
                {s.name} <span className="muted">· {lei(s.price)}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button className="ghost sm" disabled={q === 0} onClick={() => setQty({ ...qty, [s.id]: q - 1 })}>
                  −
                </button>
                <b style={{ minWidth: 16, textAlign: 'center' }}>{q}</b>
                <button className="ghost sm" disabled={visits >= st.maxVisits} onClick={() => setQty({ ...qty, [s.id]: q + 1 })}>
                  +
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {quote ? (
        <div>
          {quote.visits} vizite · reducere {quote.discount}% · <s className="muted">{lei(quote.fullPrice)}</s> <b>{lei(quote.price)}</b>
        </div>
      ) : (
        <div className="muted small">{qErr ?? `Alege cel puțin ${st.minVisits} vizite.`}</div>
      )}
      <Field label="Cum a plătit">
        <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="cash">Numerar</option>
          <option value="card">Card la POS</option>
          <option value="transfer">Transfer</option>
        </select>
      </Field>
      {error ? <div className="err">{error}</div> : null}
      <div className="row">
        <button
          disabled={busy || !quote}
          onClick={() =>
            quote &&
            confirm(`Clientul a plătit ${lei(quote.price)} pentru „${quote.name}”?`) &&
            run(async () => {
              await api('POST', `/admin/clients/${clientId}/custom-sub`, { items, payMethod });
              onDone();
            })
          }
        >
          Activează
        </button>
        <button className="ghost" onClick={onCancel}>
          Renunță
        </button>
      </div>
    </div>
  );
}
