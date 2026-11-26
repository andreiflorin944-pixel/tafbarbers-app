import { useState } from 'react';
import { api, getToken } from '../api';
import { Loading, useAction, useLoad } from '../ui';
import { date, time } from '../util';

type Entry = {
  id: string;
  receivedAt: string;
  subject: string;
  kind: 'new' | 'cancel' | 'change' | 'unknown';
  result: string;
  detail: string;
  bookingId: string | null;
  startsAt: string | null;
  clientName: string | null;
  barberName: string | null;
};
type Status = { connected: boolean; createdAt: string | null; upcoming: number; log: Entry[] };
type Result = { kind: Entry['kind']; result: string; detail: string };

const KIND: Record<Entry['kind'], string> = { new: 'Programare nouă', cancel: 'Anulare', change: 'Modificare', unknown: 'Alt e-mail' };
const RESULT: Record<string, [string, string]> = {
  created: ['Copiată', 'completed'],
  updated: ['Mutată', 'completed'],
  cancelled: ['Anulată și la noi', 'cancelled'],
  duplicate: ['Era deja copiată', 'off'],
  past: ['A trecut, nu se copiază', 'off'],
  ignored: ['Nimic de făcut', 'off'],
  error: ['Nu s-a putut copia', 'cancelled'],
};

/** Scriptul pentru Gmail: la 5 minute trimite serverului e-mailurile noi de la Barberly (prima dată și pe cele din ultimele 60 de zile). */
const script = (url: string, token: string) => `// TAF Barbers: copiază programările din Barberly în panoul TAF.
// Citește doar e-mailurile de la Barberly și le trimite serverului TAF. Nu șterge și nu schimbă nimic în Gmail.
const URL_TAF = '${url}';
const CHEIE = '${token}';

// Rulează o singură dată această funcție: pornește verificarea automată la fiecare 5 minute.
function porneste() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('copiaza').timeBased().everyMinutes(5).create();
  copiaza(true);
}

function copiaza(primaData) {
  const zile = primaData === true ? 60 : 3;
  const props = PropertiesService.getScriptProperties();
  const trimise = JSON.parse(props.getProperty('trimise') || '{}');
  const mesaje = [];
  GmailApp.search('from:barberly newer_than:' + zile + 'd', 0, 200).forEach(function (fir) {
    fir.getMessages().forEach(function (m) { if (!trimise[m.getId()]) mesaje.push(m); });
  });
  // În ordinea în care au venit, ca anularea să vină după programare.
  mesaje.sort(function (a, b) { return a.getDate() - b.getDate(); });
  mesaje.forEach(function (m) {
    const r = UrlFetchApp.fetch(URL_TAF, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + CHEIE },
      muteHttpExceptions: true,
      payload: JSON.stringify({ id: m.getId(), from: m.getFrom(), subject: m.getSubject(), html: m.getBody(), text: m.getPlainBody() }),
    });
    if (r.getResponseCode() === 200) trimise[m.getId()] = m.getDate().getTime();
  });
  const limita = Date.now() - 4 * 864e5;
  Object.keys(trimise).forEach(function (k) { if (trimise[k] < limita) delete trimise[k]; });
  props.setProperty('trimise', JSON.stringify(trimise));
}
`;

export function BarberlyPage() {
  const data = useLoad(() => api<Status>('GET', '/admin/barberly/status'));
  const { busy, error, run } = useAction();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState('');
  const [pasted, setPasted] = useState<Result | null>(null);

  const makeScript = () =>
    (!data.data?.connected || confirm('Faci o cheie nouă? Scriptul pus deja în Gmail nu mai merge până nu îl înlocuiești cu cel nou.')) &&
    run(async () => {
      const { token } = await api<{ token: string }>('POST', '/admin/barberly/token');
      setCode(script(`${location.origin}/v1/barberly/inbound`, token));
      data.reload();
    });
  const stop = () =>
    confirm('Oprești copierea? Scriptul din Gmail nu mai poate trimite e-mailuri. Programările copiate până acum rămân.') &&
    run(async () => {
      await api('DELETE', '/admin/barberly/token');
      setCode(null);
      data.reload();
    });
  const copy = () =>
    code &&
    navigator.clipboard?.writeText(code).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1500)),
      () => prompt('Copiază:', code),
    );
  const importPaste = () =>
    run(async () => {
      setPasted(await api<Result>('POST', '/admin/barberly/paste', { text: paste }));
      setPaste('');
      data.reload();
    });

  const s = data.data;
  return (
    <>
      <div className="head">
        <h1>Programări din Barberly</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Cât timp clienții se mută în aplicația nouă, programările făcute în Barberly se copiază aici singure. Barberly îți trimite un e-mail la fiecare
        programare nouă sau anulare; un mic script din Gmail le trimite serverului la fiecare 5 minute, iar serverul face programarea la frizerul și ora
        din e-mail (clientul e găsit după telefon). Ora rămâne ocupată și în aplicație. Clientul nu primește SMS sau reminder de la noi, pentru că le
        trimite deja Barberly.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {!s ? (
        <Loading error={data.error} />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16, maxWidth: 760 }}>
            <p style={{ marginTop: 0 }}>
              {s.connected ? (
                <>
                  <span className="pill completed">Pornit</span> <span className="muted small">cheie creată {s.createdAt ? `${date(s.createdAt)}, ${time(s.createdAt)}` : ''}</span>
                </>
              ) : (
                <span className="pill off">Oprit</span>
              )}{' '}
              <span className="muted small">· {s.upcoming} programări viitoare copiate din Barberly</span>
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button disabled={busy} onClick={makeScript}>
                {s.connected ? 'Fă o cheie nouă pentru script' : 'Creează scriptul pentru Gmail'}
              </button>
              {s.connected ? (
                <button className="danger" disabled={busy} onClick={stop}>
                  Oprește copierea
                </button>
              ) : null}
            </div>
            {code ? (
              <div style={{ marginTop: 12 }}>
                <p className="small">
                  Scriptul conține cheia, care se arată doar acum. Copiază-l și lipește-l în script.google.com (în contul Gmail în care vin e-mailurile de la
                  Barberly), apoi rulează funcția <b>porneste</b> o singură dată. Nu trimite scriptul nimănui.
                </p>
                <button onClick={copy}>{copied ? 'Copiat ✓' : 'Copiază scriptul'}</button>
                <textarea readOnly value={code} rows={10} style={{ width: '100%', marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} />
              </div>
            ) : null}
          </div>

          <AnnounceCard />
          <ActivationCard />

          <BarberlyPushCard />

          <div className="card" style={{ marginBottom: 16, maxWidth: 760 }}>
            <h3 style={{ marginTop: 0 }}>Copiază de mână un e-mail</h3>
            <p className="muted small">Deschide e-mailul de la Barberly, selectează tot textul, copiază-l și lipește-l aici.</p>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} style={{ width: '100%' }} placeholder="Numire nouă: … CLIENT … CÂND … SERVICII … CU …" />
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button disabled={busy || !paste.trim()} onClick={importPaste}>
                Copiază programarea
              </button>
              {pasted ? (
                <span className="small">
                  <span className={`pill ${RESULT[pasted.result]?.[1] ?? 'off'}`}>{RESULT[pasted.result]?.[0] ?? pasted.result}</span> {pasted.detail}
                </span>
              ) : null}
            </div>
          </div>

          <div className="card table-wrap" style={{ padding: 0 }}>
            <div style={{ padding: '12px 14px', fontWeight: 700 }}>E-mailuri primite (ultimele 100, se păstrează 90 de zile)</div>
            {s.log.length === 0 ? (
              <p className="muted" style={{ padding: '0 14px 12px' }}>
                Încă nu a venit niciun e-mail.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Primit</th>
                    <th>E-mail</th>
                    <th>Programarea</th>
                    <th>Rezultat</th>
                  </tr>
                </thead>
                <tbody>
                  {s.log.map((e) => (
                    <tr key={e.id}>
                      <td className="muted small">
                        {date(e.receivedAt)}, {time(e.receivedAt)}
                      </td>
                      <td>
                        {KIND[e.kind]}
                        <div className="muted small">{e.subject}</div>
                      </td>
                      <td>
                        {e.startsAt ? (
                          <>
                            {e.clientName || 'Client'}
                            <div className="muted small">
                              {date(e.startsAt)}, {time(e.startsAt)} · {e.barberName}
                            </div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${RESULT[e.result]?.[1] ?? 'off'}`}>{RESULT[e.result]?.[0] ?? e.result}</span>
                        {e.detail ? <div className="muted small">{e.detail}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

type PushEntry = { bookingId: string; state: 'synced' | 'error' | 'cancelled'; detail: string; tries: number; updatedAt: string; startsAt: string; clientName: string; barberName: string };
type Named = { id: string; name: string };
type PushView = {
  enabled: boolean;
  hasKey: boolean;
  keyHint: string;
  locationId: string;
  phone: string;
  customerId: string;
  customerName: string;
  barberMap: Record<string, string>;
  serviceMap: Record<string, string>;
  ourBarbers: Named[];
  ourServices: Named[];
  catalog: { locations: Named[]; locationId: string; teamMembers: Named[]; services: Array<Named & { duration: number }> } | null;
  catalogError: string;
  counts: Record<string, number>;
  log: PushEntry[];
  manual?: Array<{ bookingId: string; startsAt: string; fromAt: string | null; clientName: string; barberName: string }>;
};
const PUSH_STATE: Record<PushEntry['state'], [string, string]> = {
  synced: ['În Barberly', 'completed'],
  error: ['Nu s-a putut trimite', 'cancelled'],
  cancelled: ['Anulată și în Barberly', 'off'],
};

/** Calendarul invers: programările făcute la noi se pun și în Barberly (ora ocupată acolo), cât timp se lucrează pe ambele. */
export function BarberlyPushCard() {
  const data = useLoad(() => api<PushView>('GET', '/admin/barberly/push'));
  const { busy, error, run } = useAction();
  const [key, setKey] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [ran, setRan] = useState<string>('');
  const v = data.data;
  const save = (body: Record<string, unknown>) =>
    run(async () => {
      await api<PushView>('PUT', '/admin/barberly/push', body);
      setKey('');
      setPhone(null);
      data.reload();
    });
  const runNow = (retry = false) =>
    run(async () => {
      const r = await api<{ sent: number; moved: number; cancelled: number; errors: number }>('POST', '/admin/barberly/push/run', { retry });
      setRan(`Trimise ${r.sent}, mutate ${r.moved}, anulate ${r.cancelled}${r.errors ? `, cu eroare ${r.errors}` : ''}.`);
      data.reload();
    });

  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 760 }}>
      <h3 style={{ marginTop: 0 }}>Trimite și programările noastre în Barberly</h3>
      <p className="muted small">
        Programările făcute în aplicația TAF, pe site sau în panou apar și în calendarul Barberly, la același frizer și oră, ca nimeni să nu poată lua ora
        acolo. Mutarea și anularea de la noi se fac și acolo (la 5 minute). În Barberly „clientul” e numărul salonului, ca Barberly să nu-i trimită clientului
        SMS-uri; numele clientului e în notiță. O programare din Barberly pusă de mână în panou s-ar trimite înapoi: pe acelea copiază-le din e-mail (mai sus).
      </p>
      {error ? <div className="err">{error}</div> : null}
      {!v ? (
        <Loading error={data.error} />
      ) : (
        <>
          <p>
            {v.enabled ? <span className="pill completed">Pornit</span> : <span className="pill off">Oprit</span>}{' '}
            <span className="muted small">
              {v.hasKey ? `cheie salvată (…${v.keyHint})` : 'fără cheie'} · în Barberly: {v.counts.synced ?? 0} · cu eroare: {v.counts.error ?? 0}
            </span>
          </p>
          <label className="small">
            Cheia API din Barberly (portal.barberly.com → Aplicații → API de rezervare). Lipește-o doar aici; se păstrează criptată.
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={v.hasKey ? 'Cheie nouă (opțional)' : 'bk_live_…'} style={{ flex: 1 }} />
              <button disabled={busy || !key.trim()} onClick={() => save({ key })}>
                Salvează cheia
              </button>
              {v.hasKey ? (
                <button className="danger" disabled={busy} onClick={() => confirm('Ștergi cheia? Trimiterea se oprește.') && save({ key: null })}>
                  Șterge
                </button>
              ) : null}
            </div>
          </label>
          {v.catalogError ? <div className="err">{v.catalogError}</div> : null}
          {v.catalog ? (
            <>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                <label className="small">
                  Locația din Barberly
                  <select value={v.locationId} onChange={(e) => save({ locationId: e.target.value })} disabled={busy}>
                    {v.catalog.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="small">
                  Numărul salonului („clientul” din Barberly)
                  <div className="row" style={{ gap: 8 }}>
                    <input value={phone ?? v.phone} onChange={(e) => setPhone(e.target.value)} placeholder="07…" />
                    {phone !== null && phone !== v.phone ? (
                      <button disabled={busy} onClick={() => save({ phone })}>
                        Salvează
                      </button>
                    ) : null}
                  </div>
                </label>
              </div>
              <BarberlyAccount v={v} onDone={() => data.reload()} />
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Frizerul la noi</th>
                    <th>În Barberly</th>
                  </tr>
                </thead>
                <tbody>
                  {v.ourBarbers.map((b) => (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td>
                        <select value={v.barberMap[b.id] ?? ''} disabled={busy} onChange={(e) => save({ barbers: { ...v.barberMap, [b.id]: e.target.value } })}>
                          <option value="">— nelegat —</option>
                          {v.catalog!.teamMembers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Serviciul la noi</th>
                    <th>În Barberly (durata se ia de la noi)</th>
                  </tr>
                </thead>
                <tbody>
                  {v.ourServices.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>
                        <select value={v.serviceMap[s.id] ?? ''} disabled={busy} onChange={(e) => save({ services: { ...v.serviceMap, [s.id]: e.target.value } })}>
                          <option value="">— primul legat —</option>
                          {v.catalog!.services.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.duration} min)
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button disabled={busy} className={v.enabled ? 'danger' : undefined} onClick={() => save({ enabled: !v.enabled })}>
                  {v.enabled ? 'Oprește trimiterea' : 'Pornește trimiterea'}
                </button>
                {v.enabled ? (
                  <>
                    <button disabled={busy} onClick={() => runNow()}>
                      Trimite acum
                    </button>
                    {v.counts.error ? (
                      <button disabled={busy} onClick={() => runNow(true)}>
                        Reîncearcă erorile
                      </button>
                    ) : null}
                  </>
                ) : null}
                {ran ? <span className="small muted">{ran}</span> : null}
              </div>
            </>
          ) : null}
          {v.manual?.length ? (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid #c9a24b', borderRadius: 10 }}>
              <b>De mutat de mână în Barberly ({v.manual.length})</b>
              <p className="muted small" style={{ marginTop: 4 }}>
                Aceste programări au venit din Barberly și le-ați mutat la noi. Pe ele nu le putem muta noi în Barberly (sunt ale clientului acolo), așa că acolo au rămas la
                ora veche. Mută-le și în Barberly, apoi apasă „Am mutat-o”.
              </p>
              {v.manual.map((m) => (
                <div key={m.bookingId} className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 6 }}>
                  <span className="small">
                    <b>{m.clientName}</b> · {m.barberName}: {m.fromAt ? `${date(m.fromAt)}, ${time(m.fromAt)} → ` : ''}
                    <b>
                      {date(m.startsAt)}, {time(m.startsAt)}
                    </b>
                  </span>
                  <button
                    className="ghost small"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api('POST', '/admin/barberly/push/manual-done', { bookingId: m.bookingId, startsAt: m.startsAt });
                        data.reload();
                      })
                    }
                  >
                    Am mutat-o
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {v.log.length ? (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Programarea</th>
                    <th>Stare</th>
                  </tr>
                </thead>
                <tbody>
                  {v.log.map((e) => (
                    <tr key={e.bookingId}>
                      <td>
                        {e.clientName || 'Client'}
                        <div className="muted small">
                          {date(e.startsAt)}, {time(e.startsAt)} · {e.barberName}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${PUSH_STATE[e.state][1]}`}>{PUSH_STATE[e.state][0]}</span>
                        {e.detail ? <div className="muted small">{e.detail}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Contul de client Barberly sub care se pun programările (salonul cere clienți înregistrați). Parola nu se păstrează la noi. */
function BarberlyAccount({ v, onDone }: { v: PushView; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('Florin');
  const [code, setCode] = useState('');
  const [waiting, setWaiting] = useState(false);
  const call = (body: Record<string, unknown>, after?: () => void) =>
    run(async () => {
      const r = await api<{ codeSent?: boolean }>('POST', '/admin/barberly/push/account', { phone: v.phone, ...body });
      if (r.codeSent) setWaiting(true);
      else {
        setWaiting(false);
        setPassword('');
        setCode('');
        onDone();
      }
      after?.();
    });
  return (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--line, #333)', borderRadius: 12 }}>
      <b>Contul de client din Barberly</b>
      <p className="muted small" style={{ margin: '4px 0 8px' }}>
        Salonul tău din Barberly primește doar programări de la clienți cu cont. Programările din aplicația TAF se pun sub contul de client Barberly al numărului
        salonului ({v.phone || 'nesetat'}). Parola merge doar spre Barberly; la noi nu se păstrează.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {v.customerId ? (
        <p className="small">
          <span className="pill completed">Legat</span> {v.customerName || 'cont Barberly'}{' '}
          <button className="danger" disabled={busy} onClick={() => confirm('Dezlegi contul? Barberly va refuza programările până legi altul.') && call({ action: 'unlink' })}>
            Dezleagă
          </button>
        </p>
      ) : (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {(
              [
                ['login', 'Am cont, știu parola'],
                ['reset', 'Am cont, nu știu parola'],
                ['register', 'Nu am cont'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} className={mode === m ? undefined : 'ghost'} disabled={busy} onClick={() => (setMode(m), setWaiting(false))}>
                {label}
              </button>
            ))}
          </div>
          {waiting ? (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="small">Barberly a trimis un cod de 6 cifre (SMS sau e-mail). Scrie-l aici:</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" style={{ width: 120 }} />
              <button disabled={busy || code.trim().length < 4} onClick={() => call({ action: mode === 'register' ? 'register_confirm' : 'reset_confirm', code })}>
                Confirmă
              </button>
            </div>
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {mode === 'register' ? (
                <>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prenume" style={{ width: 120 }} />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
                </>
              ) : null}
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'login' ? 'Parola contului Barberly' : 'Parolă nouă'}
              />
              <button
                disabled={busy || !password || (mode === 'register' && (!email.trim() || !firstName.trim()))}
                onClick={() => call(mode === 'login' ? { action: 'login', password } : mode === 'register' ? { action: 'register', password, email, firstName } : { action: 'reset', password })}
              >
                {mode === 'login' ? 'Leagă contul' : 'Trimite codul'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type AnnounceView = {
  settings: { enabled: boolean; dailyLimit: number; providerDaily: number; providerMonthly: number; reserve: number; hour: number; skipActive: boolean };
  sent: number;
  failed: number;
  pending: number;
  today: { announce: number; allEmails: number; monthEmails: number; room: number };
  daysLeft: number;
  waves: Array<{ id: string; day: string; label: string; enabled: boolean; doneAt: string | null; sent: number; failed: number; pending: number }>;
  localDay: string;
  emailConfigured: boolean;
};

/** Anunțul „trecem din Barberly în aplicația TAF”, trimis pe e-mail din platforma noastră, câte puțin pe zi (gratuit la Resend). */
export function AnnounceCard() {
  const data = useLoad(() => api<AnnounceView>('GET', '/admin/announce'));
  const { busy, error, run } = useAction();
  const [testTo, setTestTo] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [wave, setWave] = useState('announce-platform');
  const v = data.data;
  const save = (body: Record<string, unknown>) =>
    run(async () => {
      await api('PUT', '/admin/announce', body);
      data.reload();
    });
  const showPreview = () =>
    run(async () => {
      const r = await fetch(`/v1/admin/announce/preview?wave=${encodeURIComponent(wave)}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      setPreview(await r.text());
    });
  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 760 }}>
      <h3 style={{ marginTop: 0 }}>Anunț pe e-mail: ne mutăm în aplicația TAF</h3>
      <p className="muted small">
        Trimite tuturor clienților cu e-mail (importați din Barberly) anunțul în română și engleză: contul e deja la noi, cum intră cu codul, linkurile de
        descărcare. Fiecare client îl primește o singură dată. Pleacă câte puțin în fiecare zi, în limitele planului de e-mail de mai jos (cu tot cu codurile de
        intrare și confirmări). Mai jos sunt și mementourile din 1 decembrie, 9 decembrie și 7 ianuarie, care pleacă singure în ziua lor. Nu se trimite SMS.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {!v ? (
        <Loading error={data.error} />
      ) : (
        <>
          {!v.emailConfigured ? <div className="err">Trimiterea de e-mailuri nu e configurată pe server (lipsește cheia Resend): nu pleacă nimic de fapt.</div> : null}
          <p>
            {v.settings.enabled ? <span className="pill completed">Pornit</span> : <span className="pill off">Oprit</span>}{' '}
            <span className="muted small">
              trimise: {v.sent} · rămase: {v.pending}
              {v.pending ? ` (cam ${v.daysLeft} zile)` : ''} · azi: {v.today.announce} anunțuri, {v.today.allEmails} e-mailuri în total · luna asta: {v.today.monthEmails}
              {v.failed ? ` · nereușite: ${v.failed}` : ''}
            </span>
          </p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="small">
              Anunțuri pe zi
              <input type="number" min={1} defaultValue={v.settings.dailyLimit} onBlur={(e) => +e.target.value !== v.settings.dailyLimit && save({ dailyLimit: +e.target.value })} style={{ width: 90 }} />
            </label>
            <label className="small">
              De la ora
              <select value={v.settings.hour} onChange={(e) => save({ hour: +e.target.value })} disabled={busy}>
                {Array.from({ length: 14 }, (_, i) => i + 6).map((h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="small">
              Limita furnizorului pe zi / lună
              <span className="row" style={{ gap: 4 }}>
                <input type="number" defaultValue={v.settings.providerDaily} onBlur={(e) => +e.target.value !== v.settings.providerDaily && save({ providerDaily: +e.target.value })} style={{ width: 80 }} />
                <input type="number" defaultValue={v.settings.providerMonthly} onBlur={(e) => +e.target.value !== v.settings.providerMonthly && save({ providerMonthly: +e.target.value })} style={{ width: 90 }} />
              </span>
            </label>
          </div>
          <label className="small" style={{ display: 'block', marginTop: 8 }}>
            <input type="checkbox" checked={v.settings.skipActive} onChange={(e) => save({ skipActive: e.target.checked })} disabled={busy} /> Sari peste clienții care au intrat
            deja în aplicație
          </label>
          <p className="muted small">
            Pe zi pleacă cel mult {v.settings.dailyLimit} anunțuri și se lasă mereu {v.settings.reserve} e-mailuri libere pentru coduri și confirmări. Dacă treci pe un plan
            plătit la Resend, mărește limitele de mai sus.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <select value={wave} onChange={(e) => setWave(e.target.value)} disabled={busy}>
              <option value="announce-platform">Anunțul mare (acum)</option>
              {(v.waves ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
            <button className="ghost" disabled={busy} onClick={showPreview}>
              Vezi e-mailul
            </button>
            <input type="email" placeholder="e-mailul tău, pentru probă" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ flex: '1 1 200px' }} />
            <button
              className="ghost"
              disabled={busy || !testTo.includes('@')}
              onClick={() =>
                run(async () => {
                  const r = await api<{ ok: boolean }>('POST', '/admin/announce/test', { email: testTo, wave });
                  setNote(r.ok ? `Proba a plecat la ${testTo}.` : 'Proba n-a plecat (vezi cheia de e-mail).');
                })
              }
            >
              Trimite-mi o probă
            </button>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {v.settings.enabled ? (
              <button className="danger" disabled={busy} onClick={() => save({ enabled: false })}>
                Oprește trimiterea
              </button>
            ) : (
              <button
                disabled={busy || !v.pending}
                onClick={() => confirm(`Pornești anunțul? Pleacă singur, câte ${v.settings.dailyLimit} pe zi, la ${v.pending} clienți.`) && save({ enabled: true })}
              >
                Pornește trimiterea zilnică
              </button>
            )}
            {v.settings.enabled ? (
              <button
                className="ghost"
                disabled={busy || !v.today.room}
                onClick={() =>
                  run(async () => {
                    const r = await api<{ justSent: number }>('POST', '/admin/announce/run', {});
                    setNote(`Trimise acum: ${r.justSent}.`);
                    data.reload();
                  })
                }
              >
                Trimite acum din tranșa de azi ({v.today.room})
              </button>
            ) : null}
          </div>
          {note ? <p className="small">{note}</p> : null}
          <h4 style={{ marginBottom: 4 }}>Mementouri programate</h4>
          <p className="muted small" style={{ marginTop: 0 }}>
            Pleacă singure în ziua lor, de la ora aleasă mai sus, la toți clienții cu e-mail (fără cei care au intrat deja în aplicație, dacă e bifat mai sus). Debifează ca să nu
            plece.
          </p>
          {(v.waves ?? []).map((w) => (
            <div key={w.id} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <label className="small" style={{ flex: '1 1 300px' }}>
                <input type="checkbox" checked={w.enabled} disabled={busy || !!w.doneAt} onChange={(e) => save({ waves: { [w.id]: e.target.checked } })} /> {w.label}
              </label>
              <span className="muted small">
                {w.doneAt
                  ? `trimis: ${w.sent}${w.failed ? ` · nereușite: ${w.failed}` : ''}`
                  : !w.enabled
                    ? 'oprit, nu pleacă'
                    : w.day > v.localDay
                      ? `programat · ${w.pending} clienți`
                      : `se trimite · trimise ${w.sent}, rămase ${w.pending}`}
              </span>
            </div>
          ))}
          {preview ? (
            <div style={{ marginTop: 12 }}>
              <button className="ghost small" onClick={() => setPreview(null)}>
                Închide previzualizarea
              </button>
              <iframe title="Previzualizare" srcDoc={preview} style={{ width: '100%', height: 640, border: '1px solid #333', borderRadius: 8, marginTop: 8, background: '#0e0e10' }} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

type Activation = {
  clients: number;
  active: number;
  activeWeek: number;
  reached: number;
  activatedAfterEmail: number;
  perDay: Array<{ day: string; n: number }>;
  bookings7: { ours: number; barberly: number; panel: number; oursPct: number };
  bookings14: { ours: number; barberly: number; panel: number; oursPct: number };
};

/** Cum merge trecerea: conturi activate în aplicație și de unde vin programările noi. */
export function ActivationCard() {
  const data = useLoad(() => api<Activation>('GET', '/admin/announce/activation'));
  const v = data.data;
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const max = v ? Math.max(1, ...v.perDay.map((d) => d.n)) : 1;
  const dayLabel = (d: string) => `${+d.slice(8, 10)}.${d.slice(5, 7)}`;
  const stat = (big: string | number, small: string) => (
    <div style={{ flex: '1 1 150px', padding: 12, border: '1px solid var(--border, #ddd)', borderRadius: 10 }}>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{big}</div>
      <div className="muted small">{small}</div>
    </div>
  );
  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 760 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Câți clienți au trecut în aplicație</h3>
        <button className="ghost small" onClick={() => data.reload()}>
          Actualizează
        </button>
      </div>
      <p className="muted small">Un cont e „activat” când clientul intră prima dată în aplicație (sau pe site) cu contul lui.</p>
      {!v ? (
        <Loading error={data.error} />
      ) : (
        <>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {stat(v.active, `conturi activate din ${v.clients} clienți (${pct(v.active, v.clients)}%)`)}
            {stat(v.activeWeek, 'activate în ultimele 7 zile')}
            {stat(v.activatedAfterEmail, `s-au activat după e-mail, din ${v.reached} care l-au primit (${pct(v.activatedAfterEmail, v.reached)}%)`)}
          </div>
          <h4 style={{ marginBottom: 6 }}>Conturi activate pe zile (ultimele 14 zile)</h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
            {v.perDay.map((d) => (
              <div key={d.day} style={{ flex: 1, textAlign: 'center' }} title={`${dayLabel(d.day)}: ${d.n}`}>
                <div className="small">{d.n || ''}</div>
                <div style={{ height: Math.round((90 * d.n) / max), minHeight: d.n ? 3 : 1, background: '#c9a24b', borderRadius: 3 }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {v.perDay.map((d) => (
              <div key={d.day} className="muted" style={{ flex: 1, textAlign: 'center', fontSize: 10 }}>
                {dayLabel(d.day)}
              </div>
            ))}
          </div>
          <h4 style={{ marginBottom: 6 }}>Programări noi: aplicație și site față de Barberly</h4>
          {[
            ['Ultimele 7 zile', v.bookings7],
            ['Ultimele 14 zile', v.bookings14],
          ].map(([label, b]) => {
            const x = b as Activation['bookings7'];
            return (
              <div key={label as string} style={{ marginBottom: 8 }}>
                <div className="small">
                  <b>{label as string}:</b> {x.ours} din aplicație și site · {x.barberly} din Barberly · <b>{x.oursPct}% la noi</b>
                  {x.panel ? <span className="muted"> (plus {x.panel} făcute de voi în panou)</span> : null}
                </div>
                <div style={{ height: 10, background: '#e5e2da', borderRadius: 5, overflow: 'hidden', marginTop: 4 }}>
                  <div style={{ width: `${x.oursPct}%`, height: '100%', background: '#c9a24b' }} />
                </div>
              </div>
            );
          })}
          <p className="muted small">Ținta pentru oprirea Barberly pe 11 ianuarie: cel puțin 70% din programările noi la noi, două săptămâni la rând.</p>
        </>
      )}
    </div>
  );
}
