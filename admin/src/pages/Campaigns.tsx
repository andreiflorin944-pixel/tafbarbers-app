import { useState } from 'react';
import { api, type Campaign, type Me } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { date, time } from '../util';

const CHANNELS = {
  push: { label: 'Notificare în aplicație', hint: 'Titlu scurt + un rând de text. Gratuit.' },
  email: { label: 'E-mail', hint: 'Merge la clienții care și-au pus e-mailul și au acceptat ofertele.' },
  sms: { label: 'SMS', hint: 'Se plătește per mesaj la SMS Advert. Păstrează sub 160 de caractere, fără diacritice.' },
} as const;
const STATUS: Record<string, string> = { draft: 'Ciornă', scheduled: 'Programată', sending: 'Se trimite', sent: 'Trimisă', failed: 'Eșuată' };

export function CampaignsPage(_: { me: Me }) {
  const list = useLoad(() => api<Campaign[]>('GET', '/admin/campaigns'));
  const audience = useLoad(() => api<Record<'push' | 'email' | 'sms', number>>('GET', '/admin/campaigns/audience'));
  const [channel, setChannel] = useState<'push' | 'email' | 'sms'>('push');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState('');
  const { busy, error, run } = useAction();
  const n = audience.data?.[channel] ?? 0;

  const submit = (sendNow: boolean) =>
    run(async () => {
      if (sendNow && !confirm(`Trimiți acum către ${n} ${n === 1 ? 'client' : 'clienți'}?`)) return;
      await api('POST', '/admin/campaigns', {
        channel,
        title,
        body,
        sendNow,
        scheduledAt: !sendNow && when ? new Date(when).toISOString() : null,
      });
      setTitle('');
      setBody('');
      setWhen('');
      setTimeout(list.reload, 1200);
      list.reload();
    });

  const resume = (id: string) =>
    run(async () => {
      await api('POST', `/admin/campaigns/${id}/send`);
      setTimeout(list.reload, 1200);
      list.reload();
    });

  return (
    <>
      <div className="head">
        <h1>Campanii cu oferte</h1>
      </div>
      <div className="card grid" style={{ maxWidth: 640, marginBottom: 18 }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(Object.keys(CHANNELS) as Array<keyof typeof CHANNELS>).map((c) => (
            <button key={c} className={c === channel ? 'on sm' : 'sm'} onClick={() => setChannel(c)}>
              {CHANNELS[c].label} ({audience.data?.[c] ?? '…'})
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {CHANNELS[channel].hint} Primesc doar clienții care au acceptat ofertele pe acest canal în aplicație.
        </p>
        <Field label={channel === 'email' ? 'Subiect' : channel === 'sms' ? 'Nume intern (nu se trimite)' : 'Titlu notificare'}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label={`Mesaj${channel === 'sms' ? ` (${body.length}/160)` : ''}`}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={channel === 'sms' ? 320 : 5000} />
        </Field>
        <Field label="Programează pentru (opțional)">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ maxWidth: 260 }} />
        </Field>
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          <button disabled={busy || !title.trim() || !body.trim() || n === 0} onClick={() => submit(true)}>
            Trimite acum
          </button>
          <button className="ghost" disabled={busy || !title.trim() || !body.trim() || !when} onClick={() => submit(false)}>
            Programează
          </button>
          {n === 0 ? <span className="muted small">Niciun client nu a acceptat încă acest canal.</span> : null}
        </div>
      </div>

      <h2>Istoric</h2>
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.length === 0 ? (
        <p className="muted">Nicio campanie încă.</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Campanie</th>
                <th>Canal</th>
                <th>Stare</th>
                <th>Primit</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.title}
                    <div className="muted small">{c.body.slice(0, 90)}</div>
                  </td>
                  <td>{CHANNELS[c.channel].label}</td>
                  <td>
                    {STATUS[c.status] ?? c.status}
                    {c.status === 'scheduled' && c.scheduled_at ? <div className="muted small">{date(c.scheduled_at)}, {time(c.scheduled_at)}</div> : null}
                    {c.status === 'sending' ? <div className="muted small">Se trimite pe rând, câte 100 la 5 minute.</div> : null}
                    {c.status === 'failed' ? (
                      <div>
                        <button className="ghost sm" disabled={busy} onClick={() => resume(c.id)}>
                          Reia trimiterea
                        </button>
                        <div className="muted small">Primesc doar cei la care nu a ajuns încă.</div>
                      </div>
                    ) : null}
                  </td>
                  <td>{c.status === 'sent' || c.status === 'sending' || c.status === 'failed' ? c.recipients : '–'}</td>
                  <td className="small">{date(c.sent_at ?? c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
