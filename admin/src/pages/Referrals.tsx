import { Fragment, useEffect, useState } from 'react';
import { api, type Bonus, type BonusKind, type Plan, type Referral, type ReferralBonus, type ReferralSettings, type Reward } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { date, lei } from '../util';

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
      <div className="grid two">
        <Field label="Valabil">
          <select value={r.validDays === null ? 'next' : 'days'} onChange={(e) => onChange({ ...r, validDays: e.target.value === 'next' ? null : (r.validDays ?? 30) })}>
            <option value="next">La următoarea tunsoare</option>
            <option value="days">O perioadă de timp</option>
          </select>
        </Field>
        {r.validDays !== null ? (
          <Field label="Câte zile">
            <input type="number" min={1} value={r.validDays} onChange={(e) => onChange({ ...r, validDays: e.target.value === '' ? 1 : Number(e.target.value) })} style={{ maxWidth: 160 }} />
          </Field>
        ) : (
          <div />
        )}
      </div>
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

type Target = { clientId: string; referralOf: string; name: string; side: 'referrer' | 'new' };

export function ReferralsPage() {
  const settings = useLoad(() => api<ReferralSettings>('GET', '/admin/referral-settings'));
  const list = useLoad(() => api<Referral[]>('GET', '/admin/referrals'));
  const [s, setS] = useState<ReferralSettings | null>(null);
  const [custom, setCustom] = useState<{ to: Target; r: Reward } | null>(null);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  if (!s) return <Loading error={settings.error} />;
  const dirty = JSON.stringify(s) !== JSON.stringify(settings.data);
  const edit = (patch: Partial<ReferralSettings>) => {
    setSaved(false);
    setNote('');
    setS({ ...s, ...patch });
  };
  const give = (to: Target, body: object) =>
    run(async () => {
      await api('POST', `/admin/clients/${to.clientId}/bonuses`, { ...body, referralOf: to.referralOf });
      setCustom(null);
      list.reload();
    });
  const remove = (b: ReferralBonus) =>
    confirm(`Ștergi bonusul „${b.title}”? Clientul nu-l mai vede în aplicație.`) &&
    run(async () => {
      await api('PATCH', `/admin/bonuses/${b.id}`, { status: 'cancelled' });
      list.reload();
    });
  const refresh = (side: 'referrer' | 'new') =>
    run(async () => {
      const r = await api<{ updated: number }>('POST', '/admin/referral-settings/refresh', { side });
      setNote(r.updated ? `Am actualizat ${r.updated === 1 ? 'un bonus' : `${r.updated} bonusuri`}.` : 'Nu era niciun bonus nefolosit de actualizat.');
      list.reload();
    });

  const cell = (b: ReferralBonus | null, to: Target) =>
    b ? (
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span>
          {b.title}
          {b.used ? <span className="muted"> · folosit</span> : null}
        </span>
        {!b.used ? (
          <button className="ghost sm" disabled={busy} onClick={() => remove(b)}>
            Șterge
          </button>
        ) : null}
      </div>
    ) : (
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="sm" disabled={busy} onClick={() => give(to, to.side === 'new' ? { welcome: true } : { standard: true })}>
          Dă standard
        </button>
        <button className="ghost sm" onClick={() => setCustom({ to, r: { ...(to.side === 'new' ? s.welcome : s.standard), title: '' } })}>
          Personalizat
        </button>
      </div>
    );

  const side = (title: string, on: boolean, setOn: (v: boolean) => void, r: Reward, setR: (r: Reward) => void, sideKey: 'referrer' | 'new') => (
    <div className="grid" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> <b>{title}</b>
      </label>
      {on ? <RewardFields value={r} onChange={setR} /> : null}
      <button className="ghost sm" style={{ justifySelf: 'start' }} disabled={busy || dirty} title={dirty ? 'Salvează întâi' : ''} onClick={() => refresh(sideKey)}>
        Aplică beneficiul de acum și bonusurilor deja date, nefolosite
      </button>
    </div>
  );

  return (
    <>
      <div className="head">
        <h1>Recomandări și bonusuri</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Fiecare client are în aplicație un cod și un link de recomandare. Când cineva își face cont cu el, pot primi bonus cel care a recomandat, clientul nou
        sau amândoi: automat, cu beneficiile de mai jos, sau îl dai tu din listă. Ce schimbi aici se aplică recomandărilor de acum înainte; bonusurile deja date
        rămân cum erau, dacă nu apeși „Aplică… bonusurilor deja date”. Bonusurile le marchează frizerul ca folosite, din aplicație sau din fișa clientului.
      </p>
      <ReferralTree standard={s.standard} />
      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 360px', maxWidth: 520 }}>
          <label className="check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => edit({ enabled: e.target.checked })} /> Recomandările sunt pornite
          </label>
          <label className="check">
            <input type="checkbox" checked={s.auto} onChange={(e) => edit({ auto: e.target.checked })} /> Dă automat bonusurile bifate mai jos, la fiecare cont nou
          </label>
          {side('Bonus pentru cel care a recomandat', s.toReferrer, (v) => edit({ toReferrer: v }), s.standard, (standard) => edit({ standard }), 'referrer')}
          {side('Bonus pentru clientul nou, venit prin recomandare', s.toNew, (v) => edit({ toNew: v }), s.welcome, (welcome) => edit({ welcome }), 'new')}
          {error ? <div className="err">{error}</div> : null}
          {note ? <div className="success small">{note}</div> : null}
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
            {saved && !dirty ? <span className="success small">Salvat. Se aplică recomandărilor noi.</span> : null}
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
                  <th>Bonusul celui care a recomandat</th>
                  <th>Bonusul clientului nou</th>
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
                      {cell(x.referrerBonus, { clientId: x.referrer.id, referralOf: x.newClient.id, name: x.referrer.name || x.referrer.phone, side: 'referrer' })}
                    </td>
                    <td className="small">
                      {cell(x.newBonus, { clientId: x.newClient.id, referralOf: x.referrer.id, name: x.newClient.name || x.newClient.phone, side: 'new' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {custom ? (
            <div className="card grid" style={{ marginTop: 12 }}>
              <b>Bonus pentru {custom.to.name}</b>
              <RewardFields value={custom.r} onChange={(r) => setCustom({ ...custom, r })} />
              <div className="row">
                <button disabled={busy || !custom.r.title.trim()} onClick={() => give(custom.to, custom.r)}>
                  Dă bonusul
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

type TreeNode = {
  referrer: { id: string; name: string };
  count: number;
  active: number;
  spent: number | null;
  bonuses: number;
  people: Array<{ id: string; name: string; createdAt: string; visits: number; spent: number | null; bonusTitle: string | null }>;
};

/** Cine pe cine a adus: clienții care au recomandat, cu oamenii aduși, și premierea lor (bonus sau pachet cadou). */
function ReferralTree({ standard }: { standard: Reward }) {
  const tree = useLoad(() => api<TreeNode[]>('GET', '/admin/referrals/tree'));
  const plans = useLoad(() => api<Plan[]>('GET', '/admin/plans'));
  const [open, setOpen] = useState<string | null>(null);
  const [award, setAward] = useState<TreeNode | null>(null);
  const [mode, setMode] = useState<'bonus' | 'plan'>('bonus');
  const [r, setR] = useState<Reward>(standard);
  const [planId, setPlanId] = useState('');
  const [done, setDone] = useState('');
  const { busy, error, run } = useAction();

  const start = (n: TreeNode) => {
    setAward(n);
    setMode('bonus');
    setR({ ...standard, title: `Mulțumim pentru ${n.count === 1 ? 'recomandare' : `cele ${n.count} recomandări`}` });
    setPlanId(plans.data?.find((p) => p.active)?.id ?? '');
  };
  const give = () =>
    run(async () => {
      if (!award) return;
      if (mode === 'bonus') await api('POST', `/admin/clients/${award.referrer.id}/bonuses`, r);
      else await api('POST', `/admin/clients/${award.referrer.id}/subscriptions`, { planId, gift: true, note: `Cadou pentru ${award.count} recomandări` });
      setDone(`${award.referrer.name || 'Clientul'} a primit ${mode === 'bonus' ? r.title : 'pachetul cadou'}. Îl vede în aplicație.`);
      setAward(null);
      tree.reload();
    });

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ marginTop: 0 }}>Cine pe cine a adus</h2>
      <p className="muted small" style={{ marginTop: -6 }}>
        Clienții care au adus alți clienți, în ordinea numărului de oameni aduși. Apasă pe un rând ca să vezi pe cine a adus și cât au cheltuit, apoi îl poți
        premia cu un bonus sau cu un pachet cadou.
      </p>
      {done ? <div className="success small" style={{ marginBottom: 8 }}>{done}</div> : null}
      {!tree.data ? (
        <Loading error={tree.error} />
      ) : tree.data.length === 0 ? (
        <div className="muted small">Încă nu a adus nimeni pe nimeni.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th style={{ textAlign: 'right' }}>Oameni aduși</th>
              <th style={{ textAlign: 'right' }}>Au venit la tuns</th>
              {tree.data[0].spent !== null ? <th style={{ textAlign: 'right' }}>Au cheltuit</th> : null}
              <th style={{ textAlign: 'right' }}>Bonusuri primite</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tree.data.map((n) => (
              <Fragment key={n.referrer.id}>
                <tr className="click" onClick={() => setOpen(open === n.referrer.id ? null : n.referrer.id)}>
                  <td>
                    <b>{open === n.referrer.id ? '▾' : '▸'} {n.referrer.name || 'Fără nume'}</b>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <b>{n.count}</b>
                  </td>
                  <td style={{ textAlign: 'right' }}>{n.active}</td>
                  {n.spent !== null ? <td style={{ textAlign: 'right' }}>{lei(n.spent)}</td> : null}
                  <td style={{ textAlign: 'right' }}>{n.bonuses}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        start(n);
                      }}
                    >
                      Premiază
                    </button>
                  </td>
                </tr>
                {open === n.referrer.id
                  ? n.people.map((p) => (
                      <tr key={p.id} className="small">
                        <td style={{ paddingLeft: 30 }}>{p.name || 'Fără nume'}</td>
                        <td style={{ textAlign: 'right' }} className="muted">
                          cont din {date(p.createdAt)}
                        </td>
                        <td style={{ textAlign: 'right' }}>{p.visits ? `${p.visits} ${p.visits === 1 ? 'vizită' : 'vizite'}` : <span className="muted">încă nu</span>}</td>
                        {p.spent !== null ? <td style={{ textAlign: 'right' }}>{lei(p.spent)}</td> : null}
                        <td colSpan={2} className="muted" style={{ textAlign: 'right' }}>
                          {p.bonusTitle ? `bonus: ${p.bonusTitle}` : ''}
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {award ? (
        <Modal title={`Premiază pe ${award.referrer.name || 'client'} (${award.count} ${award.count === 1 ? 'om adus' : 'oameni aduși'})`} onClose={() => setAward(null)}>
          <div className="grid">
            <div className="tabs" style={{ margin: 0 }}>
              <button className={mode === 'bonus' ? 'on' : ''} onClick={() => setMode('bonus')}>
                Bonus sau premiu
              </button>
              <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>
                Pachet cadou
              </button>
            </div>
            {mode === 'bonus' ? (
              <RewardFields value={r} onChange={setR} />
            ) : plans.data?.some((p) => p.active) ? (
              <Field label="Abonamentul oferit gratuit">
                <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {plans.data
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.cuts === null ? 'nelimitat' : `${p.cuts} tunsori`}, {p.periodDays} zile)
                      </option>
                    ))}
                </select>
              </Field>
            ) : (
              <div className="muted small">Nu ai încă abonamente. Le creezi la pagina Abonamente.</div>
            )}
            {mode === 'plan' ? <div className="muted small">Pachetul apare la client în Cont → Abonamente și nu se adună la încasări.</div> : null}
            {error ? <div className="err">{error}</div> : null}
            <div className="row">
              <button disabled={busy || (mode === 'bonus' ? !r.title.trim() : !planId)} onClick={give}>
                Oferă
              </button>
              <button className="ghost" onClick={() => setAward(null)}>
                Renunță
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
