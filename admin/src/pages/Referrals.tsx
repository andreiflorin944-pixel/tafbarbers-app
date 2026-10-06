import { useEffect, useState } from 'react';
import { api, type Bonus, type BonusKind, type Referral, type ReferralSettings, type Reward } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { date } from '../util';

const KINDS: Record<BonusKind, string> = {
  percent: 'Reducere procentuală (%)',
  amount: 'Reducere fixă (lei)',
  free: 'Tunsoare gratuită',
  other: 'Alt beneficiu (ex. produs cadou)',
};

/** Formular pentru un beneficiu: titlul pe care îl vede clientul, tipul, valoarea și valabilitatea. */
export function RewardFields({ value: r, onChange }: { value: Reward; onChange: (r: Reward) => void }) {
  return (
    <div className="grid">
      <Field label="Ce vede clientul (ex. 10% reducere la următoarea tunsoare)">
        <input value={r.title} onChange={(e) => onChange({ ...r, title: e.target.value })} maxLength={120} />
      </Field>
      <div className="grid two">
        <Field label="Tip">
          <select value={r.kind} onChange={(e) => onChange({ ...r, kind: e.target.value as BonusKind, value: ['percent', 'amount'].includes(e.target.value) ? r.value ?? 10 : null })}>
            {Object.entries(KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {r.kind === 'percent' || r.kind === 'amount' ? (
          <Field label={r.kind === 'percent' ? 'Procent' : 'Lei'}>
            <input type="number" min={1} value={r.value ?? ''} onChange={(e) => onChange({ ...r, value: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
        ) : (
          <div />
        )}
      </div>
      <Field label="Valabil (zile; gol = fără termen)">
        <input type="number" min={1} value={r.validDays ?? ''} onChange={(e) => onChange({ ...r, validDays: e.target.value === '' ? null : Number(e.target.value) })} style={{ maxWidth: 160 }} />
      </Field>
    </div>
  );
}

const EMPTY: Reward = { title: '', kind: 'percent', value: 10, validDays: 90 };
const STATUS: Record<Bonus['status'], string> = { active: 'Activ', used: 'Folosit', expired: 'Expirat' };

/** Bonusurile unui client în fișa lui: marcare folosit / anulare și adăugare (standard sau personalizat). */
export function ClientBonuses({ clientId, bonuses, owner, onChange }: { clientId: string; bonuses: Bonus[]; owner: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [r, setR] = useState<Reward>(EMPTY);
  const { busy, error, run } = useAction();
  const setStatus = (id: string, status: string) => run(async () => { await api('PATCH', `/admin/bonuses/${id}`, { status }); onChange(); });
  return (
    <div className="grid">
      {bonuses.length === 0 ? <div className="muted small">Niciun bonus.</div> : null}
      {bonuses.map((b) => (
        <div key={b.id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '6px 0', gap: 8 }}>
          <span style={{ opacity: b.status === 'active' ? 1 : 0.6 }}>
            <b>{b.title}</b>
            <span className="muted">
              {' '}
              · {b.source === 'referral' ? `recomandare${b.referralName ? `: ${b.referralName}` : ''}` : 'manual'} · din {date(b.createdAt)}
              {b.status === 'active' && b.expiresAt ? ` · până pe ${date(b.expiresAt)}` : ''}
              {b.usedAt ? ` · folosit pe ${date(b.usedAt)}` : ''}
            </span>
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className="muted">{STATUS[b.status]}</span>
            {b.status === 'active' ? (
              <button className="sm" disabled={busy} onClick={() => confirm(`Marchezi „${b.title}” ca folosit?`) && setStatus(b.id, 'used')}>
                Folosit
              </button>
            ) : null}
            {owner && b.status === 'active' ? (
              <button className="ghost sm" disabled={busy} onClick={() => confirm('Anulezi bonusul?') && setStatus(b.id, 'cancelled')}>
                Anulează
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {owner ? (
        adding ? (
          <div className="card grid">
            <RewardFields value={r} onChange={setR} />
            <div className="row">
              <button
                disabled={busy || !r.title.trim()}
                onClick={() =>
                  run(async () => {
                    await api('POST', `/admin/clients/${clientId}/bonuses`, r);
                    setAdding(false);
                    setR(EMPTY);
                    onChange();
                  })
                }
              >
                Dă bonusul
              </button>
              <button className="ghost" onClick={() => setAdding(false)}>
                Renunță
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="ghost sm" disabled={busy} onClick={() => run(async () => { await api('POST', `/admin/clients/${clientId}/bonuses`, { standard: true }); onChange(); })}>
              + Bonusul standard
            </button>
            <button className="ghost sm" onClick={() => setAdding(true)}>
              + Bonus personalizat
            </button>
          </div>
        )
      ) : null}
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

export function ReferralsPage() {
  const settings = useLoad(() => api<ReferralSettings>('GET', '/admin/referral-settings'));
  const list = useLoad(() => api<Referral[]>('GET', '/admin/referrals'));
  const [s, setS] = useState<ReferralSettings | null>(null);
  const [custom, setCustom] = useState<{ ref: Referral; r: Reward } | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  if (!s) return <Loading error={settings.error} />;
  const dirty = JSON.stringify(s) !== JSON.stringify(settings.data);
  const give = (ref: Referral, body: object) =>
    run(async () => {
      await api('POST', `/admin/clients/${ref.referrer.id}/bonuses`, { ...body, referralOf: ref.newClient.id });
      setCustom(null);
      list.reload();
    });

  return (
    <>
      <div className="head">
        <h1>Recomandări și bonusuri</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Fiecare client are în aplicație un cod și un link de recomandare. Când cineva își face cont cu el, cel care l-a recomandat primește un beneficiu:
        automat beneficiul standard de mai jos sau, dacă oprești varianta automată, îl alegi tu pentru fiecare recomandare. Bonusurile le marchează
        frizerul ca folosite, din aplicație sau din fișa clientului.
      </p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 360px', maxWidth: 520 }}>
          <label className="check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => { setSaved(false); setS({ ...s, enabled: e.target.checked }); }} /> Recomandările sunt pornite
          </label>
          <label className="check">
            <input type="checkbox" checked={s.auto} onChange={(e) => { setSaved(false); setS({ ...s, auto: e.target.checked }); }} /> Dă automat beneficiul standard la fiecare cont nou
          </label>
          <h2 style={{ margin: '6px 0 0' }}>Beneficiul standard</h2>
          <RewardFields value={s.standard} onChange={(standard) => { setSaved(false); setS({ ...s, standard }); }} />
          {error ? <div className="err">{error}</div> : null}
          <div className="row">
            <button
              disabled={busy || !dirty}
              onClick={() =>
                run(async () => {
                  await api('PUT', '/admin/referral-settings', s);
                  setSaved(true);
                  settings.reload();
                })
              }
            >
              Salvează
            </button>
            {saved && !dirty ? <span className="success small">Salvat.</span> : null}
          </div>
        </div>
        <div className="card" style={{ flex: '2 1 480px' }}>
          <h2 style={{ marginTop: 0 }}>Conturi create prin recomandare</h2>
          {!list.data ? (
            <Loading error={list.error} />
          ) : list.data.length === 0 ? (
            <div className="muted small">Încă niciuna.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Client nou</th>
                  <th>Recomandat de</th>
                  <th>Data</th>
                  <th>Beneficiu</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((x) => (
                  <tr key={x.newClient.id}>
                    <td>
                      {x.newClient.name || x.newClient.phone}
                      <div className="muted small">{x.newClient.phone}</div>
                    </td>
                    <td>
                      {x.referrer.name || x.referrer.phone}
                      <div className="muted small">{x.referrer.phone}</div>
                    </td>
                    <td className="small">{date(x.createdAt)}</td>
                    <td className="small">
                      {x.bonusTitle ? (
                        x.bonusTitle
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <button className="sm" disabled={busy} onClick={() => give(x, { standard: true })}>
                            Dă standard
                          </button>
                          <button className="ghost sm" onClick={() => setCustom({ ref: x, r: { ...s.standard, title: '' } })}>
                            Personalizat
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {custom ? (
            <div className="card grid" style={{ marginTop: 12 }}>
              <b>Beneficiu pentru {custom.ref.referrer.name || custom.ref.referrer.phone}</b>
              <RewardFields value={custom.r} onChange={(r) => setCustom({ ...custom, r })} />
              <div className="row">
                <button disabled={busy || !custom.r.title.trim()} onClick={() => give(custom.ref, custom.r)}>
                  Dă beneficiul
                </button>
                <button className="ghost" onClick={() => setCustom(null)}>
                  Renunță
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
