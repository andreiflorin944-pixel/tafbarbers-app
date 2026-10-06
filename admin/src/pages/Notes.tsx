import { useState } from 'react';
import { api, type Barber, type Me } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { date, longDate, today } from '../util';

export type StaffNote = {
  id: string;
  kind: 'task' | 'script' | 'note';
  title: string;
  body: string;
  barberId: string | null;
  barberName: string | null;
  dueDay: string | null;
  doneAt: string | null;
  doneByName: string | null;
  authorName: string | null;
  createdAt: string;
};
const KIND: Record<StaffNote['kind'], string> = { task: 'Sarcină', script: 'Script de filmat', note: 'Notiță' };
const FILTERS = [
  { v: 'open', label: 'De făcut' },
  { v: 'done', label: 'Făcute' },
  { v: '', label: 'Toate' },
];

// Notițe pentru echipă: adminul dă sarcini și scripturi de filmat; frizerul le vede în aplicație și le bifează.
export function NotesPage({ me }: { me: Me }) {
  const manager = me.role !== 'barber';
  const [filter, setFilter] = useState('open');
  const [who, setWho] = useState('');
  const list = useLoad(() => api<StaffNote[]>('GET', `/admin/notes${filter ? `?status=${filter}` : ''}`), [filter]);
  const barbers = useLoad(() => api<Barber[]>('GET', '/admin/barbers'));
  const [edit, setEdit] = useState<Partial<StaffNote> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const toggle = (n: StaffNote) =>
    run(async () => {
      await api('PATCH', `/admin/notes/${n.id}`, { done: !n.doneAt });
      list.reload();
    });
  const remove = (n: StaffNote) =>
    confirm(`Ștergi „${n.title}”?`) &&
    run(async () => {
      await api('DELETE', `/admin/notes/${n.id}`);
      list.reload();
    });

  const rows = (list.data ?? []).filter((n) => !who || (who === 'team' ? !n.barberId : n.barberId === who));
  const late = (n: StaffNote) => !n.doneAt && !!n.dueDay && n.dueDay < today();

  return (
    <>
      <div className="head">
        <h1>Notițe pentru echipă</h1>
        {manager ? <button onClick={() => setEdit({ kind: 'task', barberId: null, title: '', body: '' })}>+ Notiță nouă</button> : null}
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Sarcini și scripturi de filmat pentru frizeri. Fiecare frizer le vede pe ale lui (și pe cele pentru toată echipa) în aplicație, la Meniu → Notițele mele, și le
        bifează când le-a făcut.
      </p>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {FILTERS.map((f) => (
            <button key={f.v} className={f.v === filter ? 'on sm' : 'sm'} onClick={() => setFilter(f.v)}>
              {f.label}
            </button>
          ))}
        </div>
        {manager ? (
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }} aria-label="Pentru cine">
            <option value="">Toată lumea</option>
            <option value="team">Doar cele pentru toată echipa</option>
            {(barbers.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {error ? <div className="err">{error}</div> : null}
      {!list.data ? (
        <Loading error={list.error} />
      ) : rows.length === 0 ? (
        <p className="muted">{filter === 'open' ? 'Nimic de făcut acum.' : 'Nicio notiță aici.'}</p>
      ) : (
        <div className="grid" style={{ gap: 10, marginTop: 12, maxWidth: 860 }}>
          {rows.map((n) => (
            <div key={n.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', opacity: n.doneAt ? 0.6 : 1 }}>
              <input type="checkbox" checked={!!n.doneAt} disabled={busy} onChange={() => toggle(n)} aria-label="Făcut" style={{ width: 20, height: 20, marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ textDecoration: n.doneAt ? 'line-through' : undefined, cursor: n.body ? 'pointer' : undefined }} onClick={() => setOpen(open === n.id ? null : n.id)}>
                      {n.title}
                    </strong>{' '}
                    <span className={`pill ${n.kind === 'script' ? 'confirmed' : ''}`}>{KIND[n.kind]}</span>
                  </div>
                  {manager ? (
                    <div className="row">
                      <button className="ghost sm" onClick={() => setEdit(n)}>
                        Editează
                      </button>
                      <button className="danger sm" disabled={busy} onClick={() => remove(n)}>
                        Șterge
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="muted small">
                  {n.barberName ?? 'Toată echipa'}
                  {n.dueDay ? (
                    <span style={{ color: late(n) ? 'var(--danger)' : undefined }}>
                      {' · '}până pe {longDate(n.dueDay + 'T12:00:00Z')}
                      {late(n) ? ' (întârziată)' : ''}
                    </span>
                  ) : null}
                  {n.doneAt ? ` · făcută pe ${date(n.doneAt)}${n.doneByName ? ` de ${n.doneByName}` : ''}` : ''}
                </div>
                {n.body && (open === n.id || n.kind === 'script' || n.body.length < 160) ? (
                  <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                    {n.body}
                  </div>
                ) : n.body ? (
                  <button className="ghost sm" style={{ marginTop: 6 }} onClick={() => setOpen(n.id)}>
                    Citește tot
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit ? (
        <NoteModal
          note={edit}
          barbers={(barbers.data ?? []).filter((b) => b.active)}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function NoteModal({ note, barbers, onClose, onSaved }: { note: Partial<StaffNote>; barbers: Barber[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ kind: note.kind ?? 'task', title: note.title ?? '', body: note.body ?? '', barberId: note.barberId ?? '', dueDay: note.dueDay ?? '' });
  const { busy, error, run } = useAction();
  const save = () =>
    run(async () => {
      const body = { ...v, barberId: v.barberId || null, dueDay: v.dueDay || null };
      if (note.id) await api('PATCH', `/admin/notes/${note.id}`, body);
      else await api('POST', '/admin/notes', body);
      onSaved();
    });
  return (
    <Modal title={note.id ? 'Editează notița' : 'Notiță nouă'} onClose={onClose}>
      <div className="grid">
        <div className="grid two">
          <Field label="Ce fel">
            <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as StaffNote['kind'] })}>
              <option value="task">Sarcină</option>
              <option value="script">Script de filmat</option>
              <option value="note">Notiță</option>
            </select>
          </Field>
          <Field label="Pentru cine">
            <select value={v.barberId} onChange={(e) => setV({ ...v, barberId: e.target.value })}>
              <option value="">Toată echipa</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Titlu">
          <input value={v.title} maxLength={140} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={v.kind === 'script' ? 'Ex. Reel: fade în 30 de secunde' : 'Ex. Comandă lame până vineri'} />
        </Field>
        <Field label={v.kind === 'script' ? 'Scriptul (cadre, text, muzică)' : 'Detalii'}>
          <textarea
            value={v.body}
            rows={v.kind === 'script' ? 12 : 5}
            onChange={(e) => setV({ ...v, body: e.target.value })}
            placeholder={v.kind === 'script' ? 'Cadrul 1: clientul intră, prim-plan pe ușă (3 sec)\nCadrul 2: ...\nText pe ecran: ...\nMuzică: ...' : ''}
          />
        </Field>
        <Field label="Până când (opțional)">
          <input type="date" value={v.dueDay} onChange={(e) => setV({ ...v, dueDay: e.target.value })} />
        </Field>
        {error ? <div className="err">{error}</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>
            Renunță
          </button>
          <button disabled={busy || !v.title.trim()} onClick={save}>
            Salvează
          </button>
        </div>
      </div>
    </Modal>
  );
}
