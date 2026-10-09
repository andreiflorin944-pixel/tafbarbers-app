import { useEffect, useState } from 'react';
import { api, getToken, uploadImageTo, type Client, type ClientPhoto, type Me } from '../api';
import { Field, Loading, Modal, useAction, useLoad, useSub } from '../ui';
import { excelDate, readTable } from '../sheet';
import { date, lei, STATUS, time } from '../util';
import { ClientBonuses } from './Referrals';
import { ClientSubscriptions } from './Subscriptions';

async function download(ext: 'csv' | 'xlsx') {
  const res = await fetch(`/v1/admin/clients.${ext}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return alert('Exportul nu a mers.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `clienti-tafbarbers-${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ClientsPage({ me }: { me: Me }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useLoad(() => api<Client[]>('GET', `/admin/clients?q=${encodeURIComponent(query)}`), [query]);
  // #/clients/<id> deschide direct fișa (de ex. din calendar).
  const sub = useSub();
  useEffect(() => {
    if (sub) setOpen(sub);
  }, [sub]);

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
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={me.permissions.contacts ? 'Caută după nume, telefon sau e-mail' : 'Caută după nume sau numărul complet'}
            style={{ maxWidth: 320 }}
          />
          {me.permissions.contacts ? (
            <>
              <button className="ghost" onClick={() => setImporting(true)}>
                Importă
              </button>
              <button className="ghost" onClick={() => download('xlsx')}>
                Exportă Excel
              </button>
              <button className="ghost" onClick={() => download('csv')}>
                Exportă CSV
              </button>
            </>
          ) : null}
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
      {open ? (
        <ClientModal
          id={open}
          canDelete={me.owner}
          onClose={() => {
            setOpen(null);
            if (sub) location.hash = '#/clients';
          }}
          onChange={list.reload}
        />
      ) : null}
      {importing ? <ImportModal onClose={() => setImporting(false)} onDone={list.reload} /> : null}
    </>
  );
}

const FIELDS = [
  { key: 'name', label: 'Nume', match: /^(nume|name|client|nume (complet|client)|full ?name|prenume)/i },
  { key: 'phone', label: 'Telefon', match: /(telefon|phone|mobil|tel\b|nr\.? ?tel)/i },
  { key: 'email', label: 'E-mail', match: /(e-?mail|mail)/i },
  { key: 'birthDate', label: 'Data nașterii', match: /(na[șs]ter|birth|zi(ua)? de)/i },
  { key: 'notes', label: 'Notițe', match: /(noti[țt]|note|observa|comentari)/i },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];
type ImportResult = { created: number; updated: number; unchanged: number; skipped: Array<{ row: number; reason: string }>; skippedCount: number };

/** Import de clienți din Excel sau CSV: alegi fișierul, verifici coloanele, apoi îi adaugi. Telefonul nu se dublează. */
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<Record<FieldKey, number>>({ name: -1, phone: -1, email: -1, birthDate: -1, notes: -1 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const { busy, error, run, setError } = useAction();

  const pick = async (f: File) => {
    setError(null);
    setResult(null);
    try {
      const t = await readTable(f);
      if (!t.length) throw new Error('Fișierul e gol.');
      setRows(t);
      setFileName(f.name);
      // Ghicim coloanele după antet; dacă primul rând arată ca un telefon, nu e antet.
      const first = t[0];
      const looksHeader = !first.some((c) => /^\+?\d[\d\s.-]{7,}$/.test(c.trim()));
      setHeader(looksHeader);
      const m = { name: -1, phone: -1, email: -1, birthDate: -1, notes: -1 } as Record<FieldKey, number>;
      if (looksHeader) for (const fd of FIELDS) m[fd.key] = first.findIndex((c, i) => fd.match.test(c.trim()) && !Object.values(m).includes(i));
      else {
        m.phone = first.findIndex((c) => /^\+?\d[\d\s.-]{7,}$/.test(c.trim()));
        m.name = first.findIndex((c, i) => i !== m.phone && /[a-zăâîșț]/i.test(c) && !c.includes('@'));
        m.email = first.findIndex((c) => c.includes('@'));
      }
      setMap(m);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : 'Fișierul nu a putut fi citit.');
    }
  };

  const data = rows ? (header ? rows.slice(1) : rows) : [];
  const cols = rows ? Math.max(...rows.slice(0, 50).map((r) => r.length)) : 0;
  const colName = (i: number) => (header && rows?.[0][i]?.trim()) || `Coloana ${String.fromCharCode(65 + (i % 26))}`;
  const cell = (r: string[], k: FieldKey) => (map[k] >= 0 ? (r[map[k]] ?? '').trim() : '');
  const out = data.map((r) => ({
    name: cell(r, 'name'),
    phone: cell(r, 'phone'),
    email: cell(r, 'email'),
    birthDate: excelDate(cell(r, 'birthDate')),
    notes: cell(r, 'notes'),
  }));

  const submit = () =>
    run(async () => {
      setResult(await api<ImportResult>('POST', '/admin/clients/import', { rows: out }));
      onDone();
    });

  return (
    <Modal title="Importă clienți" onClose={onClose}>
      <div className="grid">
        <p className="muted small" style={{ margin: 0 }}>
          Alege un fișier Excel (.xlsx) sau CSV cu clienții, de exemplu exportul din Barberly. Ai nevoie cel puțin de telefon. Un număr care există deja nu se dublează: se
          completează doar ce lipsea. Clienții importați nu primesc oferte până nu își dau singuri acordul (GDPR).
        </p>
        <label className="btn ghost" style={{ justifySelf: 'start' }}>
          {fileName ? `Fișier: ${fileName} (alege altul)` : 'Alege fișierul'}
          <input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {rows && !result ? (
          <>
            <label className="check small">
              <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Primul rând e antetul (numele coloanelor)
            </label>
            <div className="grid two">
              {FIELDS.map((fd) => (
                <Field key={fd.key} label={fd.label + (fd.key === 'phone' ? ' (obligatoriu)' : '')}>
                  <select value={map[fd.key]} onChange={(e) => setMap({ ...map, [fd.key]: Number(e.target.value) })}>
                    <option value={-1}>nu importa</option>
                    {Array.from({ length: cols }, (_, i) => (
                      <option key={i} value={i}>
                        {colName(i)}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <div className="table-wrap card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Nume</th>
                    <th>Telefon</th>
                    <th>E-mail</th>
                    <th>Naștere</th>
                  </tr>
                </thead>
                <tbody>
                  {out.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name || <span className="muted">–</span>}</td>
                      <td>{r.phone || <span className="err">lipsă</span>}</td>
                      <td>{r.email || <span className="muted">–</span>}</td>
                      <td>{r.birthDate || <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted small">
              {data.length} rânduri în fișier{data.length > 5 ? ', mai sus vezi primele 5' : ''}.
            </div>
          </>
        ) : null}
        {result ? (
          <div className="card grid" style={{ gap: 4 }}>
            <b>Gata.</b>
            <div>{result.created} clienți noi adăugați.</div>
            {result.updated ? <div>{result.updated} clienți existenți completați (nume, e-mail sau zi de naștere care lipseau).</div> : null}
            {result.unchanged ? <div className="muted">{result.unchanged} existau deja, neschimbați.</div> : null}
            {result.skippedCount ? (
              <details>
                <summary className="err">{result.skippedCount} rânduri sărite</summary>
                {result.skipped.map((x) => (
                  <div key={x.row} className="small muted">
                    Rândul {x.row + (header ? 1 : 0)}: {x.reason}
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        ) : null}
        {error ? <div className="err">{error}</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>
            {result ? 'Închide' : 'Renunță'}
          </button>
          {rows && !result ? (
            <button disabled={busy || map.phone < 0 || !data.length} onClick={submit}>
              {busy ? 'Se importă…' : `Importă ${data.length} clienți`}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
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
    <Modal title={c.data ? c.data.name || c.data.phone || 'Client' : 'Client'} onClose={onClose}>
      {!c.data ? (
        <Loading error={c.error} />
      ) : (
        <div className="grid">
          <div className="row" style={{ alignItems: 'center', gap: 14 }}>
            {c.data.photoUrl ? <img src={c.data.photoUrl} alt="" style={{ width: 64, height: 64, borderRadius: 32, objectFit: 'cover' }} /> : null}
            <div className="muted">
              {c.data.phone ? <a href={`tel:${c.data.phone}`}>{c.data.phone}</a> : 'Telefon și e-mail ascunse'}
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
          <h2 style={{ margin: '6px 0 0' }}>Abonament</h2>
          <div className="row small" style={{ gap: 10, flexWrap: 'wrap' }}>
            {c.data.clubMember ? (
              <span className="pill" style={{ background: 'var(--gold)', color: '#000' }}>
                Membru TAF Club
              </span>
            ) : (
              <span className="muted">Nu e membru TAF Club</span>
            )}
            {canDelete ? (
              <label className="check small" title="Membrii văd în aplicație și orele „Doar membri TAF Club”.">
                <input
                  type="checkbox"
                  checked={!!c.data.clubManual}
                  disabled={busy}
                  onChange={(e) => {
                    const on = e.target.checked;
                    run(async () => {
                      await api('PATCH', `/admin/clients/${id}`, { clubMember: on });
                      c.reload();
                    });
                  }}
                />{' '}
                Membru TAF Club și fără abonament (pus de mână)
              </label>
            ) : null}
          </div>
          <ClientSubscriptions clientId={id} subs={c.data.subscriptions ?? []} owner={canDelete} onChange={c.reload} />
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
          <h2 style={{ margin: '6px 0 0' }}>Înainte și după</h2>
          <BeforeAfter clientId={id} list={c.data.beforeAfter ?? []} onChange={c.reload} />
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
                  {b.payment === 'subscription' ? 'pe abonament' : lei(b.payment === 'paid' ? (b.paidAmount ?? b.price) : b.price)}{' '}
                  <span className={`pill ${b.status}`}>{STATUS[b.status]}</span>
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

/** Perechi de poze înainte/după; clientul le vede în aplicație și le poate distribui pe Instagram. */
function BeforeAfter({ clientId, list, onChange }: { clientId: string; list: NonNullable<Client['beforeAfter']>; onChange: () => void }) {
  const [before, setBefore] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  const up = (f: File) => uploadImageTo(`/v1/admin/clients/${clientId}/before-after/upload`, f, { maxPx: 1400 }) as Promise<{ mediaId: string }>;
  return (
    <div className="grid" style={{ gap: 8 }}>
      {list.map((p) => (
        <div key={p.id} className="row" style={{ gap: 6, alignItems: 'center' }}>
          <img src={p.before} alt="înainte" style={{ width: 90, height: 110, objectFit: 'cover', borderRadius: 8 }} />
          <img src={p.after} alt="după" style={{ width: 90, height: 110, objectFit: 'cover', borderRadius: 8 }} />
          <span className="muted small">
            {date(p.createdAt)}
            {p.barberName ? ` · ${p.barberName}` : ''}
          </span>
          <button className="ghost sm" disabled={busy} onClick={() => confirm('Ștergi perechea de poze?') && run(async () => { await api('DELETE', `/admin/before-after/${p.id}`); onChange(); })}>
            Șterge
          </button>
        </div>
      ))}
      {!list.length ? <div className="muted small">Încă nu sunt poze înainte/după.</div> : null}
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
          {before ? `Înainte: ${before.name.slice(0, 18)}` : '1. Poza înainte'}
          <input type="file" accept="image/*" hidden onChange={(e) => { setBefore(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </label>
        <label className="btn ghost sm" style={{ cursor: before ? 'pointer' : 'not-allowed', opacity: before ? 1 : 0.5 }}>
          2. Poza după
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={!before || busy}
            onChange={(e) => {
              const after = e.target.files?.[0];
              e.target.value = '';
              if (after && before)
                run(async () => {
                  const [b, a] = [await up(before), await up(after)];
                  await api('POST', `/admin/clients/${clientId}/before-after`, { before: b.mediaId, after: a.mediaId });
                  setBefore(null);
                  onChange();
                });
            }}
          />
        </label>
      </div>
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}
