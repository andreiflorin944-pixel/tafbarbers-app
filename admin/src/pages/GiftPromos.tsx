import { useMemo, useState } from 'react';
import { api, type Me } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { date, lei } from '../util';

// Marketing → Coduri reducere card cadou: generezi coduri (ex. pentru campania de Crăciun), le dai clienților,
// iar cine cumpără un card cadou cu un cod valid plătește mai puțin. Cardul rămâne la valoarea lui întreagă.

type Promo = {
  id: string;
  code: string;
  batch: string;
  kind: 'percent' | 'fixed';
  value: number;
  maxUses: number | null;
  used: number;
  expiresDay: string | null;
  active: boolean;
  state: 'ok' | 'off' | 'expired' | 'used_up';
  createdAt: string;
};
const STATE: Record<Promo['state'], string> = { ok: 'Activ', off: 'Oprit', expired: 'Expirat', used_up: 'Folosit' };
const off = (p: Pick<Promo, 'kind' | 'value'>) => (p.kind === 'percent' ? `−${p.value}%` : `−${lei(p.value)}`);
const day = (d: string) => d.split('-').reverse().join('.');
const siteBase = () => `${location.protocol}//${location.host.replace(/^panou\./, 'app.')}`;

export function GiftPromosPage({ me }: { me: Me }) {
  const list = useLoad(() => api<Promo[]>('GET', '/admin/gift-promos'));
  const [open, setOpen] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const batches = useMemo(() => {
    const m = new Map<string, Promo[]>();
    for (const p of list.data ?? []) m.set(p.batch, [...(m.get(p.batch) ?? []), p]);
    return [...m.entries()];
  }, [list.data]);

  const toggle = (body: { id?: string; batch?: string; active: boolean }) =>
    run(async () => {
      await api('PATCH', '/admin/gift-promos', body);
      list.reload();
    });

  return (
    <>
      <div className="head">
        <h1>Coduri de reducere pentru cardul cadou</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 780 }}>
        Generezi coduri și le dai clienților (pe Instagram, prin SMS, pe flyere). Cine cumpără un card cadou cu un cod valid plătește mai puțin: pe site la{' '}
        <a href={`${siteBase()}/cadou`} target="_blank" rel="noreferrer">
          /cadou
        </a>
        , în aplicație sau la salon, din <a href="#/giftcards">Carduri cadou → Vinde un card</a>. Cardul rămâne la valoarea întreagă (ex. 120 lei), iar o
        folosire înseamnă un card plătit cu acel cod.
      </p>
      {me.owner ? <Generate onDone={(b) => (list.reload(), setOpen(b))} /> : null}
      {error ? <div className="err">{error}</div> : null}
      {!list.data ? (
        <Loading error={list.error} />
      ) : !batches.length ? (
        <div className="card muted">Încă nu ai niciun cod. Fă primul mai sus.</div>
      ) : (
        batches.map(([batch, items]) => {
          const used = items.reduce((n, p) => n + p.used, 0);
          const activeN = items.filter((p) => p.state === 'ok').length;
          const first = items[0]!;
          const isOpen = open === batch || batches.length === 1;
          const codes = items.map((p) => p.code).join('\n');
          const csv = 'cod,reducere,folosit,limita,expira,stare\n' + items.map((p) => [p.code, off(p), p.used, p.maxUses ?? 'nelimitat', p.expiresDay ?? '', STATE[p.state]].join(',')).join('\n');
          return (
            <div key={batch} className="card" style={{ maxWidth: 900 }}>
              <div className="head" style={{ margin: 0, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b>{batch || 'Fără nume'}</b> · {items.length} {items.length === 1 ? 'cod' : 'coduri'} · {off(first)}
                  {first.expiresDay ? ` · până pe ${day(first.expiresDay)}` : ''}
                  <div className="muted small">
                    {used} {used === 1 ? 'card cumpărat' : 'carduri cumpărate'} cu aceste coduri · {activeN} încă active
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="sm ghost" onClick={() => setOpen(isOpen ? null : batch)}>
                    {isOpen ? 'Ascunde codurile' : 'Vezi codurile'}
                  </button>
                  <button className="sm ghost" onClick={() => navigator.clipboard?.writeText(codes)}>
                    Copiază toate
                  </button>
                  <a className="btn sm ghost" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download={`coduri-${(batch || 'reducere').replace(/\s+/g, '-')}.csv`}>
                    Descarcă (Excel)
                  </a>
                  {me.owner ? (
                    <button className="sm ghost" disabled={busy} onClick={() => toggle({ batch, active: !items.some((p) => p.active) })}>
                      {items.some((p) => p.active) ? 'Oprește seria' : 'Pornește seria'}
                    </button>
                  ) : null}
                </div>
              </div>
              {isOpen ? (
                <table style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Cod</th>
                      <th>Folosit</th>
                      <th>Stare</th>
                      <th>Link direct</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.id} style={{ opacity: p.state === 'ok' ? 1 : 0.55 }}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.code}</td>
                        <td>
                          {p.used}
                          {p.maxUses !== null ? ` / ${p.maxUses}` : ' (nelimitat)'}
                        </td>
                        <td>{STATE[p.state]}</td>
                        <td>
                          <button className="sm ghost" onClick={() => navigator.clipboard?.writeText(`${siteBase()}/cadou?cod=${p.code}`)} title="Cine deschide linkul are codul deja completat">
                            Copiază linkul
                          </button>
                        </td>
                        <td>
                          {me.owner ? (
                            <button className="sm ghost" disabled={busy} onClick={() => toggle({ id: p.id, active: !p.active })}>
                              {p.active ? 'Oprește' : 'Pornește'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              <div className="muted small" style={{ marginTop: 6 }}>
                Creată pe {date(first.createdAt)}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

function Generate({ onDone }: { onDone: (batch: string) => void }) {
  const year = new Date().getFullYear();
  const [mode, setMode] = useState<'many' | 'one'>('many');
  const [batch, setBatch] = useState(`Crăciun ${year}`);
  const [prefix, setPrefix] = useState('CRACIUN');
  const [count, setCount] = useState('20');
  const [code, setCode] = useState('CRACIUN10');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('10');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresDay, setExpires] = useState(`${year}-12-31`);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const sample = 120;
  const v = Number(value) || 0;
  const price = Math.max(5, sample - (kind === 'percent' ? Math.round((sample * v) / 100) : v));
  return (
    <div className="card grid" style={{ maxWidth: 900 }}>
      <h2 style={{ margin: 0 }}>Generează coduri</h2>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={mode === 'many' ? '' : 'ghost'} onClick={() => (setMode('many'), setMaxUses('1'))}>
          Mai multe coduri unice
        </button>
        <button type="button" className={mode === 'one' ? '' : 'ghost'} onClick={() => (setMode('one'), setMaxUses(''))}>
          Un singur cod, pentru toți
        </button>
      </div>
      <div className="grid two">
        <Field label="Numele seriei (îl vezi doar tu)">
          <input value={batch} onChange={(e) => setBatch(e.target.value)} maxLength={60} />
        </Field>
        {mode === 'many' ? (
          <div className="row" style={{ gap: 12 }}>
            <Field label="Începe cu">
              <input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={12} style={{ maxWidth: 140 }} />
            </Field>
            <Field label="Câte coduri">
              <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} style={{ maxWidth: 100 }} />
            </Field>
          </div>
        ) : (
          <Field label="Codul (ex. CRACIUN10)">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} style={{ maxWidth: 220 }} />
          </Field>
        )}
        <Field label="Reducerea">
          <div className="row" style={{ gap: 8 }}>
            <input type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} style={{ maxWidth: 100 }} />
            <select value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'fixed')} style={{ maxWidth: 120 }}>
              <option value="percent">%</option>
              <option value="fixed">lei</option>
            </select>
          </div>
        </Field>
        <Field label="De câte ori se poate folosi fiecare cod (gol = nelimitat)">
          <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="nelimitat" style={{ maxWidth: 120 }} />
        </Field>
        <Field label="Valabil până pe (inclusiv; gol = fără limită)">
          <input type="date" value={expiresDay} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <div className="muted small">
        Exemplu: un card de {lei(sample)} cu acest cod se plătește {lei(price)}.{' '}
        {mode === 'many' ? `Vei avea ${count || 0} coduri de forma ${prefix || 'TAF'}-AB3CD.` : `Codul ${code || '…'} merge pentru oricine îl are${maxUses ? `, de ${maxUses} ori în total` : ''}.`}
      </div>
      {error ? <div className="err">{error}</div> : null}
      <div className="row" style={{ gap: 12 }}>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ created: number }>('POST', '/admin/gift-promos', {
                batch,
                kind,
                value: Number(value),
                maxUses: maxUses ? Number(maxUses) : null,
                expiresDay: expiresDay || null,
                ...(mode === 'many' ? { prefix, count: Number(count) } : { code }),
              });
              setDone(`Am creat ${r.created} ${r.created === 1 ? 'cod' : 'coduri'}.`);
              onDone(batch);
            })
          }
        >
          {busy ? 'Se generează…' : 'Generează'}
        </button>
        {done ? <span className="small success">{done}</span> : null}
      </div>
    </div>
  );
}
