import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Field, ImagePicker, Loading, useAction, useLoad } from '../ui';
import { textOn } from './Appearance';

type Lang = 'ro' | 'en' | 'fr';
type Website = {
  background: string;
  backgroundImage: string | null;
  backgroundDim: number;
  logoUrl: string | null;
  iconUrl: string | null;
  showIcons: boolean;
  accent: string;
  buttonText: string | null;
  text: string;
  languages: Lang[];
  defaultLang: Lang;
  welcome: Record<Lang, string>;
  layout: 'buttons' | 'tiles';
  sections: { booking: boolean; barbers: boolean; services: boolean; contact: boolean; links: boolean; apps: boolean };
  customDomain: string;
  tracking: { gaId: string; metaPixelId: string };
  links: Array<{ label: string; url: string }>;
};

const SITE_URL = 'https://app.tafbarbers.ro';
const LANG_NAMES: Record<Lang, string> = { ro: 'Română', en: 'English', fr: 'Français' };
const ACCENTS = ['#F9A11B', '#E8C547', '#D64545', '#2E86DE', '#1ABC9C', '#27AE60', '#9B59B6', '#FFFFFF'];
const BACKGROUNDS = ['#000000', '#1E1F22', '#2B2D31', '#FFFFFF'];

const TABS = [
  { key: 'fond', group: 'Imagini', label: 'Fond' },
  { key: 'logo', group: 'Imagini', label: 'Logo' },
  { key: 'icoane', group: 'Imagini', label: 'Icoane' },
  { key: 'culori', label: 'Culori' },
  { key: 'limbi', label: 'Limbi' },
  { key: 'layout', label: 'Aspectul meniului' },
  { key: 'domeniu', label: 'Domeniu personalizat' },
  { key: 'tracking', label: 'Statistici (Google, Meta)' },
  { key: 'linkuri', label: 'Linkurile mele' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const NEXT: Partial<Record<Tab, [Tab, string]>> = {
  fond: ['logo', 'Încărcați logo-ul'],
  logo: ['culori', 'Alegeți culorile'],
  icoane: ['culori', 'Alegeți culorile'],
  culori: ['limbi', 'Alegeți limbile'],
  limbi: ['layout', 'Alegeți aspectul meniului'],
};

export function WebsitePage() {
  const data = useLoad(() => api<Website>('GET', '/admin/website'));
  const [v, setV] = useState<Website | null>(null);
  const [tab, setTab] = useState<Tab>('fond');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const frame = useRef<HTMLIFrameElement>(null);
  const [previewView, setPreviewView] = useState<'home' | 'book'>('home');

  useEffect(() => {
    if (data.data) setV(data.data);
  }, [data.data]);

  // Previzualizarea primește aspectul nesalvat la fiecare schimbare.
  const send = () => frame.current?.contentWindow?.postMessage({ type: 'taf-site', website: v, view: previewView }, location.origin);
  useEffect(send, [v, previewView]);

  if (!v) return <Loading error={data.error} />;
  const set = (patch: Partial<Website>) => {
    setSaved(false);
    setV({ ...v, ...patch });
  };
  const dirty = JSON.stringify(v) !== JSON.stringify(data.data);
  const custom = data.data?.customDomain;

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: '0 12px 0 0' }}>Site web</h1>
        <button
          disabled={busy || !dirty}
          onClick={() =>
            run(async () => {
              const r = await api<Website>('PUT', '/admin/website', v);
              data.setData(r);
              setV(r);
              setSaved(true);
            })
          }
        >
          {busy ? 'Se salvează…' : 'Aplicați modificările'}
        </button>
        <button className="ghost" onClick={() => setTab('domeniu')}>
          Domeniu personalizat
        </button>
        <button className="ghost" onClick={() => setTab('linkuri')}>
          Legăturile mele
        </button>
        {saved && !dirty ? <span className="success">Salvat. Site-ul arată deja varianta nouă.</span> : null}
        {error ? <span className="err">{error}</span> : null}
      </div>
      <p className="small" style={{ margin: '0 0 16px' }}>
        <span className="muted">SITE-UL DVS.: </span>
        <a href={SITE_URL} target="_blank" rel="noreferrer">
          {SITE_URL}
        </a>
        {custom ? <span className="muted"> (și https://{custom}, după ce adresa e legată la server)</span> : null}
        <span className="muted"> · clienții văd serviciile, frizerii, contactul și își fac programare direct de pe site, cu cod pe telefon.</span>
      </p>

      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '0 0 230px', padding: 6 }}>
          {TABS.map((t, i) => (
            <div key={t.key}>
              {'group' in t && (i === 0 || !('group' in TABS[i - 1])) ? <div className="muted small" style={{ padding: '10px 12px 4px', fontWeight: 700 }}>{t.group}</div> : null}
              <button className={tab === t.key ? 'on' : 'ghost'} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, paddingLeft: 'group' in t ? 22 : 12, margin: '2px 0' }} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            </div>
          ))}
        </div>

        <div className="card grid" style={{ flex: '1 1 380px', maxWidth: 620 }}>
          {NEXT[tab] ? (
            <p className="small muted" style={{ margin: 0, textAlign: 'right' }}>
              PASUL URMĂTOR:{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), setTab(NEXT[tab]![0]))}>
                {NEXT[tab]![1].toUpperCase()}
              </a>
            </p>
          ) : null}
          <Editor tab={tab} v={v} set={set} />
        </div>

        <div style={{ flex: '0 0 auto' }}>
          <div className="seg" style={{ marginBottom: 8, justifyContent: 'center', display: 'flex' }}>
            <button className={previewView === 'home' ? 'on' : ''} onClick={() => setPreviewView('home')}>
              Prima pagină
            </button>
            <button className={previewView === 'book' ? 'on' : ''} onClick={() => setPreviewView('book')}>
              Programare
            </button>
          </div>
          <div style={{ width: 340, height: 690, borderRadius: 44, border: '10px solid #111', boxShadow: '0 10px 40px rgba(0,0,0,.35)', overflow: 'hidden', background: '#000' }}>
            <iframe ref={frame} src="/site?preview=1" title="Previzualizare" onLoad={send} style={{ width: 320, height: 670, border: 0, display: 'block' }} />
          </div>
          <p className="muted small" style={{ textAlign: 'center', maxWidth: 340 }}>
            Previzualizarea arată modificările înainte să le aplicați.
          </p>
        </div>
      </div>
    </>
  );
}

function Swatches({ list, value, onChange }: { list: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="swatches">
        {list.map((c) => (
          <button key={c} type="button" aria-label={c} className={c === value ? 'on' : ''} style={{ background: c }} onClick={() => onChange(c)} />
        ))}
      </div>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 52, height: 36, padding: 2 }} aria-label="Altă culoare" />
    </div>
  );
}

function Editor({ tab, v, set }: { tab: Tab; v: Website; set: (p: Partial<Website>) => void }) {
  switch (tab) {
    case 'fond':
      return (
        <>
          <h2 style={{ margin: 0 }}>Fundalul site-ului</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Alegeți o culoare sau încărcați o imagine. Pentru telefoane și tablete merge bine o imagine lată de cel puțin 1200px.
          </p>
          <Field label="Încărcați imaginea">
            <ImagePicker value={v.backgroundImage} onChange={(backgroundImage) => set({ backgroundImage })} maxPx={1920} />
          </Field>
          {v.backgroundImage ? (
            <Field label={`Cât de întunecată e imaginea: ${v.backgroundDim}% (mai întunecată = textul se citește mai ușor)`}>
              <input type="range" min={0} max={90} step={5} value={v.backgroundDim} onChange={(e) => set({ backgroundDim: Number(e.target.value) })} />
            </Field>
          ) : null}
          <Field label="Sau selectați culoarea">
            <Swatches list={BACKGROUNDS} value={v.background} onChange={(background) => set({ background, text: textOn(background) })} />
          </Field>
        </>
      );
    case 'logo':
      return (
        <>
          <h2 style={{ margin: 0 }}>Logo</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Apare mare pe prima pagină. Cel mai bine arată un PNG cu fundal transparent. Fără logo aici, site-ul folosește logo-ul din Aspect aplicație.
          </p>
          <Field label="Logo-ul site-ului">
            <ImagePicker value={v.logoUrl} onChange={(logoUrl) => set({ logoUrl })} keepAlpha maxPx={900} />
          </Field>
        </>
      );
    case 'icoane':
      return (
        <>
          <h2 style={{ margin: 0 }}>Icoane</h2>
          <Field label="Iconița site-ului (în tab-ul browserului și pe ecranul telefonului, pătrată)">
            <ImagePicker value={v.iconUrl} onChange={(iconUrl) => set({ iconUrl })} keepAlpha maxPx={512} />
          </Field>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={v.showIcons} onChange={(e) => set({ showIcons: e.target.checked })} style={{ width: 'auto' }} />
            Iconițe pe butoanele din meniu (Programare, Frizerii, Servicii…)
          </label>
        </>
      );
    case 'culori':
      return (
        <>
          <h2 style={{ margin: 0 }}>Culori</h2>
          <Field label="Butoanele și bara de sus">
            <Swatches list={ACCENTS} value={v.accent} onChange={(accent) => set({ accent })} />
          </Field>
          <Field label="Textul de pe butoane">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <button type="button" className={v.buttonText === null ? 'on sm' : 'ghost sm'} onClick={() => set({ buttonText: null })}>
                Automat
              </button>
              <input type="color" value={v.buttonText ?? textOn(v.accent)} onChange={(e) => set({ buttonText: e.target.value.toUpperCase() })} style={{ width: 52, height: 32, padding: 2 }} aria-label="Textul de pe butoane" />
            </div>
          </Field>
          <Field label="Textul paginii">
            <Swatches list={['#FFFFFF', '#000000']} value={v.text} onChange={(text) => set({ text })} />
          </Field>
        </>
      );
    case 'limbi':
      return (
        <>
          <h2 style={{ margin: 0 }}>Limbi</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Clientul alege limba din colțul din dreapta sus. Serviciile și descrierile apar traduse automat, ca în aplicație.
          </p>
          {(['ro', 'en', 'fr'] as Lang[]).map((l) => (
            <label key={l} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={v.languages.includes(l)}
                disabled={v.languages.length === 1 && v.languages.includes(l)}
                onChange={(e) => {
                  const languages = e.target.checked ? (['ro', 'en', 'fr'] as Lang[]).filter((x) => x === l || v.languages.includes(x)) : v.languages.filter((x) => x !== l);
                  set({ languages, defaultLang: languages.includes(v.defaultLang) ? v.defaultLang : languages[0] });
                }}
              />
              {LANG_NAMES[l]}
            </label>
          ))}
          <Field label="Limba la prima deschidere (dacă telefonul clientului nu e pe una din cele de mai sus)">
            <select value={v.defaultLang} onChange={(e) => set({ defaultLang: e.target.value as Lang })}>
              {v.languages.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </Field>
          {v.languages.map((l) => (
            <Field key={l} label={`Textul din bara de sus, ${LANG_NAMES[l]} (gol = ${l === 'ro' ? '„Bine ați venit”' : l === 'en' ? '“Welcome”' : '« Bienvenue »'})`}>
              <input value={v.welcome[l]} maxLength={40} onChange={(e) => set({ welcome: { ...v.welcome, [l]: e.target.value } })} />
            </Field>
          ))}
        </>
      );
    case 'layout':
      return (
        <>
          <h2 style={{ margin: 0 }}>Aspectul meniului</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className={v.layout === 'buttons' ? 'on' : 'ghost'} onClick={() => set({ layout: 'buttons' })}>
              Butoane pe rând (ca în aplicație)
            </button>
            <button className={v.layout === 'tiles' ? 'on' : 'ghost'} onClick={() => set({ layout: 'tiles' })}>
              Pătrate câte două
            </button>
          </div>
          <Field label="Ce apare pe prima pagină">
            <div className="grid" style={{ gap: 6 }}>
              {(
                [
                  ['booking', 'Programare online'],
                  ['barbers', 'Frizerii'],
                  ['services', 'Servicii și prețuri'],
                  ['contact', 'Contact, hartă și program'],
                  ['links', 'Linkurile mele'],
                  ['apps', 'Butoanele App Store și Google Play'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={v.sections[k]} onChange={(e) => set({ sections: { ...v.sections, [k]: e.target.checked } })} />
                  {label}
                </label>
              ))}
            </div>
          </Field>
        </>
      );
    case 'domeniu':
      return (
        <>
          <h2 style={{ margin: 0 }}>Domeniu personalizat</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Site-ul merge deja la {SITE_URL}. Dacă vreți și altă adresă (de exemplu programari.tafbarbers.ro sau www.tafbarbers.ro), scrieți-o aici și
            salvați. Adresa începe să meargă după ce e legată la server, la următoarea publicare a serverului.
          </p>
          <Field label="Adresa (fără https://)">
            <input value={v.customDomain} placeholder="programari.tafbarbers.ro" onChange={(e) => set({ customDomain: e.target.value })} />
          </Field>
        </>
      );
    case 'tracking':
      return (
        <>
          <h2 style={{ margin: 0 }}>Statistici</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Opțional. Cu ele vedeți în Google Analytics și în Meta (Facebook) câți oameni intră pe site. Vizitatorii văd întâi o întrebare dacă sunt de
            acord (cerut de GDPR); fără acord, nu se trimite nimic.
          </p>
          <Field label="Google Analytics, Measurement ID (G-…)">
            <input value={v.tracking.gaId} placeholder="G-XXXXXXXXXX" onChange={(e) => set({ tracking: { ...v.tracking, gaId: e.target.value } })} />
          </Field>
          <Field label="Meta Pixel ID (doar cifre)">
            <input value={v.tracking.metaPixelId} inputMode="numeric" onChange={(e) => set({ tracking: { ...v.tracking, metaPixelId: e.target.value } })} />
          </Field>
        </>
      );
    case 'linkuri':
      return (
        <>
          <h2 style={{ margin: 0 }}>Linkurile mele</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Butoane spre Instagram, TikTok, Facebook, WhatsApp, Google Maps sau orice altă pagină. Apar la „Linkurile mele”.
          </p>
          {v.links.map((l, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input value={l.label} placeholder="Instagram" maxLength={40} style={{ flex: '1 1 140px' }} onChange={(e) => set({ links: v.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input value={l.url} placeholder="https://instagram.com/tafbarbers" style={{ flex: '2 1 220px' }} onChange={(e) => set({ links: v.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <button className="ghost sm" onClick={() => set({ links: v.links.filter((_, j) => j !== i) })}>
                Scoate
              </button>
            </div>
          ))}
          {v.links.length < 12 ? (
            <div>
              <button className="ghost" onClick={() => set({ links: [...v.links, { label: '', url: '' }] })}>
                + Adaugă un link
              </button>
            </div>
          ) : null}
        </>
      );
  }
}
