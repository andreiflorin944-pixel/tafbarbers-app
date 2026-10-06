import { useEffect, useState } from 'react';
import { api, type Me } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { date } from '../util';

type V = { title: string; body: string } | null;
type DocData = { updatedAt: string | null; isDefault: boolean; versions: { ro: V; en: V; fr: V } };
const DOCS = [
  { key: 'terms', label: 'Termeni și condiții' },
  { key: 'privacy', label: 'Confidențialitate (GDPR)' },
] as const;
const LANGS = [
  { code: 'ro', label: 'Română' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
] as const;

export function LegalPage({ me }: { me: Me }) {
  const data = useLoad(() => api<Record<string, DocData>>('GET', '/admin/legal'));
  const [doc, setDoc] = useState<'terms' | 'privacy'>('terms');
  const [lang, setLang] = useState<'ro' | 'en' | 'fr'>('ro');
  const [versions, setVersions] = useState<Record<string, { title: string; body: string }>>({});
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    const d = data.data?.[doc];
    if (!d) return;
    setVersions({
      ro: d.versions.ro ?? { title: '', body: '' },
      en: d.versions.en ?? { title: '', body: '' },
      fr: d.versions.fr ?? { title: '', body: '' },
    });
    setSaved(false);
  }, [data.data, doc]);

  if (!data.data) return <Loading error={data.error} />;
  const d = data.data[doc];
  const v = versions[lang] ?? { title: '', body: '' };
  const set = (patch: Partial<{ title: string; body: string }>) => {
    setSaved(false);
    setVersions((x) => ({ ...x, [lang]: { ...v, ...patch } }));
  };
  const publicUrl = `${location.origin}/legal/${doc}`;

  return (
    <>
      <div className="head">
        <h1>Regulamente</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Clienții le văd în aplicație (Despre) și trebuie să le accepte când își fac cont. Linkul public îl poți pune pe site și în App Store / Google Play:{' '}
        <a href={publicUrl} target="_blank" rel="noreferrer">
          {publicUrl}
        </a>
        . Modelul standard e scris pentru România și UE (GDPR, dreptul de retragere de 14 zile, ANPC). Datele firmei le completezi o singură dată în{' '}
        <a href="#/settings/firma">Setări → Datele firmei</a> și apar singure în text. În text poți folosi {'{company}'}, {'{cui}'}, {'{regcom}'}, {'{seat}'}, {'{email}'},{' '}
        {'{phone}'}, {'{address}'}, {'{name}'} și {'{policy}'} (politica de anulare).
      </p>
      <div className="tabs">
        {DOCS.map((x) => (
          <button key={x.key} className={x.key === doc ? 'on' : ''} onClick={() => setDoc(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="card grid" style={{ maxWidth: 820 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {LANGS.map((l) => (
              <button key={l.code} className={l.code === lang ? 'on sm' : 'sm'} onClick={() => setLang(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
          <span className="muted small">
            {d.isDefault ? 'Model standard, încă nesalvat de tine' : d.updatedAt ? `Actualizat ${date(d.updatedAt)}` : ''}
          </span>
        </div>
        {lang !== 'ro' ? <p className="muted small" style={{ margin: 0 }}>Opțional. Dacă lași gol, clienții cu limba asta văd textul în română.</p> : null}
        <Field label="Titlu">
          <input value={v.title} onChange={(e) => set({ title: e.target.value })} disabled={!me.owner} />
        </Field>
        <Field label="Text">
          <textarea value={v.body} onChange={(e) => set({ body: e.target.value })} style={{ minHeight: 420, lineHeight: 1.5 }} disabled={!me.owner} />
        </Field>
        {error ? <div className="err">{error}</div> : null}
        {me.owner ? (
          <div className="row">
            <button
              disabled={busy || !versions.ro?.title || !versions.ro?.body}
              onClick={() =>
                run(async () => {
                  await api('PUT', `/admin/legal/${doc}`, { versions });
                  setSaved(true);
                  data.reload();
                })
              }
            >
              Salvează
            </button>
            {saved ? <span className="success small">Salvat. Apare imediat în aplicație.</span> : null}
            {!d.isDefault ? (
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  confirm('Revii la modelul standard? Textul tău editat se pierde.') &&
                  run(async () => {
                    await api('DELETE', `/admin/legal/${doc}`);
                    data.reload();
                  })
                }
              >
                Revino la modelul standard
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
