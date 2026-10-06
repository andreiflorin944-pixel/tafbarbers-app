import { useEffect, useState } from 'react';
import { api, type Appearance } from '../api';
import { Field, ImagePicker, Loading, useAction, useLoad } from '../ui';

// Culori sugerate; se poate alege orice altă culoare.
const PRESETS = ['#F9A11B', '#E8C547', '#D64545', '#2E86DE', '#1ABC9C', '#27AE60', '#9B59B6', '#FFFFFF'];
const BACKGROUNDS = [
  { hex: '#000000', label: 'Negru' },
  { hex: '#1E1F22', label: 'Gri foarte închis' },
  { hex: '#2B2D31', label: 'Gri antracit' },
];

const DEFAULTS: Omit<Appearance, 'logoUrl' | 'title' | 'welcome'> = {
  accent: '#F9A11B',
  background: '#000000',
  buttonText: null,
  text: '#FFFFFF',
  muted: '#A3A09A',
  card: null,
  backgroundImage: null,
  backgroundDim: 60,
};

/** Amestecă cu alb, ca în aplicație: cardurile automate sunt puțin mai deschise decât fundalul. */
function lighten(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x + (255 - x) * k).toString(16).padStart(2, '0')).join('');
}

function ColorRow({ value, onChange, label, auto }: { value: string | null; onChange: (v: string | null) => void; label: string; auto?: string }) {
  return (
    <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {auto ? (
        <button type="button" className={value === null ? 'on sm' : 'ghost sm'} onClick={() => onChange(null)}>
          Automat
        </button>
      ) : null}
      <input type="color" value={value ?? auto ?? '#FFFFFF'} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 52, height: 32, padding: 2 }} aria-label={label} />
      <span className="muted small">{value ?? 'ales automat'}</span>
    </div>
  );
}

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
    if (data.data) setV({ ...DEFAULTS, ...data.data });
  }, [data.data]);

  if (!v) return <Loading error={data.error} />;
  const set = (patch: Partial<Appearance>) => {
    setSaved(false);
    setV({ ...v, ...patch });
  };
  const dirty = JSON.stringify(v) !== JSON.stringify({ ...DEFAULTS, ...data.data });
  const on = v.buttonText ?? textOn(v.accent);
  const card = v.card ?? lighten(v.background, 0.06);

  return (
    <>
      <div className="head">
        <h1>Aspect aplicație</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Culorile, poza de fundal, logo-ul și textul de bun venit din aplicație. Pozele serviciilor le pui la Servicii, ale frizerilor la Frizeri, iar
        pozele bannerelor la Bannere aplicație. Clienții văd aspectul nou de la următoarea deschidere a aplicației.
      </p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 380px', maxWidth: 560 }}>
          <Field label="Culoarea butoanelor și a accentelor (prețuri, iconițe)">
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
          <Field label="Fundalul aplicației">
            <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {BACKGROUNDS.map((b) => (
                <button key={b.hex} type="button" className={b.hex === v.background ? 'on sm' : 'ghost sm'} onClick={() => set({ background: b.hex })}>
                  <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, background: b.hex, border: '1px solid #555' }} /> {b.label}
                </button>
              ))}
              <input type="color" value={v.background} onChange={(e) => set({ background: e.target.value.toUpperCase() })} style={{ width: 52, height: 32, padding: 2 }} aria-label="Alt fundal" />
            </div>
          </Field>
          <Field label="Textul de pe butoane">
            <ColorRow value={v.buttonText} onChange={(buttonText) => set({ buttonText })} label="Textul de pe butoane" auto={textOn(v.accent)} />
          </Field>
          <Field label="Poză de fundal (opțional, pentru toată aplicația)">
            <ImagePicker value={v.backgroundImage} onChange={(backgroundImage) => set({ backgroundImage })} maxPx={1400} />
          </Field>
          {v.backgroundImage ? (
            <Field label={`Cât de întunecată e poza: ${v.backgroundDim}% (mai întunecată = textul se citește mai ușor)`}>
              <input type="range" min={0} max={90} step={5} value={v.backgroundDim} onChange={(e) => set({ backgroundDim: Number(e.target.value) })} />
            </Field>
          ) : null}
          <Field label="Cardurile (servicii, programări)">
            <ColorRow value={v.card} onChange={(c) => set({ card: c })} label="Cardurile" auto={lighten(v.background, 0.06).toUpperCase()} />
          </Field>
          <div className="grid two">
            <Field label="Textul principal">
              <ColorRow value={v.text} onChange={(text) => set({ text: text ?? DEFAULTS.text })} label="Textul principal" />
            </Field>
            <Field label="Textul secundar">
              <ColorRow value={v.muted} onChange={(muted) => set({ muted: muted ?? DEFAULTS.muted })} label="Textul secundar" />
            </Field>
          </div>
          <Field label="Logo (PNG cu fundal transparent arată cel mai bine)">
            <ImagePicker value={v.logoUrl} onChange={(logoUrl) => set({ logoUrl })} keepAlpha maxPx={600} />
          </Field>
          <Field label="Nume pe prima pagină (apare când nu ai logo)">
            <input value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={40} />
          </Field>
          <Field label="Mesaj de bun venit (gol = „Bine ai venit”)">
            <input value={v.welcome.ro} onChange={(e) => set({ welcome: { ...v.welcome, ro: e.target.value } })} placeholder="Bine ai venit" maxLength={60} />
          </Field>
          <div className="muted small">Scrii doar în română. Se traduce singur în engleză și franceză când salvezi.</div>
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
            <button className="ghost" type="button" disabled={busy} onClick={() => confirm('Revii la culorile standard? Logo-ul și textele rămân.') && set(DEFAULTS)}>
              Culorile standard
            </button>
            {saved && !dirty ? <span className="success small">Salvat.</span> : null}
          </div>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Previzualizare
          </div>
          <div
            className="phone"
            style={{
              background: v.backgroundImage
                ? `linear-gradient(rgba(0,0,0,${v.backgroundDim / 100}), rgba(0,0,0,${v.backgroundDim / 100})), url(${v.backgroundImage}) center / cover, ${v.background}`
                : v.background,
            }}
          >
            <div className="small" style={{ color: v.muted }}>{v.welcome.ro || 'Bine ai venit'}</div>
            {v.logoUrl ? <img className="logo" src={v.logoUrl} alt="Logo" /> : <div className="brand" style={{ color: v.text }}>{v.title}</div>}
            <div className="hero" style={{ background: v.accent, color: on }}>
              <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 1.5 }}>URMĂTOAREA PROGRAMARE</div>
              <div style={{ fontSize: 24 }}>10:30</div>
            </div>
            <div className="cta" style={{ background: v.accent, color: on }}>
              Rezervă o programare
            </div>
            <div style={{ background: card, borderRadius: 16, padding: 12, border: `1px solid ${lighten(card, 0.1)}` }}>
              <div style={{ color: v.text, fontWeight: 700 }}>Tuns clasic</div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ color: v.muted, fontSize: 13 }}>30 min</span>
                <span style={{ color: v.accent, fontWeight: 800 }}>60 lei</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
