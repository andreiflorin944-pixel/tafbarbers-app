import { useEffect, useState } from 'react';
import { api, type Reward } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { longDate, today } from '../util';
import { RewardFields } from './Referrals';

type Lang = 'ro' | 'en' | 'fr';
type Settings = {
  enabled: boolean;
  hour: number;
  push: boolean;
  email: boolean;
  sms: boolean;
  title: Record<Lang, string>;
  message: Record<Lang, string>;
  bonus: boolean;
  reward: Reward;
};
type Upcoming = Array<{ day: string; clients: Array<{ id: string; name: string; phone: string; birthDate: string }> }>;
const LANGS: Record<Lang, string> = { ro: 'Română', en: 'English', fr: 'Français' };

export function BirthdaysPage() {
  const settings = useLoad(() => api<Settings>('GET', '/admin/birthday-settings'));
  const upcoming = useLoad(() => api<Upcoming>('GET', '/admin/birthdays?days=14'));
  const [s, setS] = useState<Settings | null>(null);
  const [lang, setLang] = useState<Lang>('ro');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  if (!s) return <Loading error={settings.error} />;
  const dirty = JSON.stringify(s) !== JSON.stringify(settings.data);
  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setS({ ...s, ...patch });
  };
  const age = (birth: string, day: string) => Number(day.slice(0, 4)) - Number(birth.slice(0, 4));

  return (
    <>
      <div className="head">
        <h1>Zile de naștere</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Programările făcute de ziua clientului apar cu o lumânare și un chenar care pulsează, în calendar și în aplicația frizerilor. Dimineața, clientul
        primește automat „La mulți ani”: push în aplicație și, dacă a acceptat ofertele, e-mail sau SMS.
      </p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 420px', maxWidth: 600 }}>
          <label className="check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Trimite automat urarea de ziua clientului
          </label>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <label className="check">
              <input type="checkbox" checked={s.push} onChange={(e) => set({ push: e.target.checked })} /> Push
            </label>
            <label className="check">
              <input type="checkbox" checked={s.email} onChange={(e) => set({ email: e.target.checked })} /> E-mail
            </label>
            <label className="check">
              <input type="checkbox" checked={s.sms} onChange={(e) => set({ sms: e.target.checked })} /> SMS (se plătește la fiecare mesaj)
            </label>
          </div>
          <Field label="De la ce oră se trimite">
            <select value={s.hour} onChange={(e) => set({ hour: Number(e.target.value) })} style={{ maxWidth: 140 }}>
              {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
          <div className="row" style={{ gap: 6 }}>
            {(Object.keys(LANGS) as Lang[]).map((l) => (
              <button key={l} className={l === lang ? 'sm' : 'ghost sm'} onClick={() => setLang(l)}>
                {LANGS[l]}
              </button>
            ))}
          </div>
          <Field label={`Titlu (${LANGS[lang]})`}>
            <input value={s.title[lang]} onChange={(e) => set({ title: { ...s.title, [lang]: e.target.value } })} maxLength={80} />
          </Field>
          <Field label={`Mesaj (${LANGS[lang]}). {nume} = prenumele clientului, {salon} = numele salonului`}>
            <textarea value={s.message[lang]} onChange={(e) => set({ message: { ...s.message, [lang]: e.target.value } })} maxLength={300} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={s.bonus} onChange={(e) => set({ bonus: e.target.checked })} /> Dă și un bonus de ziua lui (apare în contul clientului)
          </label>
          {s.bonus ? <RewardFields value={s.reward} onChange={(reward) => set({ reward })} /> : null}
          {error ? <div className="err">{error}</div> : null}
          <div className="row">
            <button
              disabled={busy || !dirty}
              onClick={() =>
                run(async () => {
                  await api('PUT', '/admin/birthday-settings', s);
                  setSaved(true);
                  settings.reload();
                })
              }
            >
              Salvează
            </button>
            {saved && !dirty ? <span className="success small">Salvat.</span> : null}
          </div>
        </div>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <h2 style={{ marginTop: 0 }}>Următoarele 14 zile</h2>
          {!upcoming.data ? (
            <Loading error={upcoming.error} />
          ) : upcoming.data.length === 0 ? (
            <div className="muted small">Niciun client nu își serbează ziua în perioada asta.</div>
          ) : (
            upcoming.data.map((d) => (
              <div key={d.day} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <b className={d.day === today() ? 'success' : undefined}>{d.day === today() ? 'Azi 🕯️' : longDate(`${d.day}T12:00:00Z`)}</b>
                {d.clients.map((c) => (
                  <div key={c.id} className="small">
                    {c.name || 'Client'} · {age(c.birthDate, d.day)} ani
                    {c.phone ? (
                      <>
                        {' · '}
                        <a href={`tel:${c.phone}`}>{c.phone}</a>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
