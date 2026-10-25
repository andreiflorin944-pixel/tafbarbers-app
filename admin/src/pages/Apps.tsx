import { useState } from 'react';
import { api } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';

type Tone = 'ok' | 'wait' | 'bad' | 'muted';
type StoreStatus =
  | { ok: true; name: string; description: string; versions: Array<{ version: string; label: string; tone: Tone }>; live: string | null; note?: string }
  | { ok: false; error: string };
type Release = {
  id: string;
  platform: 'ios' | 'android' | 'all';
  kind: 'store' | 'ota';
  version: string;
  status: 'building' | 'apple' | 'done' | 'failed';
  step: string;
  error: string | null;
  runUrl: string | null;
  createdAt: string;
};
type Connections = { expo: { savedAt: string } | null; apple: { keyId: string; savedAt: string } | null; google: { email: string; savedAt: string } | null };
type AppsData = { connections: Connections; ios: StoreStatus | null; android: StoreStatus | null; releases: Release[]; links: { appStore: string; play: string } };

const PILL: Record<Tone, string> = { ok: 'completed', wait: 'confirmed', bad: 'cancelled', muted: 'off' };
const PLATFORM = { ios: 'iPhone', android: 'Android', all: 'iPhone și Android' };
const RELEASE_PILL = { building: ['În lucru', 'confirmed'], apple: ['La Apple', 'confirmed'], done: ['Trimisă', 'completed'], failed: ['Nu a mers', 'cancelled'] } as const;

const APPLE_PATH = 'M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1zM13.9 4.9c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z';
const ANDROID_PATH = 'M6 9h12v8a1 1 0 0 1-1 1h-1v3a1 1 0 0 1-2 0v-3h-4v3a1 1 0 0 1-2 0v-3H7a1 1 0 0 1-1-1zM3.5 9a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-5a1 1 0 0 1 1-1zm17 0a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-5a1 1 0 0 1 1-1zM6 8a6 6 0 0 1 12 0zm3.5-2.2a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4zm5 0a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4zM7.6 1.8l1.6 2.4M16.4 1.8l-1.6 2.4';

/** Versiunea următoare: ultima cifră + 1, pornind de la cea mai mare versiune cunoscută. */
function nextVersion(d: AppsData) {
  const known = [d.ios?.ok ? d.ios.versions.map((v) => v.version) : [], d.android?.ok ? d.android.versions.map((v) => v.version) : [], d.releases.filter((r) => r.kind === 'store').map((r) => r.version)]
    .flat()
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  const cmp = (a: string, b: string) => {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  const top = known.sort((a, b) => cmp(b, a))[0] ?? '1.0.0';
  const [a, b, c] = top.split('.').map(Number);
  return `${a}.${b}.${c + 1}`;
}

const when = (s: string) => new Date(s).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function AppsPage() {
  const data = useLoad(() => api<AppsData>('GET', '/admin/apps'));
  const [updating, setUpdating] = useState<'ios' | 'android' | null>(null);
  const [ota, setOta] = useState(false);
  if (!data.data) return <Loading error={data.error} />;
  const d = data.data;
  const ready = !!d.connections.expo;
  const running = d.releases.some((r) => r.status === 'building' || r.status === 'apple');

  return (
    <>
      <div className="head">
        <h1>Aplicații</h1>
        <button className="ghost sm" onClick={data.reload}>
          Reîncarcă starea
        </button>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 820 }}>
        Starea aplicației în App Store și Google Play și trimiterea unei versiuni noi direct de aici. Serviciile, prețurile, frizerii, bannerele și culorile
        se schimbă imediat din panou, fără nicio actualizare. „Actualizați aplicația” e doar pentru funcții noi în aplicație.
      </p>

      <StoreCard
        title="Aplicație iOS"
        path={APPLE_PATH}
        status={d.ios}
        connected={!!d.connections.apple}
        link={{ href: d.links.appStore, label: 'Afișați în App Store' }}
        onUpdate={() => setUpdating('ios')}
        canUpdate={ready && !running}
        who="Apple"
      />
      <StoreCard
        title="Aplicație Android"
        path={ANDROID_PATH}
        status={d.android}
        connected={!!d.connections.google}
        link={{ href: d.links.play, label: 'Arată în Google Play' }}
        onUpdate={() => setUpdating('android')}
        canUpdate={ready && !running}
        who="Google"
      />

      {!ready ? <p className="muted small">Butonul „Actualizați aplicația” pornește după ce conectezi Expo, mai jos la Conexiuni.</p> : null}
      {ready && running ? <p className="muted small">O actualizare e în curs. Poți porni alta după ce se termină.</p> : null}

      {d.releases.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Actualizări pornite din panou</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Când</th>
                  <th>Ce</th>
                  <th>Stare</th>
                  <th>Detalii</th>
                </tr>
              </thead>
              <tbody>
                {d.releases.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                    <td>{r.kind === 'ota' ? 'Actualizare rapidă' : `Versiunea ${r.version}, ${PLATFORM[r.platform]}`}</td>
                    <td>
                      <span className={`pill ${RELEASE_PILL[r.status][1]}`}>{RELEASE_PILL[r.status][0]}</span>
                    </td>
                    <td>
                      {r.step}
                      {r.error ? <div className="err small">{r.error}</div> : null}
                      {r.runUrl ? (
                        <div className="small">
                          <a href={r.runUrl} target="_blank" rel="noreferrer">
                            Vezi în Expo
                          </a>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16, maxWidth: 820 }}>
        <h2 style={{ marginTop: 0 }}>Actualizare rapidă (fără magazine)</h2>
        <p className="muted small">
          Trimite o corectură mică direct pe telefoanele clienților, fără verificarea Apple și Google. O primesc la următoarea deschidere a aplicației.
          Merge pentru versiunile care au deja actualizarea rapidă în ele (de la a doua versiune din magazine); când o funcție nouă cere o versiune
          nouă din magazine, actualizarea rapidă nu ajunge la telefoanele vechi și trebuie folosit „Actualizați aplicația”.
        </p>
        <button className="ghost" disabled={!ready || running} onClick={() => setOta(true)}>
          Trimite actualizarea rapidă
        </button>
      </div>

      <ConnectionsCard c={d.connections} onSaved={data.reload} />

      {updating ? <UpdateModal d={d} platform={updating} onClose={() => setUpdating(null)} onDone={() => (setUpdating(null), data.reload())} /> : null}
      {ota ? <OtaModal onClose={() => setOta(false)} onDone={() => (setOta(false), data.reload())} /> : null}
    </>
  );
}

function StoreCard(p: {
  title: string;
  path: string;
  status: StoreStatus | null;
  connected: boolean;
  link: { href: string; label: string };
  onUpdate: () => void;
  canUpdate: boolean;
  who: string;
}) {
  const s = p.status;
  return (
    <div className="card" style={{ marginBottom: 16, padding: 0 }}>
      <div className="row" style={{ alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
        <svg width={30} height={30} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d={p.path} />
        </svg>
        <h2 style={{ margin: 0 }}>{p.title}</h2>
        <button onClick={p.onUpdate} disabled={!p.canUpdate}>
          Actualizați aplicația
        </button>
        <a href={p.link.href} target="_blank" rel="noreferrer">
          {p.link.label}
        </a>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 64 }} />
              <th>Nume</th>
              <th>Versiunea</th>
              <th>Descriere</th>
              <th>Stare</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <img src="/app-icon.png" alt="" width={48} height={48} style={{ borderRadius: 11, display: 'block' }} />
              </td>
              {!p.connected ? (
                <td colSpan={4} className="muted">
                  Conectează {p.who} (mai jos, la Conexiuni) ca să vezi aici versiunea și starea din magazin.
                </td>
              ) : !s ? (
                <td colSpan={4} className="muted">
                  Se încarcă…
                </td>
              ) : !s.ok ? (
                <td colSpan={4} className="err">
                  {s.error}
                </td>
              ) : (
                <>
                  <td>{s.name}</td>
                  <td>{s.versions[0]?.version ?? '–'}</td>
                  <td className="muted" style={{ maxWidth: 520 }} title={s.description}>
                    {s.description.length > 110 ? `${s.description.slice(0, 110)}…` : s.description || '–'}
                  </td>
                  <td>
                    {s.versions.length ? (
                      s.versions.map((v, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          <span className={`pill ${PILL[v.tone]}`}>{v.label}</span>
                          {i > 0 || s.versions.length > 1 ? <span className="muted small"> {v.version}</span> : null}
                        </div>
                      ))
                    ) : (
                      <span className="pill off">Nicio versiune încă</span>
                    )}
                    {s.note ? <div className="muted small" style={{ maxWidth: 260 }}>{s.note}</div> : null}
                  </td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UpdateModal({ d, platform, onClose, onDone }: { d: AppsData; platform: 'ios' | 'android'; onClose: () => void; onDone: () => void }) {
  const [where, setWhere] = useState<'all' | 'ios' | 'android'>(d.connections.google || d.connections.apple ? 'all' : platform);
  const [version, setVersion] = useState(nextVersion(d));
  const [whatsNew, setWhatsNew] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title="Actualizați aplicația" onClose={onClose}>
      <div className="grid">
        <p className="muted small" style={{ margin: 0 }}>
          Se construiește aplicația din ultima versiune a codului și se trimite la verificare. Durează de obicei 20–40 de minute până ajunge la Apple și
          Google, apoi verificarea lor ține 1–2 zile. Urmărești totul pe această pagină.
        </p>
        <Field label="Unde">
          <select value={where} onChange={(e) => setWhere(e.target.value as typeof where)}>
            <option value="all">iPhone și Android</option>
            <option value="ios">Doar iPhone (App Store)</option>
            <option value="android">Doar Android (Google Play)</option>
          </select>
        </Field>
        <Field label="Versiunea nouă (mai mare decât cea din magazin)">
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.1" style={{ maxWidth: 140 }} />
        </Field>
        {where !== 'android' ? (
          <Field label="Ce e nou (apare în App Store; gol = „Îmbunătățiri și corecturi”)">
            <textarea rows={3} value={whatsNew} onChange={(e) => setWhatsNew(e.target.value)} placeholder="De exemplu: Programare mai rapidă și plata cu cardul." />
          </Field>
        ) : null}
        {error ? <p className="err">{error}</p> : null}
        <div className="row" style={{ gap: 8 }}>
          <button disabled={busy} onClick={async () => (await run(() => api('POST', '/admin/apps/release', { platform: where, version: version.trim(), whatsNew }))) && onDone()}>
            {busy ? 'Se pornește…' : 'Trimite versiunea nouă'}
          </button>
          <button className="ghost" onClick={onClose}>
            Renunță
          </button>
        </div>
      </div>
    </Modal>
  );
}

function OtaModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [message, setMessage] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title="Actualizare rapidă" onClose={onClose}>
      <div className="grid">
        <Field label="Ce se schimbă (doar pentru tine, ca să știi mai târziu)">
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Corectură la pagina de programare" />
        </Field>
        {error ? <p className="err">{error}</p> : null}
        <div className="row" style={{ gap: 8 }}>
          <button disabled={busy} onClick={async () => (await run(() => api('POST', '/admin/apps/release', { kind: 'ota', whatsNew: message }))) && onDone()}>
            {busy ? 'Se pornește…' : 'Trimite pe telefoane'}
          </button>
          <button className="ghost" onClick={onClose}>
            Renunță
          </button>
        </div>
      </div>
    </Modal>
  );
}

const readFile = (f: File) => f.text();

function ConnectionsCard({ c, onSaved }: { c: Connections; onSaved: () => void }) {
  const [expo, setExpo] = useState('');
  const [keyId, setKeyId] = useState('');
  const [issuerId, setIssuerId] = useState('');
  const [p8, setP8] = useState('');
  const [p8Name, setP8Name] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const save = (body: unknown, ok: string) =>
    run(async () => {
      const r = await api<{ ios: StoreStatus | null; android: StoreStatus | null }>('PUT', '/admin/apps/connections', body);
      const test = r.ios ?? r.android;
      setResult(test && !test.ok ? `Salvat, dar proba nu a mers: ${test.error}` : ok);
      setExpo('');
      setP8('');
      setP8Name('');
      onSaved();
    });
  const done = (when: string) => <span className="pill completed">Conectat {new Date(when).toLocaleDateString('ro-RO')}</span>;

  return (
    <div className="card grid" id="conexiuni" style={{ marginTop: 16, maxWidth: 820 }}>
      <h2 style={{ margin: 0 }}>Conexiuni</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Cheile se păstrează criptat pe server și nu se mai afișează. Nu le trimite nimănui pe chat sau e-mail.
      </p>

      <h3 style={{ marginBottom: 0 }}>1. Expo (construiește și trimite aplicația) {c.expo ? done(c.expo.savedAt) : null}</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Pe expo.dev: Account settings → Access tokens → Create token. Proiectul tafbarbers trebuie legat o dată de GitHub (Project settings → GitHub).
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="password" value={expo} onChange={(e) => setExpo(e.target.value)} placeholder="Lipește tokenul Expo" autoComplete="off" style={{ flex: '1 1 260px' }} />
        <button disabled={busy || !expo.trim()} onClick={() => save({ expoToken: expo.trim() }, 'Expo e conectat.')}>
          Salvează
        </button>
        {c.expo ? (
          <button className="ghost" disabled={busy} onClick={() => save({ expoToken: null }, 'Expo a fost deconectat.')}>
            Scoate
          </button>
        ) : null}
      </div>

      <h3 style={{ marginBottom: 0 }}>2. Apple (starea din App Store și trimiterea la verificare) {c.apple ? done(c.apple.savedAt) : null}</h3>
      <p className="muted small" style={{ margin: 0 }}>
        În App Store Connect: Users and Access → Integrations → App Store Connect API → cheie nouă cu rolul App Manager. Copiezi Issuer ID și Key ID și
        alegi fișierul .p8 descărcat.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={issuerId} onChange={(e) => setIssuerId(e.target.value)} placeholder="Issuer ID" autoComplete="off" style={{ flex: '1 1 260px' }} />
        <input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="Key ID" autoComplete="off" style={{ width: 140 }} />
        <label className="btn ghost sm">
          {p8Name || 'Alege fișierul .p8'}
          <input
            type="file"
            accept=".p8"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) (setP8(await readFile(f)), setP8Name(f.name));
            }}
          />
        </label>
        <button disabled={busy || !keyId || !issuerId || !p8} onClick={() => save({ apple: { keyId, issuerId, p8 } }, 'Apple e conectat.')}>
          Salvează
        </button>
        {c.apple ? (
          <button className="ghost" disabled={busy} onClick={() => save({ apple: null }, 'Apple a fost deconectat.')}>
            Scoate
          </button>
        ) : null}
      </div>

      <h3 style={{ marginBottom: 0 }}>3. Google Play (starea din magazin) {c.google ? done(c.google.savedAt) : null}</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Fișierul .json al contului de serviciu Google, cu acces la aplicație în Play Console (Users and permissions). Poate fi același fișier pe care îl
        folosește Expo la trimiterea în Google Play.
        {c.google ? ` Conectat ca ${c.google.email}.` : ''}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className={`btn${busy ? ' disabled' : ''}`}>
          Alege fișierul .json și salvează
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) await save({ google: { json: await readFile(f) } }, 'Google Play e conectat.');
            }}
          />
        </label>
        {c.google ? (
          <button className="ghost" disabled={busy} onClick={() => save({ google: null }, 'Google a fost deconectat.')}>
            Scoate
          </button>
        ) : null}
      </div>
      {error ? <p className="err">{error}</p> : result ? <p className={result.startsWith('Salvat, dar') ? 'err' : 'success'}>{result}</p> : null}
    </div>
  );
}
