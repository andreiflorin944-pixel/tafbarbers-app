import { useState } from 'react';
import { api, type Me } from '../api';
import { Field, useAction } from '../ui';
import { date } from '../util';

// Curățenie conturi: proprietarul alege criteriile, vede lista clienților care le îndeplinesc și șterge (GDPR) pe cei bifați.
// Nu apar niciodată: clienții cu programare viitoare, abonament activ sau card cadou nefolosit.

type Item = { id: string; name: string; phone: string; visits: number; lastVisit: string | null; noShows: number; app: boolean; createdAt: string; blocked: boolean };
type Criteria = { noVisitMonths: string; neverVisited: boolean; minNoShows: string; noApp: boolean; blockedOnly: boolean };
const BATCH = 25;

export function ClientCleanupPage({ me }: { me: Me }) {
  const [crit, setCrit] = useState<Criteria>({ noVisitMonths: '12', neverVisited: false, minNoShows: '', noApp: false, blockedOnly: false });
  const [list, setList] = useState<{ items: Item[]; kept: number; count: number } | null>(null);
  const [sent, setSent] = useState<Record<string, unknown> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!me.owner) return <p className="muted">Doar proprietarul poate face curățenie în conturi.</p>;

  const body = () => ({
    ...(crit.noVisitMonths.trim() && { noVisitMonths: Number(crit.noVisitMonths) }),
    ...(crit.neverVisited && { neverVisited: true }),
    ...(crit.minNoShows.trim() && { minNoShows: Number(crit.minNoShows) }),
    ...(crit.noApp && { noApp: true }),
    ...(crit.blockedOnly && { blockedOnly: true }),
  });
  const set = (p: Partial<Criteria>) => {
    setCrit((c) => ({ ...c, ...p }));
    setList(null);
  };
  const preview = () =>
    run(async () => {
      const b = body();
      const r = await api<{ items: Item[]; kept: number; count: number }>('POST', '/admin/clients/cleanup/preview', b);
      setList(r);
      setSent(b);
      setPicked(new Set(r.items.map((x) => x.id)));
      setConfirmText('');
      setProgress(null);
    });
  const del = () =>
    run(async () => {
      const ids = [...picked];
      let deleted = 0;
      let skipped = 0;
      for (let i = 0; i < ids.length; i += BATCH) {
        setProgress(`Se șterg… ${i} din ${ids.length}`);
        const r = await api<{ deleted: number; skipped: string[] }>('POST', '/admin/clients/cleanup/delete', { criteria: sent, ids: ids.slice(i, i + BATCH), confirm: 'STERGE' });
        deleted += r.deleted;
        skipped += r.skipped.length;
      }
      setProgress(`Gata: ${deleted} ${deleted === 1 ? 'client șters' : 'clienți șterși'}${skipped ? `, ${skipped} săriți (s-au schimbat între timp)` : ''}.`);
      setList(null);
      setPicked(new Set());
      setConfirmText('');
    });

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="grid">
      <div className="card grid">
        <h2>Curățenie conturi</h2>
        <p className="muted small">
          Alege criteriile (se aplică toate odată), vezi lista și bifează pe cine ștergi. Ștergerea e definitivă (GDPR): numele, telefonul și e-mailul dispar, istoricul
          rămâne anonim în rapoarte. Nu apar niciodată clienții cu programare viitoare, abonament activ sau card cadou nefolosit.
        </p>
        <div className="grid two">
          <Field label="Fără vizită de cel puțin (luni)">
            <input type="number" min={1} max={120} value={crit.noVisitMonths} onChange={(e) => set({ noVisitMonths: e.target.value })} placeholder="gol = oricând" />
          </Field>
          <Field label="Cel puțin atâtea neprezentări">
            <input type="number" min={1} max={100} value={crit.minNoShows} onChange={(e) => set({ minNoShows: e.target.value })} placeholder="gol = nu contează" />
          </Field>
        </div>
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={crit.neverVisited} onChange={(e) => set({ neverVisited: e.target.checked })} /> N-a venit niciodată (nici la noi, nici în istoricul din Barberly)
        </label>
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={crit.noApp} onChange={(e) => set({ noApp: e.target.checked })} /> N-a folosit niciodată aplicația sau site-ul (ex. adus din Barberly)
        </label>
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={crit.blockedOnly} onChange={(e) => set({ blockedOnly: e.target.checked })} /> Doar clienții blocați
        </label>
        <div>
          <button disabled={busy} onClick={preview}>
            Arată clienții
          </button>
        </div>
        {error ? <div className="err">{error}</div> : null}
        {progress ? <div className="muted">{progress}</div> : null}
      </div>

      {list ? (
        <div className="card grid">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <b>
              {list.count} {list.count === 1 ? 'client găsit' : 'clienți găsiți'} · {picked.size} bifați
            </b>
            {list.kept ? <span className="muted small">{list.kept} păstrați automat (programare viitoare, abonament sau card cadou)</span> : null}
          </div>
          {list.items.length ? (
            <>
              <div className="row" style={{ gap: 6 }}>
                <button className="ghost sm" onClick={() => setPicked(new Set(list.items.map((x) => x.id)))}>
                  Bifează tot
                </button>
                <button className="ghost sm" onClick={() => setPicked(new Set())}>
                  Debifează tot
                </button>
              </div>
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th>Client</th>
                      <th>Telefon</th>
                      <th>Vizite</th>
                      <th>Ultima vizită</th>
                      <th>Neprezentări</th>
                      <th>Aplicație</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} aria-label={`Bifează ${x.name || x.phone}`} />
                        </td>
                        <td>
                          {x.blocked ? '⛔ ' : ''}
                          {x.name || 'Fără nume'}
                        </td>
                        <td>{x.phone}</td>
                        <td>{x.visits}</td>
                        <td>{x.lastVisit ? date(x.lastVisit) : `niciuna (cont din ${date(x.createdAt)})`}</td>
                        <td>{x.noShows || ''}</td>
                        <td>{x.app ? 'da' : 'nu'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="small">
                  Scrie <b>STERGE</b> ca să confirmi:
                </span>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} style={{ width: 120 }} aria-label="Confirmare" />
                <button className="danger" disabled={busy || !picked.size || confirmText.trim().toUpperCase() !== 'STERGE'} onClick={del}>
                  Șterge {picked.size} {picked.size === 1 ? 'client' : 'clienți'}
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Niciun client nu îndeplinește criteriile.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
