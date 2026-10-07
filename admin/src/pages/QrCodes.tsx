import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { date, lei } from '../util';

export type QrCampaign = {
  id: string;
  code: string;
  name: string;
  target: 'book' | 'home';
  url: string;
  createdAt: string;
  archived: boolean;
  scans: number;
  people: number;
  signups: number;
  logins: number;
  bookings: number;
  revenue: number;
};
type QrDetail = QrCampaign & {
  days: { day: string; n: number }[];
  devices: Partial<Record<'ios' | 'android' | 'other', number>>;
  clients: { id: string; name: string; phone: string; kind: 'signup' | 'login'; match: 'exact' | 'probable'; at: string; bookings: number }[];
};

const people = (n: number) => (n === 1 ? '1 persoană' : `${n} persoane`);
const TARGET: Record<QrCampaign['target'], string> = { book: 'Deschide programarea', home: 'Deschide prima pagină' };

// Coduri QR pentru campanii (flyere, afișe, cărți de vizită): câți scanează și cine își face cont sau intră în cont prin fiecare.
export function QrCodesPage() {
  const list = useLoad(() => api<QrCampaign[]>('GET', '/admin/qr'));
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <div className="head">
        <h1>Coduri QR</h1>
        <button onClick={() => setCreating(true)}>+ Cod QR nou</button>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Fă câte un cod pentru fiecare campanie (flyer, afiș, cartea de vizită, vitrina). Când cineva îl scanează, se deschide aplicația, iar aici vezi câte scanări au
        fost, cine și-a făcut cont sau a intrat în cont prin el și câte programări au venit de la acești clienți.
      </p>
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.length === 0 ? (
        <p className="muted">Niciun cod încă. Apasă „+ Cod QR nou”.</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Campanie</th>
                <th>Scanări</th>
                <th>Conturi noi</th>
                <th>Au intrat în cont</th>
                <th>Programări</th>
                <th>Încasat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((q) => (
                <tr key={q.id} style={{ opacity: q.archived ? 0.55 : 1, cursor: 'pointer' }} onClick={() => setOpen(q.id)}>
                  <td>
                    <strong>{q.name}</strong> {q.archived ? <span className="pill">oprit</span> : null}
                    <div className="muted small">
                      {TARGET[q.target]} · din {date(q.createdAt)}
                    </div>
                  </td>
                  <td>
                    {q.scans}
                    <div className="muted small">{people(q.people)}</div>
                  </td>
                  <td>{q.signups}</td>
                  <td>{q.logins}</td>
                  <td>{q.bookings}</td>
                  <td>{lei(q.revenue)}</td>
                  <td>
                    <button className="ghost sm">Vezi</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? (
        <NewModal
          onClose={() => setCreating(false)}
          onCreated={(q) => {
            setCreating(false);
            list.reload();
            setOpen(q.id);
          }}
        />
      ) : null}
      {open ? (
        <DetailModal
          id={open}
          onClose={() => {
            setOpen(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function NewModal({ onClose, onCreated }: { onClose: () => void; onCreated: (q: QrCampaign) => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState<QrCampaign['target']>('book');
  const { busy, error, run } = useAction();
  const save = () => run(async () => onCreated(await api<QrCampaign>('POST', '/admin/qr', { name, target })));
  return (
    <Modal title="Cod QR nou" onClose={onClose}>
      <div className="grid">
        <Field label="Numele campaniei (îl vezi doar tu)">
          <input value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Ex. Flyere Rediu octombrie" />
        </Field>
        <Field label="Ce se deschide după scanare">
          <select value={target} onChange={(e) => setTarget(e.target.value as QrCampaign['target'])}>
            <option value="book">Programarea (alege serviciul și ora)</option>
            <option value="home">Prima pagină a aplicației</option>
          </select>
        </Field>
        {error ? <div className="err">{error}</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>
            Renunță
          </button>
          <button disabled={busy || !name.trim()} onClick={save}>
            Fă codul
          </button>
        </div>
      </div>
    </Modal>
  );
}

const fileName = (q: QrCampaign) => `qr-${q.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || q.code}`;

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useLoad(() => api<QrDetail>('GET', `/admin/qr/${id}`), [id]);
  const [png, setPng] = useState('');
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const q = d.data;

  useEffect(() => {
    if (!q) return;
    // Mare și cu margine albă, ca să iasă clar și la tipar.
    QRCode.toDataURL(q.url, { width: 1200, margin: 3, errorCorrectionLevel: 'M' }).then(setPng, () => setPng(''));
  }, [q?.url]);

  const svg = async () => {
    if (!q) return;
    const s = await QRCode.toString(q.url, { type: 'svg', margin: 3, errorCorrectionLevel: 'M' });
    const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
    download(url, `${fileName(q)}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const patch = (body: object) =>
    run(async () => {
      await api('PATCH', `/admin/qr/${id}`, body);
      setName(null);
      d.reload();
    });
  const copy = async () => {
    if (!q) return;
    await navigator.clipboard?.writeText(q.url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const maxDay = Math.max(1, ...(q?.days ?? []).map((x) => x.n));
  const dev = q?.devices ?? {};
  return (
    <Modal title={q?.name ?? 'Cod QR'} onClose={onClose}>
      {!q ? (
        <Loading error={d.error} />
      ) : (
        <div className="grid">
          <div className="row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 6, width: 190, height: 190, flex: 'none' }}>
              {png ? <img src={png} alt={`Cod QR ${q.name}`} style={{ width: '100%', height: '100%', display: 'block' }} /> : null}
            </div>
            <div className="grid" style={{ flex: 1, minWidth: 220, gap: 8 }}>
              {name !== null ? (
                <div className="row">
                  <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                  <button className="sm" disabled={busy || !name.trim()} onClick={() => patch({ name })}>
                    Salvează
                  </button>
                </div>
              ) : (
                <div>
                  <strong>{q.name}</strong>{' '}
                  <button className="ghost sm" onClick={() => setName(q.name)}>
                    Redenumește
                  </button>
                </div>
              )}
              <div className="muted small">{TARGET[q.target]}</div>
              <div className="small" style={{ wordBreak: 'break-all' }}>
                {q.url}{' '}
                <button className="ghost sm" onClick={copy}>
                  {copied ? 'Copiat' : 'Copiază linkul'}
                </button>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="sm" disabled={!png} onClick={() => download(png, `${fileName(q)}.png`)}>
                  Descarcă PNG
                </button>
                <button className="ghost sm" onClick={svg}>
                  Descarcă SVG (pentru tipografie)
                </button>
              </div>
              {q.archived ? <div className="err">Codul e oprit: cine îl scanează ajunge tot în aplicație, dar nu se mai numără.</div> : null}
            </div>
          </div>

          <div className="grid stats" style={{ marginBottom: 0 }}>
            <Stat v={q.scans} l={`scanări (${people(q.people)})`} />
            <Stat v={q.signups} l="conturi noi" />
            <Stat v={q.logins} l="au intrat în cont" />
            <Stat v={q.bookings} l={`programări · ${lei(q.revenue)}`} />
          </div>

          {q.scans ? (
            <div>
              <h3 style={{ margin: '4px 0 8px' }}>Scanări pe zile</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90 }}>
                {q.days.map((x) => (
                  <div key={x.day} title={`${date(x.day + 'T12:00:00Z')}: ${x.n}`} style={{ flex: 1, maxWidth: 28, background: 'var(--gold)', borderRadius: '4px 4px 0 0', height: `${Math.max(6, (x.n / maxDay) * 100)}%` }} />
                ))}
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                iPhone {dev.ios ?? 0} · Android {dev.android ?? 0} · altele {dev.other ?? 0}
              </div>
            </div>
          ) : (
            <p className="muted small">Încă nu l-a scanat nimeni.</p>
          )}

          <div>
            <h3 style={{ margin: '4px 0 8px' }}>Clienți veniți prin acest cod</h3>
            {q.clients.length === 0 ? (
              <p className="muted small">Niciunul încă.</p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Ce a făcut</th>
                      <th>Programări</th>
                      <th>Când</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.clients.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.name || 'Fără nume'}
                          <div className="muted small">{c.phone}</div>
                        </td>
                        <td>
                          {c.kind === 'signup' ? 'Cont nou' : 'A intrat în cont'}{' '}
                          {c.match === 'probable' ? (
                            <span className="pill" title="Aplicația nu a primit codul, dar s-a înregistrat din aceeași rețea la cel mult o zi după o scanare.">
                              probabil
                            </span>
                          ) : null}
                        </td>
                        <td>{c.bookings}</td>
                        <td>{date(c.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small" style={{ marginTop: 6 }}>
              „Probabil” înseamnă că omul nu avea aplicația când a scanat: a instalat-o și și-a făcut cont din aceeași rețea în cel mult o zi.
            </p>
          </div>

          {error ? <div className="err">{error}</div> : null}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className={q.archived ? 'ghost' : 'danger'} disabled={busy} onClick={() => patch({ archived: !q.archived })}>
              {q.archived ? 'Pornește din nou' : 'Oprește codul'}
            </button>
            <button className="ghost" onClick={onClose}>
              Închide
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ v, l }: { v: number; l: string }) {
  return (
    <div className="card stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}
