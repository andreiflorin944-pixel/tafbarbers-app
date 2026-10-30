import { useState } from 'react';
import { api } from '../api';
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
