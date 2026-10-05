import { useEffect, useState } from 'react';
import { api, type Appearance } from '../api';
import { Field, ImagePicker, Loading, useAction, useLoad } from '../ui';

// Culori sugerate; se poate alege orice altă culoare.
const PRESETS = ['#F9A11B', '#E8C547', '#D64545', '#2E86DE', '#1ABC9C', '#27AE60', '#9B59B6', '#FFFFFF'];
const LANGS = [
  { code: 'ro', label: 'Română', ph: 'Bine ai venit' },
  { code: 'en', label: 'English', ph: 'Welcome' },
  { code: 'fr', label: 'Français', ph: 'Bienvenue' },
] as const;

/** Text negru pe culori deschise, alb pe cele închise. */
export function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#FFFFFF';
}

export function AppearancePage() {
  const data = useLoad(() => api<Appearance>('GET', '/admin/appearance'));
  const [v, setV] = useState<Appearance | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (data.data) setV(data.data);
  }, [data.data]);

  if (!v) return <Loading error={data.error} />;
  const set = (patch: Partial<Appearance>) => {
    setSaved(false);
    setV({ ...v, ...patch });
  };
  const dirty = JSON.stringify(v) !== JSON.stringify(data.data);
  const on = textOn(v.accent);

  return (
    <>
      <div className="head">
        <h1>Aspect aplicație</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Culoarea, logo-ul și textul de bun venit din aplicație. Pozele serviciilor și ale frizerilor le pui la Servicii și la Frizeri. Clienții văd
        culoarea nouă de la următoarea deschidere a aplicației.
      </p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 380px', maxWidth: 560 }}>
          <Field label="Culoarea principală">
            <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="swatches">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    className={c === v.accent ? 'on' : ''}
                    style={{ background: c }}
                    onClick={() => set({ accent: c })}
                  />
                ))}
              </div>
              <input type="color" value={v.accent} onChange={(e) => set({ accent: e.target.value.toUpperCase() })} style={{ width: 52, height: 36, padding: 2 }} aria-label="Altă culoare" />
            </div>
          </Field>
          <Field label="Logo (PNG cu fundal transparent arată cel mai bine)">
            <ImagePicker value={v.logoUrl} onChange={(logoUrl) => set({ logoUrl })} keepAlpha maxPx={600} />
          </Field>
          <Field label="Nume pe prima pagină (apare când nu ai logo)">
            <input value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={40} />
          </Field>
          {LANGS.map((l) => (
            <Field key={l.code} label={`Mesaj de bun venit, ${l.label} (gol = „${l.ph}”)`}>
              <input value={v.welcome[l.code]} onChange={(e) => set({ welcome: { ...v.welcome, [l.code]: e.target.value } })} placeholder={l.ph} maxLength={60} />
            </Field>
          ))}
          {error ? <div className="err">{error}</div> : null}
          <div className="row">
            <button
              disabled={busy || !dirty}
              onClick={() =>
                run(async () => {
                  await api('PUT', '/admin/appearance', v);
                  setSaved(true);
                  data.reload();
                })
              }
            >
              Salvează
            </button>
            {saved && !dirty ? <span className="success small">Salvat.</span> : null}
          </div>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Previzualizare
          </div>
          <div className="phone">
            <div className="muted small">{v.welcome.ro || 'Bine ai venit'}</div>
            {v.logoUrl ? <img className="logo" src={v.logoUrl} alt="Logo" /> : <div className="brand">{v.title}</div>}
            <div className="hero" style={{ background: v.accent, color: on }}>
              <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 1.5 }}>URMĂTOAREA PROGRAMARE</div>
              <div style={{ fontSize: 24 }}>10:30</div>
            </div>
            <div className="cta" style={{ background: v.accent, color: on }}>
              Rezervă o programare
            </div>
            <div style={{ color: v.accent, fontWeight: 700 }}>60 lei</div>
          </div>
        </div>
      </div>
    </>
  );
}
