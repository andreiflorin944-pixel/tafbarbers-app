import { useRef, useState } from 'react';
import { api } from '../api';
import { Loading, Modal, useAction, useLoad } from '../ui';

type Field = 'sms' | 'pushTitle' | 'pushBody' | 'emailSubject' | 'emailBody';
type FieldVal = { ro: string; en: string; fr: string; custom: boolean; max: number };
type Template = { event: string; label: string; vars: string[]; fields: Partial<Record<Field, FieldVal>> };
type Data = { templates: Template[]; wildcards: Record<string, string> };
type Kind = 'sms' | 'push' | 'email';

const KIND: Record<Kind, { label: string; fields: Field[]; names: Partial<Record<Field, string>> }> = {
  email: { label: 'E-mail', fields: ['emailSubject', 'emailBody'], names: { emailSubject: 'Subiect', emailBody: 'Text' } },
  push: { label: 'Push', fields: ['pushTitle', 'pushBody'], names: { pushTitle: 'Titlu', pushBody: 'Mesaj' } },
  sms: { label: 'SMS', fields: ['sms'], names: { sms: 'Text SMS' } },
};
const KINDS: Kind[] = ['email', 'push', 'sms'];

// Valori de exemplu pentru previzualizare.
const SAMPLE: Record<string, string> = {
  businessname: 'TAFBarbers',
  customerfullname: 'Andrei Popescu',
  customerfirstname: 'Andrei',
  servicename: 'Tuns clasic',
  barbername: 'Florin',
  datetime: 'vineri, 9 octombrie, 10:30',
  code: '4821',
  ordernumber: 'A7K2',
  reviewlink: 'https://g.page/r/...',
  membershipplanname: 'TAF Club lunar',
  enddate: '7 noiembrie 2026',
};
const fill = (s: string) => s.replace(/##([a-z_]+)##/g, (m, k: string) => SAMPLE[k] ?? m);
const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Șabloanele mesajelor automate: adminul scrie textul în română, cu variabile ##...##; engleza și franceza se traduc singure.
export function TemplatesPage() {
  const d = useLoad(() => api<Data>('GET', '/admin/templates'));
  const [open, setOpen] = useState<{ t: Template; kind: Kind } | null>(null);

  const rows = (d.data?.templates ?? []).flatMap((t) =>
    KINDS.filter((k) => KIND[k].fields.some((f) => t.fields[f])).map((kind) => ({ t, kind })),
  );

  return (
    <>
      <div className="head">
        <h1>Șabloane de mesaje</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 780 }}>
        Textele mesajelor automate, pe fiecare canal. Scrii doar în română; engleza și franceza se traduc singure pentru clienții care au aplicația în acele limbi.
        Folosește variabilele de tipul ##customerfirstname##, care se înlocuiesc la trimitere. Pe ce canal pleacă fiecare mesaj alegi la Notificări → Ce se trimite și
        pe unde.
      </p>
      {!d.data ? (
        <Loading error={d.error} />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Tip</th>
                <th>Nume șablon</th>
                <th>Titlu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, kind }) => {
                const k = KIND[kind];
                const custom = k.fields.some((f) => t.fields[f]?.custom);
                const first = t.fields[k.fields[0]]?.ro ?? '';
                return (
                  <tr key={t.event + kind} style={{ cursor: 'pointer' }} onClick={() => setOpen({ t, kind })}>
                    <td>{k.label}</td>
                    <td>
                      {t.label} ({k.label}) {custom ? <span className="pill confirmed">modificat</span> : null}
                    </td>
                    <td className="muted small" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {kind === 'sms' ? first.slice(0, 70) + (first.length > 70 ? '…' : '') : first}
                    </td>
                    <td>
                      <button className="ghost sm">Editează</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && d.data ? (
        <EditModal
          t={open.t}
          kind={open.kind}
          wildcards={d.data.wildcards}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            d.reload();
          }}
        />
      ) : null}
    </>
  );
}

function EditModal({ t, kind, wildcards, onClose, onSaved }: { t: Template; kind: Kind; wildcards: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const k = KIND[kind];
  const fields = k.fields.filter((f) => t.fields[f]);
  const [v, setV] = useState<Partial<Record<Field, string>>>(Object.fromEntries(fields.map((f) => [f, t.fields[f]!.ro])));
  const [focus, setFocus] = useState<Field>(fields[fields.length - 1]);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const { busy, error, run } = useAction();

  const insert = (w: string) => {
    const el = refs.current[focus];
    const cur = v[focus] ?? '';
    const tag = `##${w}##`;
    const at = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? at;
    setV({ ...v, [focus]: cur.slice(0, at) + tag + cur.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tag.length, at + tag.length);
    });
  };
  const save = (reset = false) =>
    run(async () => {
      await api('PUT', `/admin/templates/${t.event}`, { fields: Object.fromEntries(fields.map((f) => [f, reset ? null : v[f]])) });
      onSaved();
    });
  const custom = fields.some((f) => t.fields[f]?.custom);

  return (
    <Modal title={`${t.label} (${k.label})`} onClose={onClose}>
      <div className="grid">
        {fields.map((f) => {
          const max = t.fields[f]!.max;
          const val = v[f] ?? '';
          const long = f === 'sms' || f === 'pushBody' || f === 'emailBody';
          return (
            <label key={f} className="f">
              {k.names[f]}
              {long ? (
                <textarea
                  ref={(el) => {
                    refs.current[f] = el;
                  }}
                  rows={f === 'emailBody' ? 7 : 4}
                  value={val}
                  maxLength={max}
                  onFocus={() => setFocus(f)}
                  onChange={(e) => setV({ ...v, [f]: e.target.value })}
                />
              ) : (
                <input
                  ref={(el) => {
                    refs.current[f] = el;
                  }}
                  value={val}
                  maxLength={max}
                  onFocus={() => setFocus(f)}
                  onChange={(e) => setV({ ...v, [f]: e.target.value })}
                />
              )}
              <span className="muted small">
                Lungimea textului: {val.length}/{max}
                {f === 'sms' ? ' · se trimite fără diacritice, ca să încapă mai mult într-un SMS' : ''}
              </span>
            </label>
          );
        })}

        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Variabile (apasă ca s-o pui în text, acolo unde e cursorul):
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {t.vars.map((w) => (
              <button key={w} type="button" className="ghost sm" title={wildcards[w]} onClick={() => insert(w)}>
                ##{w}##
              </button>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {t.vars.map((w) => `##${w}## = ${wildcards[w]}`).join(' · ')}
          </div>
        </div>

        <div className="card" style={{ background: 'var(--card-alt)' }}>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Cum arată (cu date de exemplu):
          </div>
          {fields.map((f) => (
            <div key={f} style={{ whiteSpace: 'pre-wrap', fontWeight: f === 'pushTitle' || f === 'emailSubject' ? 700 : 400 }}>
              {f === 'sms' ? stripDiacritics(fill(v[f] ?? '')) : fill(v[f] ?? '')}
            </div>
          ))}
        </div>

        {error ? <div className="err">{error}</div> : null}
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button className="ghost" disabled={busy || !custom} onClick={() => confirm('Revii la textul inițial?') && save(true)}>
            Revino la textul inițial
          </button>
          <div className="row">
            <button className="ghost" onClick={onClose}>
              Renunță
            </button>
            <button disabled={busy || fields.some((f) => !(v[f] ?? '').trim())} onClick={() => save()}>
              Salvează
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
