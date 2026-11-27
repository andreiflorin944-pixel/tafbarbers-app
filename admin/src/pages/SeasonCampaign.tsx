import { useEffect, useState } from 'react';
import { api, type Me } from '../api';
import { Field, ImagePicker, Loading, useAction, useLoad } from '../ui';

// Marketing → Campanie de sezon: Crăciun, Paște, Valentine’s, Ziua Tatălui sau una scrisă de mână.
// Între cele două zile apare primul banner pe Acasă (aplicație și site) și, dacă e bifat, un pop-up la intrarea în aplicație.

type Lang = 'ro' | 'en' | 'fr';
type Texts = Record<Lang, string>;
type Theme = 'christmas' | 'easter' | 'valentine' | 'fathers' | 'custom';
type Target = 'gift_card' | 'book' | 'custom_sub' | 'shop';
type Season = {
  enabled: boolean;
  theme: Theme;
  startsAt: string;
  endsAt: string;
  target: Target;
  popup: boolean;
  kicker: Texts;
  title: Texts;
  text: Texts;
  cta: Texts;
  wish: Texts;
  imageUrl: string | null;
  amount: number | null;
  packageName: string;
  packageItems: string;
  packagePrice: number | null;
  version: number;
};
type Preset = Pick<Season, 'target' | 'kicker' | 'title' | 'text' | 'cta' | 'wish' | 'imageUrl' | 'amount'> & Partial<Pick<Season, 'packageName' | 'packageItems' | 'packagePrice'>> & { label: string; dates: () => [string, string] };

const t3 = (ro: string, en: string, fr: string): Texts => ({ ro, en, fr });
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
/** Prima zi `md` (luna-zi) care n-a trecut încă: anul acesta sau la anul. */
const upcoming = (md: string) => {
  const y = new Date().getFullYear();
  return `${y}-${md}` >= today() ? y : y + 1;
};
const minusDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - n);
  return ymd(d);
};
const later = (a: string, b: string) => (a > b ? a : b);
/** Paștele ortodox (calculul Meeus, mutat în calendarul gregorian). */
const orthodoxEaster = (y: number) => {
  const a = y % 4;
  const b = y % 7;
  const c = y % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const dt = new Date(y, month - 1, day + 13);
  return ymd(dt);
};
const nextEaster = () => {
  const y = new Date().getFullYear();
  return orthodoxEaster(y) >= today() ? orthodoxEaster(y) : orthodoxEaster(y + 1);
};
/** Ziua Tatălui în România: a doua duminică din mai. */
const fathersDay = (y: number) => {
  const d = new Date(y, 4, 1);
  d.setDate(1 + ((7 - d.getDay()) % 7) + 7);
  return ymd(d);
};
const nextFathers = () => {
  const y = new Date().getFullYear();
  return fathersDay(y) >= today() ? fathersDay(y) : fathersDay(y + 1);
};

const PRESETS: Record<Theme, Preset> = {
  christmas: {
    label: '🎄 Crăciun',
    target: 'gift_card',
    kicker: t3('VOUCHER CADOU · CRĂCIUN', 'GIFT VOUCHER · CHRISTMAS', 'BON CADEAU · NOËL'),
    title: t3('De Crăciun, oferă-i un moment TAF unui prieten.', 'This Christmas, give a friend a TAF moment.', 'À Noël, offrez un moment TAF à un ami.'),
    text: t3(
      'Dăruiește Experiența TAF, însoțită de urarea ta. Ajunge pe loc prin SMS și în aplicație.',
      'Give the TAF Experience, with your wishes. Delivered instantly by SMS and in the app.',
      'Offrez l’Expérience TAF, avec vos vœux. Envoyée par SMS et dans l’application.',
    ),
    cta: t3('Oferă Experiența TAF', 'Give the TAF Experience', 'Offrir l’Expérience TAF'),
    wish: t3('Crăciun fericit! 🎄', 'Merry Christmas! 🎄', 'Joyeux Noël ! 🎄'),
    imageUrl: '/campanii/craciun.jpg',
    amount: 180,
    packageName: 'Experiența TAF',
    packageItems: 'Tuns, Aranjarea bărbii, 2 spălări, Prosop cald, Masaj capilar',
    packagePrice: 149.99,
    dates: () => {
      const y = upcoming('12-24');
      return [later(today(), `${y}-11-15`), `${y}-12-24`];
    },
  },
  easter: {
    label: '🐣 Paște',
    target: 'gift_card',
    kicker: t3('CADOU DE PAȘTE', 'EASTER GIFT', 'CADEAU DE PÂQUES'),
    title: t3('De Paște, fă cadou o tunsoare', 'Give a haircut for Easter', 'Offrez une coupe pour Pâques'),
    text: t3(
      'Card cadou TAF Barbers pentru tata, fratele sau prietenul tău. Ajunge pe loc prin SMS și în aplicație.',
      'A TAF Barbers gift card for your dad, brother or friend. Delivered instantly by SMS and in the app.',
      'Une carte cadeau TAF Barbers pour votre père, frère ou ami. Envoyée tout de suite par SMS et dans l’application.',
    ),
    cta: t3('Alege cardul cadou', 'Choose a gift card', 'Choisir une carte cadeau'),
    wish: t3('Paște fericit! 🐣', 'Happy Easter! 🐣', 'Joyeuses Pâques ! 🐣'),
    imageUrl: '/campanii/paste.jpg',
    amount: null,
    dates: () => {
      const e = nextEaster();
      return [later(today(), minusDays(e, 21)), minusDays(e, 1)];
    },
  },
  valentine: {
    label: '❤️ Valentine’s Day',
    target: 'gift_card',
    kicker: t3('CADOU DE VALENTINE’S', 'VALENTINE’S GIFT', 'CADEAU DE SAINT-VALENTIN'),
    title: t3('Cadoul perfect pentru el', 'The perfect gift for him', 'Le cadeau parfait pour lui'),
    text: t3(
      'Un card cadou TAF Barbers: tunsoare, barbă sau pachet complet. Ajunge pe loc prin SMS.',
      'A TAF Barbers gift card: haircut, beard or the full package. Delivered instantly by SMS.',
      'Une carte cadeau TAF Barbers : coupe, barbe ou formule complète. Envoyée tout de suite par SMS.',
    ),
    cta: t3('Alege cardul cadou', 'Choose a gift card', 'Choisir une carte cadeau'),
    wish: t3('Te iubesc! ❤️', 'Love you! ❤️', 'Je t’aime ! ❤️'),
    imageUrl: '/campanii/valentine.jpg',
    amount: null,
    dates: () => {
      const y = upcoming('02-14');
      return [later(today(), `${y}-01-25`), `${y}-02-14`];
    },
  },
  fathers: {
    label: '👔 Ziua Tatălui',
    target: 'gift_card',
    kicker: t3('ZIUA TATĂLUI', 'FATHER’S DAY', 'FÊTE DES PÈRES'),
    title: t3('Fă-i cadou tatălui tău o tunsoare', 'Treat your dad to a haircut', 'Offrez une coupe à votre père'),
    text: t3(
      'Card cadou TAF Barbers, cu urarea ta. Ajunge pe loc prin SMS și în aplicație.',
      'A TAF Barbers gift card with your wishes. Delivered instantly by SMS and in the app.',
      'Une carte cadeau TAF Barbers avec vos vœux. Envoyée tout de suite par SMS et dans l’application.',
    ),
    cta: t3('Alege cardul cadou', 'Choose a gift card', 'Choisir une carte cadeau'),
    wish: t3('La mulți ani, tată!', 'Happy Father’s Day, Dad!', 'Bonne fête, papa !'),
    imageUrl: '/campanii/tata.jpg',
    amount: null,
    dates: () => {
      const f = nextFathers();
      return [later(today(), minusDays(f, 14)), f];
    },
  },
  custom: {
    label: '✏️ Personalizată',
    target: 'book',
    kicker: t3('OFERTĂ', 'OFFER', 'OFFRE'),
    title: t3('Titlul campaniei', 'Campaign title', 'Titre de la campagne'),
    text: t3('', '', ''),
    cta: t3('Programează-te', 'Book now', 'Réserver'),
    wish: t3('', '', ''),
    imageUrl: '/campanii/general.jpg',
    amount: null,
    dates: () => [today(), ''],
  },
};
const TARGETS: Record<Target, string> = {
  gift_card: 'Cardul cadou (cumpără un card)',
  book: 'Programare',
  custom_sub: 'Abonamentul personalizat',
  shop: 'Magazinul',
};
const fmt = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export function SeasonCampaignPage({ me }: { me: Me }) {
  const cur = useLoad(() => api<Season>('GET', '/admin/season-campaign'));
  const [v, setV] = useState<Season | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (cur.data) setV(cur.data);
  }, [cur.data]);
  if (!v) return <Loading error={cur.error} />;
  const owner = me.owner;
  const set = (p: Partial<Season>) => {
    setSaved(false);
    setV({ ...v, ...p });
  };
  const setRo = (k: 'kicker' | 'title' | 'text' | 'cta' | 'wish', ro: string) => set({ [k]: { ...v[k], ro } } as Partial<Season>);
  const pickTheme = (theme: Theme) => {
    const p = PRESETS[theme];
    const [startsAt, endsAt] = p.dates();
    set({ theme, target: p.target, kicker: p.kicker, title: p.title, text: p.text, cta: p.cta, wish: p.wish, imageUrl: p.imageUrl, amount: p.amount, packageName: p.packageName ?? v.packageName, packageItems: p.packageItems ?? v.packageItems, packagePrice: p.packagePrice ?? null, startsAt, endsAt });
  };
  const save = () =>
    run(async () => {
      const r = await api<Season>('PUT', '/admin/season-campaign', v);
      setV(r);
      setSaved(true);
    });

  const day = today();
  const status = !v.enabled
    ? { text: 'Oprită: clienții nu o văd.', color: 'var(--muted)' }
    : v.startsAt && day < v.startsAt
      ? { text: `Programată: pornește singură pe ${fmt(v.startsAt)}.`, color: 'var(--gold)' }
      : v.endsAt && day > v.endsAt
        ? { text: `Încheiată pe ${fmt(v.endsAt)}. Alege alte zile ca să o reiei.`, color: 'var(--muted)' }
        : { text: `Activă acum${v.endsAt ? `, până pe ${fmt(v.endsAt)} inclusiv` : ''}.`, color: 'var(--success, #3fb950)' };

  return (
    <>
      <div className="head">
        <h1>Campanie de sezon</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Crăciun, Paște, Valentine’s, Ziua Tatălui sau o campanie a ta. Cât ține perioada, apare primul banner pe Acasă în aplicație și pe site, iar la
        intrarea în aplicație clientul o vede ca pop-up (o singură dată pe campanie). Pornește și se oprește singură. Scrii doar în română; engleza și
        franceza se traduc singure la salvare. Notificarea sau e-mailul către clienți le trimiți tu din <a href="#/campaigns">Campanii</a>.
      </p>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card grid" style={{ flex: '1 1 420px', maxWidth: 620 }}>
          <div className="head" style={{ margin: 0 }}>
            <label className="check">
              <input type="checkbox" disabled={!owner} checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Campanie pornită
            </label>
            <span className="small" style={{ color: status.color, fontWeight: 600 }}>
              {status.text}
            </span>
          </div>
          <Field label="Tema (completează textele, poza și zilele; le poți schimba după)">
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {(Object.keys(PRESETS) as Theme[]).map((k) => (
                <button key={k} type="button" disabled={!owner} className={v.theme === k ? '' : 'ghost'} onClick={() => pickTheme(k)}>
                  {PRESETS[k].label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid two">
            <Field label="De la (inclusiv)">
              <input type="date" disabled={!owner} value={v.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
            </Field>
            <Field label="Până la (inclusiv; gol = fără sfârșit)">
              <input type="date" disabled={!owner} value={v.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
            </Field>
          </div>
          <Field label="Butonul deschide">
            <select disabled={!owner} value={v.target} onChange={(e) => set({ target: e.target.value as Target })}>
              {(Object.keys(TARGETS) as Target[]).map((k) => (
                <option key={k} value={k}>
                  {TARGETS[k]}
                </option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" disabled={!owner} checked={v.popup} onChange={(e) => set({ popup: e.target.checked })} /> Arată și ca pop-up la intrarea în aplicație
            (o dată pe campanie)
          </label>
          <Field label="Eticheta mică de sus (ex. CADOU DE CRĂCIUN)">
            <input disabled={!owner} value={v.kicker.ro} maxLength={40} onChange={(e) => setRo('kicker', e.target.value)} />
          </Field>
          <Field label="Titlu">
            <input disabled={!owner} value={v.title.ro} maxLength={80} onChange={(e) => setRo('title', e.target.value)} />
          </Field>
          <Field label="Text">
            <textarea disabled={!owner} value={v.text.ro} maxLength={200} onChange={(e) => setRo('text', e.target.value)} />
          </Field>
          <Field label="Textul butonului">
            <input disabled={!owner} value={v.cta.ro} maxLength={40} onChange={(e) => setRo('cta', e.target.value)} />
          </Field>
          {v.target === 'gift_card' ? (
            <div className="card" style={{ background: 'transparent', display: 'grid', gap: 8 }}>
              <b>Pachet cu preț de ofertă (opțional)</b>
              <p className="muted small" style={{ margin: 0 }}>
                Cu prețul de ofertă completat, pagina de cadou (site și aplicație) vinde doar acest pachet: valoarea de mai jos apare tăiată, iar
                clientul plătește prețul de ofertă (cu un cod de reducere, și mai puțin). Voucherul valorează tot pachetul la salon. Gol = clientul alege suma.
              </p>
              <Field label="Numele pachetului">
                <input disabled={!owner} value={v.packageName} maxLength={60} onChange={(e) => set({ packageName: e.target.value })} placeholder="Experiența TAF" />
              </Field>
              <Field label="Ce conține (despărțite prin virgulă)">
                <input disabled={!owner} value={v.packageItems} maxLength={200} onChange={(e) => set({ packageItems: e.target.value })} placeholder="Tuns, Aranjarea bărbii, 2 spălări, Prosop cald, Masaj capilar" />
              </Field>
              <Field label="Preț de ofertă (lei, ex. 149,99; gol = fără ofertă)">
                <input
                  inputMode="decimal"
                  disabled={!owner}
                  defaultValue={v.packagePrice != null ? String(v.packagePrice).replace('.', ',') : ''}
                  key={`pp-${v.packagePrice ?? ''}`}
                  onBlur={(e) => {
                    const t = e.target.value.trim().replace(',', '.');
                    set({ packagePrice: t ? Number(t) : null });
                  }}
                  style={{ maxWidth: 140 }}
                />
              </Field>
            </div>
          ) : null}
          {v.target === 'gift_card' ? (
            <Field label={v.packagePrice ? 'Valoarea pachetului (lei, prețul normal la salon, apare tăiat)' : 'Suma aleasă din oficiu (lei; gol = clientul alege)'}>
              <input
                type="number"
                min={10}
                max={5000}
                disabled={!owner}
                value={v.amount ?? ''}
                onChange={(e) => set({ amount: e.target.value ? Number(e.target.value) : null })}
                style={{ maxWidth: 140 }}
              />
            </Field>
          ) : null}
          {v.target === 'gift_card' ? (
            <Field label="Urarea scrisă din oficiu pe card (clientul o poate schimba)">
              <input disabled={!owner} value={v.wish.ro} maxLength={200} onChange={(e) => setRo('wish', e.target.value)} />
            </Field>
          ) : null}
          <Field label="Poza (lată, cam 2:1; fiecare temă are una gata făcută)">
            <ImagePicker value={v.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
          </Field>
          {v.target === 'gift_card' ? <BuyLink /> : null}
          {v.target === 'gift_card' ? (
            <div className="muted small">
              Sumele cardurilor și textul SMS-ului către cel care îl primește se schimbă din <a href="#/notifications/card-cadou">Automatizări → Card cadou</a>.
            </div>
          ) : null}
          {error ? <div className="error">{error}</div> : null}
          {owner ? (
            <div className="row" style={{ gap: 12 }}>
              <button onClick={save} disabled={busy}>
                {busy ? 'Se salvează…' : 'Salvează'}
              </button>
              {saved ? <span className="small" style={{ color: 'var(--success, #3fb950)' }}>Salvat. Clienții o văd la următoarea deschidere a aplicației.</span> : null}
            </div>
          ) : null}
        </div>
        <Preview v={v} />
      </div>
    </>
  );
}

function Preview({ v }: { v: Season }) {
  return (
    <div className="card" style={{ flex: '1 1 300px', maxWidth: 380 }}>
      <h2 style={{ marginTop: 0 }}>Cum arată pop-up-ul</h2>
      <div style={{ background: '#000', border: '1.5px solid var(--gold)', borderRadius: 20, overflow: 'hidden' }}>
        {v.imageUrl ? <img src={v.imageUrl} alt="" style={{ width: '100%', aspectRatio: '1.6', objectFit: 'cover', display: 'block' }} /> : null}
        <div style={{ padding: 18, display: 'grid', gap: 6 }}>
          {v.kicker.ro ? <div style={{ color: 'var(--gold)', fontWeight: 800, letterSpacing: 1.5, fontSize: 12 }}>{v.kicker.ro}</div> : null}
          <div style={{ color: '#fff', fontSize: 21, fontWeight: 800 }}>{v.title.ro}</div>
          {v.text.ro ? <div style={{ color: '#a9a9b2', fontSize: 14 }}>{v.text.ro}</div> : null}
          <div style={{ background: 'var(--gold)', color: '#000', borderRadius: 12, padding: '12px 0', textAlign: 'center', fontWeight: 700, marginTop: 6 }}>{v.cta.ro}</div>
          <div style={{ color: '#a9a9b2', textAlign: 'center', fontSize: 13, fontWeight: 600 }}>Mai târziu</div>
        </div>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Același conținut apare ca primul banner la „Recomandarea TAF” pe Acasă și pe site{v.target === 'gift_card' ? ', iar sus pe ecranul cardului cadou' : ''}.
      </p>
    </div>
  );
}

/** Linkul de cumpărare directă (fără aplicație): pentru Instagram, Facebook, SMS sau un cod QR la salon. */
function BuyLink() {
  const url = `${location.protocol}//${location.host.replace(/^panou\./, 'app.')}/cadou`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="card" style={{ background: 'var(--bg)', margin: 0 }}>
      <b>Link de cumpărare directă, fără aplicație</b>
      <div className="muted small" style={{ margin: '4px 0 8px' }}>
        Cine îl deschide vede pachetul, plătește cu cardul și primește pe loc voucherul de printat. Pune-l în bio pe Instagram, în story, pe Facebook, într-un SMS
        sau fă-i un cod QR din <a href="#/qr">Coduri QR</a>.
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input readOnly value={url} style={{ flex: '1 1 220px' }} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? 'Copiat' : 'Copiază linkul'}
        </button>
        <a className="btn ghost" href={url} target="_blank" rel="noreferrer">
          Deschide
        </a>
      </div>
    </div>
  );
}
