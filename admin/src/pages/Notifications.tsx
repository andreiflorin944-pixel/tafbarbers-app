import { useEffect, useState, type ReactNode } from 'react';
import { api, type Reward } from '../api';
import { Field, Loading, useAction, useLoad, useSub } from '../ui';
import { time } from '../util';
import { RewardFields } from './Referrals';

type Lang = 'ro' | 'en' | 'fr';
type Texts = Record<Lang, string>;
type Automations = {
  winback: { enabled: boolean; weeks: number; hour: number; push: boolean; email: boolean; sms: boolean; title: Texts; message: Texts; bonus: boolean; reward: Reward };
  lastMinute: { enabled: boolean; hours: number[]; window: number; maxPerWeek: number; push: boolean; email: boolean; sms: boolean; title: Texts; message: Texts };
  giftCard: { enabled: boolean; amounts: number[]; validMonths: number; title: Texts; message: Texts };
  links: { appStoreUrl: string; playStoreUrl: string; googleReviewUrl?: string };
  channels: Record<Ev, Channel>;
};
type Ev = 'confirm' | 'cancel' | 'reminder_24h' | 'reminder_2h' | 'order_ready' | 'gift_card';
type Channel = { enabled: boolean; push: boolean; sms: boolean; email: boolean };
const EVENTS: Array<{ k: Ev; label: string }> = [
  { k: 'confirm', label: 'Confirmarea programării' },
  { k: 'reminder_24h', label: 'Reminder cu o zi înainte' },
  { k: 'reminder_2h', label: 'Reminder cu 2 ore înainte' },
  { k: 'cancel', label: 'Programare anulată de salon' },
  { k: 'order_ready', label: 'Comanda din magazin e gata' },
  { k: 'gift_card', label: 'Codul cardului cadou (către cine îl primește)' },
];
type Slot = { start: string; barberName: string };
const LANGS: Record<Lang, string> = { ro: 'Română', en: 'English', fr: 'Français' };
const TAB_SUBS = ['canale', 'dor', 'ore-libere', 'card-cadou', 'linkuri'];
const TABS = ['Ce se trimite și pe unde', 'Ne e dor de tine', 'Ore libere azi', 'Card cadou', 'Butonul „Programează”'] as const;
const SOURCES = [
  { src: 'google', label: 'Google Maps (profilul firmei)' },
  { src: 'instagram', label: 'Instagram (bio sau butonul de rezervare)' },
  { src: 'facebook', label: 'Facebook' },
  { src: 'tiktok', label: 'TikTok' },
  { src: 'site', label: 'Site' },
  { src: 'qr', label: 'Cod QR la salon' },
];
const hourOptions = Array.from({ length: 15 }, (_, i) => i + 7);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Setări → Notificări: mesajele automate, cu textele în trei limbi, editabile de proprietar.
export function NotificationsPage() {
  const load = useLoad(() => api<Automations>('GET', '/admin/automations'));
  const [a, setA] = useState<Automations | null>(null);
  const [tab, setTab] = useState(0);
  const [saved, setSaved] = useState(false);
  const sub = useSub();
  useEffect(() => {
    const i = TAB_SUBS.indexOf(sub);
    if (i >= 0) setTab(i);
  }, [sub]);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (load.data) setA(load.data);
  }, [load.data]);

  if (!a) return <Loading error={load.error} />;
  const dirty = JSON.stringify(a) !== JSON.stringify(load.data);
  const set = <K extends keyof Automations>(k: K, patch: Partial<Automations[K]>) => {
    setSaved(false);
    setA({ ...a, [k]: { ...a[k], ...patch } });
  };

  return (
    <>
      <div className="head">
        <h1>Notificări automate</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Mesajele pe care aplicația le trimite singură. Scrii textul o dată, în română (engleza și franceza sunt pentru clienții care au aplicația în acele
        limbi). Urarea de ziua clientului se setează la <a href="#/birthdays">Zile de naștere</a>.
      </p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t, i) => (
          <button key={t} className={i === tab ? 'sm' : 'ghost sm'} onClick={() => ((location.hash = `#/notifications/${TAB_SUBS[i]}`), setTab(i))}>
            {t}
          </button>
        ))}
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 460px', maxWidth: 640 }}>
          {tab === 0 ? (
            <ChannelsTab channels={a.channels} onChange={(k, p) => setA({ ...a, channels: { ...a.channels, [k]: { ...a.channels[k], ...p } } })} />
          ) : tab === 1 ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Clientul care nu a mai venit de câteva săptămâni și nu are nicio programare primește o singură dată un mesaj, opțional cu o reducere care
                apare în contul lui.
              </p>
              <label className="check">
                <input type="checkbox" checked={a.winback.enabled} onChange={(e) => set('winback', { enabled: e.target.checked })} /> Trimite automat „Ne e dor
                de tine”
              </label>
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <Field label="După câte săptămâni fără vizită">
                  <input type="number" min={2} max={52} value={a.winback.weeks} onChange={(e) => set('winback', { weeks: Number(e.target.value) })} style={{ maxWidth: 100 }} />
                </Field>
                <Field label="De la ce oră se trimite">
                  <select value={a.winback.hour} onChange={(e) => set('winback', { hour: Number(e.target.value) })} style={{ maxWidth: 120 }}>
                    {hourOptions.map((h) => (
                      <option key={h} value={h}>
                        {hh(h)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Channels v={a.winback} onChange={(p) => set('winback', p)} email />
              <TextsEditor title={a.winback.title} message={a.winback.message} vars="{nume} = prenumele, {salon} = numele salonului, {saptamani} = câte săptămâni au trecut" onChange={(p) => set('winback', p)} />
              <label className="check">
                <input type="checkbox" checked={a.winback.bonus} onChange={(e) => set('winback', { bonus: e.target.checked })} /> Dă și o reducere (apare în contul
                clientului)
              </label>
              {a.winback.bonus ? <RewardFields value={a.winback.reward} onChange={(reward) => set('winback', { reward })} /> : null}
            </>
          ) : tab === 2 ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                La orele alese, aplicația verifică dacă au rămas locuri libere în următoarele ore și anunță clienții care au acceptat notificări cu oferte și
                nu au deja o programare.
              </p>
              <label className="check">
                <input type="checkbox" checked={a.lastMinute.enabled} onChange={(e) => set('lastMinute', { enabled: e.target.checked })} /> Anunță automat orele
                libere de azi
              </label>
              <Field label="La ce ore se verifică">
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} title="Maxim 4 ore">
                  {hourOptions.filter((h) => h <= 20).map((h) => {
                    const on = a.lastMinute.hours.includes(h);
                    return (
                      <button
                        key={h}
                        className={on ? 'sm' : 'ghost sm'}
                        onClick={() => set('lastMinute', { hours: on ? a.lastMinute.hours.filter((x) => x !== h) : [...a.lastMinute.hours, h].sort((x, y) => x - y) })}
                      >
                        {hh(h)}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <Field label="Locurile din următoarele (ore)">
                  <input type="number" min={1} max={10} value={a.lastMinute.window} onChange={(e) => set('lastMinute', { window: Number(e.target.value) })} style={{ maxWidth: 100 }} />
                </Field>
                <Field label="Același client, maxim de câte ori pe săptămână">
                  <input type="number" min={1} max={7} value={a.lastMinute.maxPerWeek} onChange={(e) => set('lastMinute', { maxPerWeek: Number(e.target.value) })} style={{ maxWidth: 100 }} />
                </Field>
              </div>
              <Channels v={a.lastMinute} onChange={(p) => set('lastMinute', p)} email />
              <TextsEditor title={a.lastMinute.title} message={a.lastMinute.message} vars="{nume} = prenumele, {salon} = numele salonului, {ore} = orele libere (ex. 14:30, 15:00)" onChange={(p) => set('lastMinute', p)} />
            </>
          ) : tab === 3 ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Clientul alege suma și cui îi face cadou. Plătește la salon (până avem plata cu cardul); când marchezi cardul ca încasat, destinatarul primește
                codul prin SMS și în aplicație. Cardurile se văd la <a href="#/giftcards">Carduri cadou</a>.
              </p>
              <label className="check">
                <input type="checkbox" checked={a.giftCard.enabled} onChange={(e) => set('giftCard', { enabled: e.target.checked })} /> Clienții pot cumpăra carduri
                cadou din aplicație
              </label>
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <Field label="Sumele propuse (lei, separate prin virgulă)">
                  <AmountsInput value={a.giftCard.amounts} onChange={(amounts) => set('giftCard', { amounts })} />
                </Field>
                <Field label="Valabil (luni)">
                  <input type="number" min={1} max={36} value={a.giftCard.validMonths} onChange={(e) => set('giftCard', { validMonths: Number(e.target.value) })} style={{ maxWidth: 100 }} />
                </Field>
              </div>
              <TextsEditor
                title={a.giftCard.title}
                message={a.giftCard.message}
                vars="{nume} = cine primește, {de_la} = cine îl face cadou, {suma}, {cod} = codul cardului, {mesaj} = urarea scrisă de cumpărător, {salon}"
                onChange={(p) => set('giftCard', p)}
              />
            </>
          ) : (
            <LinksTab links={a.links} onChange={(p) => set('links', p)} />
          )}
          {error ? <div className="err">{error}</div> : null}
          <div className="row">
            <button
              disabled={busy || !dirty}
              onClick={() =>
                run(async () => {
                  const r = await api<Automations>('PUT', '/admin/automations', a);
                  setA(r);
                  setSaved(true);
                  load.reload();
                })
              }
            >
              Salvează
            </button>
            {saved && !dirty ? <span className="success small">Salvat.</span> : null}
          </div>
        </div>
        <Side tab={tab} a={a} />
      </div>
    </>
  );
}

function Channels<T extends { push: boolean; sms: boolean; email?: boolean }>({ v, onChange, email }: { v: T; onChange: (p: Partial<T>) => void; email?: boolean }) {
  return (
    <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
      <label className="check">
        <input type="checkbox" checked={v.push} onChange={(e) => onChange({ push: e.target.checked } as Partial<T>)} /> Push
      </label>
      {email ? (
        <label className="check">
          <input type="checkbox" checked={!!v.email} onChange={(e) => onChange({ email: e.target.checked } as Partial<T>)} /> E-mail
        </label>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={v.sms} onChange={(e) => onChange({ sms: e.target.checked } as Partial<T>)} /> SMS (se plătește la fiecare mesaj)
      </label>
    </div>
  );
}

function ChannelsTab({ channels, onChange }: { channels: Automations['channels']; onChange: (k: Ev, p: Partial<Channel>) => void }) {
  const cols: Array<{ k: keyof Channel; label: string }> = [
    { k: 'enabled', label: 'Activ' },
    { k: 'push', label: 'Push' },
    { k: 'sms', label: 'SMS' },
    { k: 'email', label: 'E-mail' },
  ];
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>
        Alegi ce mesaje pleacă singure și pe ce canal. Push e gratuit (ajunge doar la cine are aplicația), SMS-ul se plătește la fiecare mesaj, e-mailul
        ajunge doar la cine și-a trecut adresa. Pentru „Ne e dor de tine”, orele libere și ziua de naștere, canalele se aleg în tabul fiecăruia.
      </p>
      <table>
        <thead>
          <tr>
            <th>Mesaj</th>
            {cols.map((c) => (
              <th key={c.k} style={{ textAlign: 'center' }}>
                {c.label}
              </th>
            ))}
            <th style={{ textAlign: 'center' }} title="Se activează după ce salonul are cont WhatsApp Business">
              WhatsApp
            </th>
          </tr>
        </thead>
        <tbody>
          {EVENTS.map((e) => {
            const v = channels[e.k];
            return (
              <tr key={e.k} style={{ opacity: v.enabled ? 1 : 0.55 }}>
                <td>{e.label}</td>
                {cols.map((c) => (
                  <td key={c.k} style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`${e.label}: ${c.label}`}
                      checked={v[c.k]}
                      disabled={c.k !== 'enabled' && !v.enabled}
                      onChange={(ev) => onChange(e.k, { [c.k]: ev.target.checked })}
                    />
                  </td>
                ))}
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" disabled title="În curând" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {EVENTS.some((e) => channels[e.k].enabled && !channels[e.k].push && !channels[e.k].sms && !channels[e.k].email) ? (
        <div className="err">Un mesaj activ fără niciun canal bifat nu ajunge la nimeni.</div>
      ) : null}
      <div className="muted small">WhatsApp se poate porni după ce salonul își face cont WhatsApp Business (îl legăm atunci).</div>
    </>
  );
}

function TextsEditor({ title, message, vars, onChange }: { title: Texts; message: Texts; vars: string; onChange: (p: { title?: Texts; message?: Texts }) => void }) {
  const [lang, setLang] = useState<Lang>('ro');
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        {(Object.keys(LANGS) as Lang[]).map((l) => (
          <button key={l} className={l === lang ? 'sm' : 'ghost sm'} onClick={() => setLang(l)}>
            {LANGS[l]}
          </button>
        ))}
      </div>
      <Field label={`Titlu (${LANGS[lang]})`}>
        <input value={title[lang]} onChange={(e) => onChange({ title: { ...title, [lang]: e.target.value } })} maxLength={80} />
      </Field>
      <Field label={`Mesaj (${LANGS[lang]})`}>
        <textarea value={message[lang]} onChange={(e) => onChange({ message: { ...message, [lang]: e.target.value } })} maxLength={300} />
      </Field>
      <div className="muted small" style={{ marginTop: -6 }}>
        {vars}
      </div>
    </>
  );
}

function AmountsInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const nums = e.target.value
          .split(/[,\s]+/)
          .map(Number)
          .filter((n) => n > 0);
        onChange(nums);
      }}
      style={{ maxWidth: 220 }}
    />
  );
}

function LinksTab({ links, onChange }: { links: Automations['links']; onChange: (p: Partial<Automations['links']>) => void }) {
  const base = `${location.origin}/programare`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (src: string) => {
    navigator.clipboard?.writeText(`${base}?src=${src}`);
    setCopied(src);
  };
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>
        Pune linkul potrivit în fiecare loc. Cine îl apasă de pe telefon ajunge direct la programare în aplicație; dacă nu are aplicația, i se arată unde
        o descarcă. Vezi alături câți au apăsat, pe fiecare sursă.
      </p>
      {SOURCES.map((s) => (
        <Field key={s.src} label={s.label}>
          <div className="row" style={{ gap: 8 }}>
            <input readOnly value={`${base}?src=${s.src}`} onFocus={(e) => e.target.select()} />
            <button className="ghost sm" onClick={() => copy(s.src)}>
              {copied === s.src ? 'Copiat' : 'Copiază'}
            </button>
          </div>
        </Field>
      ))}
      <Field label="Linkul pentru recenzii Google (din profilul de companie: Cere recenzii → copiază linkul)">
        <input value={links.googleReviewUrl ?? ''} placeholder="https://g.page/r/..." onChange={(e) => onChange({ googleReviewUrl: e.target.value })} />
      </Field>
      <Field label="Linkul aplicației în App Store (după publicare)">
        <input value={links.appStoreUrl} placeholder="https://apps.apple.com/..." onChange={(e) => onChange({ appStoreUrl: e.target.value })} />
      </Field>
      <Field label="Linkul aplicației în Google Play (după publicare)">
        <input value={links.playStoreUrl} placeholder="https://play.google.com/store/apps/..." onChange={(e) => onChange({ playStoreUrl: e.target.value })} />
      </Field>
      <div className="small" style={{ lineHeight: 1.6 }}>
        <b>Google Maps:</b> business.google.com → profilul TAF Barbers → Editează profilul → Rezervări (sau „Linkuri pentru programări”) → lipești linkul Google.
        <br />
        <b>Instagram:</b> Editează profilul → Linkuri → Adaugă link extern → lipești linkul Instagram. Poți pune același link și la butonul de acțiune
        „Rezervă”.
      </div>
    </>
  );
}

function Side({ tab, a }: { tab: number; a: Automations }): ReactNode {
  if (tab === 0) return null;
  if (tab === 2) return <FreeSlots window={a.lastMinute.window} />;
  if (tab === 4) return <LinkStats />;
  const s = tab === 1 ? a.winback : a.giftCard;
  const sample =
    tab === 1
      ? { nume: 'Andrei', salon: 'TAF Barbers', saptamani: String(a.winback.weeks) }
      : { nume: 'Mihai', de_la: 'Andrei', suma: String(a.giftCard.amounts[1] ?? 100), cod: 'TAF-AB12-CD34', mesaj: 'La mulți ani!', salon: 'TAF Barbers' };
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (m, k: string) => (sample as unknown as Record<string, string>)[k] ?? m);
  return (
    <div className="card" style={{ flex: '1 1 300px', maxWidth: 380 }}>
      <h2 style={{ marginTop: 0 }}>Cum arată</h2>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
        <b>{fill(s.title.ro)}</b>
        <div className="small" style={{ marginTop: 4 }}>
          {fill(s.message.ro)}
        </div>
      </div>
    </div>
  );
}

function FreeSlots({ window }: { window: number }) {
  const r = useLoad(() => api<Slot[]>('GET', `/admin/automations/free-slots?hours=${window}`), [window]);
  return (
    <div className="card" style={{ flex: '1 1 300px', maxWidth: 380 }}>
      <h2 style={{ marginTop: 0 }}>Ce s-ar anunța acum</h2>
      {!r.data ? (
        <Loading error={r.error} />
      ) : r.data.length === 0 ? (
        <div className="muted small">În următoarele {window} ore nu e niciun loc liber.</div>
      ) : (
        <div className="small">
          {[...new Set(r.data.map((x) => time(x.start)))].slice(0, 12).join(', ')}
          <div className="muted" style={{ marginTop: 6 }}>
            {r.data.length} locuri libere, la {[...new Set(r.data.map((x) => x.barberName))].join(' și ')}.
          </div>
        </div>
      )}
    </div>
  );
}

function LinkStats() {
  const r = useLoad(() => api<Array<{ src: string; n: number }>>('GET', '/admin/link-stats'));
  const label = (src: string) => SOURCES.find((s) => s.src === src)?.label.split(' (')[0] ?? 'Altele';
  return (
    <div className="card" style={{ flex: '1 1 300px', maxWidth: 380 }}>
      <h2 style={{ marginTop: 0 }}>Apăsări în ultimele 30 de zile</h2>
      {!r.data ? (
        <Loading error={r.error} />
      ) : r.data.length === 0 ? (
        <div className="muted small">Încă nu a apăsat nimeni linkul.</div>
      ) : (
        r.data.map((x) => (
          <div key={x.src} className="row small" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <span>{label(x.src)}</span>
            <b>{x.n}</b>
          </div>
        ))
      )}
    </div>
  );
}
