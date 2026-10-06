import { useEffect, useState } from 'react';
import { api, getToken, uploadImageTo, type Client, type ClientPhoto, type Me } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { date, lei, STATUS, time } from '../util';
import { ClientBonuses } from './Referrals';

async function downloadCsv() {
  const res = await fetch('/v1/admin/clients.csv', { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return alert('Exportul nu a mers.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `clienti-tafbarbers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ClientsPage({ me }: { me: Me }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => api<Client[]>('GET', `/admin/clients?q=${encodeURIComponent(query)}`), [query]);

  // Căutare după ce te oprești din scris.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <div className="head">
        <h1>Clienți</h1>
        <div className="row">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută după nume, telefon sau e-mail" style={{ maxWidth: 320 }} />
          <button className="ghost" onClick={downloadCsv}>
            Export Excel (CSV)
          </button>
        </div>
      </div>
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.length === 0 ? (
        <p className="muted">{query ? 'Niciun client găsit.' : 'Încă nu există clienți. Apar aici după prima programare.'}</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Nume</th>
                <th>Telefon</th>
                <th>Vizite</th>
                <th>Ultima</th>
                <th>Oferte</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="click" onClick={() => setOpen(c.id)}>
                  <td>
                    {c.name || <span className="muted">fără nume</span>}
                    {c.email ? <div className="muted small">{c.email}</div> : null}
                  </td>
                  <td>{c.phone}</td>
                  <td>{c.visits ?? 0}</td>
                  <td>{c.lastVisit ? date(c.lastVisit) : '–'}</td>
                  <td className="small muted">
                    {[c.marketing.push && 'push', c.marketing.email && 'e-mail', c.marketing.sms && 'SMS'].filter(Boolean).join(', ') || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <ClientModal id={open} canDelete={me.owner} onClose={() => setOpen(null)} onChange={list.reload} /> : null}
    </>
  );
}

function ClientModal({ id, canDelete, onClose, onChange }: { id: string; canDelete: boolean; onClose: () => void; onChange: () => void }) {
  const c = useLoad(() => api<Client>('GET', `/admin/clients/${id}`), [id]);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (c.data) {
      setName(c.data.name);
      setNotes(c.data.notes);
    }
  }, [c.data]);

  return (
    <Modal title={c.data ? c.data.name || c.data.phone : 'Client'} onClose={onClose}>
      {!c.data ? (
        <Loading error={c.error} />
      ) : (
        <div className="grid">
          <div className="row" style={{ alignItems: 'center', gap: 14 }}>
            {c.data.photoUrl ? <img src={c.data.photoUrl} alt="" style={{ width: 64, height: 64, borderRadius: 32, objectFit: 'cover' }} /> : null}
            <div className="muted">
              <a href={`tel:${c.data.phone}`}>{c.data.phone}</a>
              {c.data.email ? ` · ${c.data.email}` : ''} · limba {c.data.lang.toUpperCase()}
              {c.data.birthDate ? <div>Data nașterii: {c.data.birthDate.split('-').reverse().join('.')}</div> : null}
            </div>
          </div>
          <h2 style={{ margin: '6px 0 0' }}>Bonusuri</h2>
          {c.data.referredBy || c.data.referredCount ? (
            <div className="muted small">
              {c.data.referredBy ? `Recomandat de ${c.data.referredBy.name || 'un client'}. ` : ''}
              {c.data.referredCount ? `A adus ${c.data.referredCount} ${c.data.referredCount === 1 ? 'client nou' : 'clienți noi'}.` : ''}
            </div>
          ) : null}
          <ClientBonuses clientId={id} bonuses={c.data.bonuses ?? []} owner={canDelete} onChange={c.reload} />
          <h2 style={{ margin: '6px 0 0' }}>TAF Identity (de la client)</h2>
          {c.data.identity?.note ? <div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{c.data.identity.note}</div> : null}
          <Photos list={c.data.identity?.photos ?? []} />
          {!c.data.identity?.note && !c.data.identity?.photos.length ? <div className="muted small">Clientul nu a pus încă poze sau o descriere.</div> : null}
          <h2 style={{ margin: '6px 0 0' }}>Poze doar pentru echipă</h2>
          <Photos
            list={c.data.identity?.staffPhotos ?? []}
            onDelete={(pid) => confirm('Ștergi poza?') && run(async () => { await api('DELETE', `/admin/clients/${id}/photos/${pid}`); c.reload(); })}
          />
          <label className="btn ghost sm" style={{ justifySelf: 'start', cursor: 'pointer' }}>
            + Adaugă poză
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) run(async () => { await uploadImageTo(`/v1/admin/clients/${id}/photos`, f, { maxPx: 1200 }); c.reload(); });
              }}
            />
          </label>
          <Field label="Nume">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Notițe (doar pentru echipă)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: preferă fade 0.5, alergic la..." />
          </Field>
          {error ? <div className="err">{error}</div> : null}
          {name !== c.data.name || notes !== c.data.notes ? (
            <div>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api('PATCH', `/admin/clients/${id}`, { name, notes });
                    c.reload();
                    onChange();
                  })
                }
              >
                Salvează
              </button>
            </div>
          ) : null}
          {canDelete ? (
            <div>
              <button
                className="danger sm"
                disabled={busy}
                onClick={() =>
                  confirm('Ștergi datele clientului (GDPR)? Numele, telefonul și e-mailul dispar definitiv, programările viitoare se anulează, istoricul rămâne anonim.') &&
                  run(async () => {
                    await api('DELETE', `/admin/clients/${id}`);
                    onChange();
                    onClose();
                  })
                }
              >
                Șterge datele clientului (GDPR)
              </button>
            </div>
          ) : null}
          <h2 style={{ marginTop: 8 }}>Istoric ({c.data.bookings?.length ?? 0})</h2>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {(c.data.bookings ?? []).map((b) => (
              <div key={b.id} className="row small" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>
                  {date(b.start)}, {time(b.start)} · {b.serviceName} · {b.barberName}
                </span>
                <span>
                  {lei(b.price)} <span className={`pill ${b.status}`}>{STATUS[b.status]}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Poze mici; clic = poza mare într-un tab nou. */
function Photos({ list, onDelete }: { list: ClientPhoto[]; onDelete?: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {list.map((p) => (
        <div key={p.id} style={{ position: 'relative' }}>
          <a href={p.url} target="_blank" rel="noreferrer" title={[p.caption, p.addedBy && `adăugată de ${p.addedBy}`].filter(Boolean).join(' · ')}>
            <img src={p.url} alt={p.caption} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
          </a>
          {onDelete ? (
            <button className="ghost sm" style={{ position: 'absolute', top: 4, right: 4, padding: '2px 8px' }} onClick={() => onDelete(p.id)} aria-label="Șterge poza">
              ✕
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
