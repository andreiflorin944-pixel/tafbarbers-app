import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';

type Links = { facebook: string | null; instagram: string | null; tiktok: string | null };
type Promo = { enabled: boolean; percent: number; validDays: number | null; requireTaps: boolean; stats: { claimed: number; used: number }; links: Links };
type Biz = { facebook?: string; instagram?: string; tiktok?: string };
type Form = { enabled: boolean; percent: number; validDays: number | null; requireTaps: boolean; facebook: string; instagram: string; tiktok: string };

// „Urmărește-ne pe rețele și deblochezi X% reducere la o ședință”: cardul din aplicație, configurat de aici.
export function SocialPromoPage() {
  const promo = useLoad(() => api<Promo>('GET', '/admin/social-promo'));
  const biz = useLoad(() => api<Biz>('GET', '/admin/settings'));
  const [f, setF] = useState<Form | null>(null);
  const [initial, setInitial] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!promo.data || !biz.data) return;
    const p = promo.data;
    const b = biz.data;
    const v = { enabled: p.enabled, percent: p.percent, validDays: p.validDays, requireTaps: p.requireTaps, facebook: b.facebook ?? '', instagram: b.instagram ?? '', tiktok: b.tiktok ?? '' };
    setF(v);
    setInitial(v);
  }, [promo.data, biz.data]);

  if (!f || !promo.data) return <Loading error={promo.error ?? biz.error} />;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (patch: Partial<Form>) => {
    setSaved(false);
    setF({ ...f, ...patch });
  };
  const noLinks = !f.facebook.trim() && !f.instagram.trim() && !f.tiktok.trim();
  const { claimed, used } = promo.data.stats;

  return (
    <>
      <div className="head">
        <h1>Promo rețele sociale</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        În aplicație apare cardul „Urmărește-ne pe Facebook, Instagram și TikTok și deblochezi {f.percent}% reducere la o ședință”. Clientul apasă pe rețele, apoi
        pe „Deblochează reducerea” și primește un bonus o singură dată pe cont. Îl vede la Recompense și îl arată la plată; frizerul îl bifează ca folosit, ca la
        orice bonus.
      </p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 420px', maxWidth: 600 }}>
          <label className="check">
            <input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Arată promo-ul în aplicație
          </label>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <Field label="Reducere (%)">
              <input type="number" min={1} max={100} value={f.percent} onChange={(e) => set({ percent: Number(e.target.value) })} style={{ maxWidth: 120 }} />
            </Field>
            <Field label="Valabilă (zile de la deblocare, gol = fără termen)">
              <input
                type="number"
                min={1}
                value={f.validDays ?? ''}
                onChange={(e) => set({ validDays: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ maxWidth: 120 }}
              />
            </Field>
          </div>
          <Field label="Facebook (link către pagină)">
            <input value={f.facebook} onChange={(e) => set({ facebook: e.target.value })} placeholder="https://www.facebook.com/tafbarbers" />
          </Field>
          <Field label="Instagram (link sau @nume)">
            <input value={f.instagram} onChange={(e) => set({ instagram: e.target.value })} placeholder="@tafbarbers" />
          </Field>
          <Field label="TikTok (link sau @nume)">
            <input value={f.tiktok} onChange={(e) => set({ tiktok: e.target.value })} placeholder="@tafbarbers" />
          </Field>
          <div className="muted small">Aceleași linkuri apar și la „Despre noi” în aplicație. O rețea lăsată goală nu apare.</div>
          <label className="check">
            <input type="checkbox" checked={f.requireTaps} onChange={(e) => set({ requireTaps: e.target.checked })} /> Butonul de deblocare apare doar după ce
            clientul a deschis toate rețelele
          </label>
          {f.requireTaps ? (
            <div className="err small">
              Atenție: Apple poate respinge actualizarea aplicației pentru asta (regula 3.2.2 nu permite recompense condiționate de acțiuni ca urmăritul). Oricum
              nu se poate verifica dacă clientul chiar a dat „follow”.
            </div>
          ) : null}
          {f.enabled && noLinks ? <div className="err small">Pune cel puțin un link, altfel cardul nu apare în aplicație.</div> : null}
          {error ? <div className="err">{error}</div> : null}
          <div className="row">
            <button
              disabled={busy || !dirty}
              onClick={() =>
                run(async () => {
                  await api('PUT', '/admin/settings', { facebook: f.facebook.trim(), instagram: f.instagram.trim(), tiktok: f.tiktok.trim() });
                  await api('PUT', '/admin/social-promo', { enabled: f.enabled, percent: f.percent, validDays: f.validDays, requireTaps: f.requireTaps });
                  setSaved(true);
                  promo.reload();
                  biz.reload();
                })
              }
            >
              Salvează
            </button>
            {saved && !dirty ? <span className="success small">Salvat.</span> : null}
          </div>
        </div>
        <div className="card" style={{ flex: '1 1 260px' }}>
          <h2 style={{ marginTop: 0 }}>Rezultate</h2>
          <div>
            <b>{claimed}</b> clienți au deblocat reducerea
          </div>
          <div>
            <b>{used}</b> au folosit-o deja
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            Bonusurile se văd și pe fișa fiecărui client, la Clienți.
          </div>
        </div>
      </div>
    </>
  );
}
