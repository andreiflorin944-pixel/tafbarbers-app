import { useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, type Me } from './api';
import { Field, useAction } from './ui';
import { CalendarPage } from './pages/Calendar';
import { ClientsPage } from './pages/Clients';
import { ServicesPage } from './pages/Services';
import { BarbersPage } from './pages/Barbers';
import { TimeOffPage } from './pages/TimeOff';
import { PromosPage } from './pages/Promos';
import { CampaignsPage } from './pages/Campaigns';
import { SettingsPage } from './pages/Settings';
import { LegalPage } from './pages/Legal';
import { AppearancePage } from './pages/Appearance';
import { ShopPage } from './pages/Shop';
import { ReferralsPage } from './pages/Referrals';
import { SubscriptionsPage } from './pages/Subscriptions';
import { BirthdaysPage } from './pages/Birthdays';
import { DashboardPage } from './pages/Dashboard';
import { ReportsPage } from './pages/Reports';
import { NotificationsPage } from './pages/Notifications';
import { GiftCardsPage } from './pages/GiftCards';
import { StockPage } from './pages/Stock';
import { NotesPage } from './pages/Notes';
import { SocialPage } from './pages/Social';
import { QrCodesPage } from './pages/QrCodes';
import { TemplatesPage } from './pages/Templates';
import { WaitlistPage } from './pages/Waitlist';
import { RequestsBell } from './Requests';

const PAGES = [
  { key: 'calendar', label: 'Calendar', show: () => true, el: CalendarPage },
  { key: 'dashboard', label: 'Tablou de bord', show: (m: Me) => m.permissions.reports, el: DashboardPage },
  { key: 'reports', label: 'Rapoarte', show: (m: Me) => m.permissions.reports, el: ReportsPage },
  { key: 'waitlist', label: 'Listă de așteptare', show: () => true, el: WaitlistPage },
  { key: 'notes', label: 'Notițe echipă', show: () => true, el: NotesPage },
  { key: 'clients', label: 'Clienți', show: (m: Me) => m.permissions.clients, el: ClientsPage },
  { key: 'services', label: 'Servicii', show: (m: Me) => m.owner, el: ServicesPage },
  { key: 'barbers', label: 'Frizeri și program', show: (m: Me) => m.owner, el: BarbersPage },
  { key: 'shop', label: 'Magazin', show: (m: Me) => m.owner || m.permissions.shop, el: ShopPage },
  { key: 'stock', label: 'Stoc și NIR', show: (m: Me) => m.owner || m.permissions.shop, el: StockPage },
  { key: 'subscriptions', label: 'Abonamente', show: (m: Me) => m.owner, el: SubscriptionsPage },
  { key: 'giftcards', label: 'Carduri cadou', show: (m: Me) => m.permissions.bookings_manage, el: GiftCardsPage },
  { key: 'birthdays', label: 'Zile de naștere', show: (m: Me) => m.owner, el: BirthdaysPage },
  { key: 'referrals', label: 'Recomandări și bonusuri', show: (m: Me) => m.owner, el: ReferralsPage },
  { key: 'timeoff', label: 'Pauze și concedii', show: (m: Me) => m.permissions.timeoff, el: TimeOffPage },
  { key: 'appearance', label: 'Aspect aplicație', show: (m: Me) => m.owner, el: AppearancePage },
  { key: 'promos', label: 'Bannere aplicație', show: (m: Me) => m.owner, el: PromosPage },
  { key: 'campaigns', label: 'Campanii', show: (m: Me) => m.owner, el: CampaignsPage },
  { key: 'social', label: 'Postări pe rețele', show: (m: Me) => m.owner, el: SocialPage },
  { key: 'qr', label: 'Coduri QR', show: (m: Me) => m.owner, el: QrCodesPage },
  { key: 'legal', label: 'Regulamente și GDPR', show: (m: Me) => m.owner, el: LegalPage },
  { key: 'notifications', label: 'Notificări', show: (m: Me) => m.owner, el: NotificationsPage },
  { key: 'templates', label: 'Șabloane de mesaje', show: (m: Me) => m.owner, el: TemplatesPage },
  { key: 'settings', label: 'Setări', show: () => true, el: SettingsPage },
];

const pageFromHash = () => location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0] || 'calendar';
const hashNow = () => location.hash.replace(/^#\/?/, '').split('?')[0];

type NavItem = { label: string; to: string };
type NavGroup = { title?: string; items: NavItem[] };
type NavSection = { key: string; label: string; icon: string; groups: NavGroup[] };

// Iconițe simple (contur, 24×24), ca să nu depindem de o bibliotecă.
const ICONS: Record<string, string> = {
  business: 'M3 7h18v13H3zM8 7V4h8v3M3 12h18',
  work: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  pay: 'M3 6h18v12H3zM3 10h18M7 15h4',
  clients: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M17 11a3 3 0 1 0 0-6M22 21v-1a5 5 0 0 0-4-4.9',
  marketing: 'M3 11v2a1 1 0 0 0 1 1h3l6 5V5L7 10H4a1 1 0 0 0-1 1zM17 8a5 5 0 0 1 0 8',
  notify: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  shop: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.2 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};
function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

// Meniul compact, grupat ca în Barberly: o iconiță pe domeniu, iar la click se deschide lista cu subramuri.
const NAV: NavSection[] = [
  {
    key: 'business',
    label: 'Afaceri',
    icon: 'business',
    groups: [
      { items: [{ label: 'Tablou de bord', to: 'dashboard' }] },
      { title: 'Echipa', items: [{ label: 'Frizeri, culori și program', to: 'barbers' }, { label: 'Pauze, ore speciale și concedii', to: 'timeoff' }, { label: 'Utilizatori și drepturi', to: 'settings/echipa' }] },
      { title: 'Ce oferim', items: [{ label: 'Servicii și prețuri', to: 'services' }, { label: 'Abonamente', to: 'subscriptions' }] },
      { title: 'Salonul', items: [{ label: 'Datele salonului', to: 'settings/salon' }, { label: 'Datele firmei', to: 'settings/firma' }, { label: 'Reguli de programare', to: 'settings/reguli' }] },
    ],
  },
  {
    key: 'work',
    label: 'Muncă',
    icon: 'work',
    groups: [
      { items: [{ label: 'Calendar', to: 'calendar' }, { label: 'Notițe echipă', to: 'notes' }] },
      { title: 'Programări', items: [{ label: 'Lista programărilor', to: 'reports/bookings' }, { label: 'Rezervări viitoare', to: 'reports/upcoming' }, { label: 'Listă de așteptare', to: 'waitlist' }, { label: 'Raportul zilei', to: 'reports/day' }] },
      { title: 'Program', items: [{ label: 'Pauze, ore speciale și concedii', to: 'timeoff' }, { label: 'Ore de lucru', to: 'barbers' }] },
    ],
  },
  {
    key: 'pay',
    label: 'Plăți',
    icon: 'pay',
    groups: [
      { title: 'Încasări', items: [{ label: 'Registrul de încasări', to: 'reports/register' }, { label: 'Toate plățile', to: 'reports/payments' }, { label: 'Plăți pe frizer', to: 'reports/payments-member' }, { label: 'Bacșișuri', to: 'reports/tips-member' }] },
      { title: 'Vânzări', items: [{ label: 'Carduri cadou', to: 'giftcards' }, { label: 'Abonamente vândute', to: 'subscriptions' }, { label: 'Comenzi magazin', to: 'shop' }] },
    ],
  },
  {
    key: 'clients',
    label: 'Clienți',
    icon: 'clients',
    groups: [
      { items: [{ label: 'Lista clienților (import / export)', to: 'clients' }, { label: 'Zile de naștere', to: 'birthdays' }, { label: 'Recomandări și bonusuri', to: 'referrals' }] },
      { title: 'Analize', items: [{ label: 'Clienți TOP-100', to: 'reports/top100' }, { label: 'Păstrarea clienților', to: 'reports/retention' }, { label: 'Clienți noi vs. care revin', to: 'reports/new-returning' }] },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    icon: 'marketing',
    groups: [
      { items: [{ label: 'Postări Facebook, Instagram, TikTok', to: 'social' }, { label: 'Campanii (SMS, e-mail, push)', to: 'campaigns' }, { label: 'Bannere în aplicație', to: 'promos' }, { label: 'Coduri QR pentru campanii', to: 'qr' }] },
      { title: 'Automatizări', items: [{ label: 'Ne e dor de tine', to: 'notifications/dor' }, { label: 'Ore libere azi', to: 'notifications/ore-libere' }, { label: 'Card cadou', to: 'notifications/card-cadou' }, { label: 'Zile de naștere', to: 'birthdays' }] },
      { title: 'Fidelizare', items: [{ label: 'Recomandări și bonusuri', to: 'referrals' }, { label: 'Abonamente', to: 'subscriptions' }] },
    ],
  },
  {
    key: 'notify',
    label: 'Notificări',
    icon: 'notify',
    groups: [{ items: [{ label: 'Ce se trimite și pe unde', to: 'notifications/canale' }, { label: 'Șabloane de mesaje', to: 'templates' }, { label: 'Mesaje trimise', to: 'settings/mesaje' }] }],
  },
  {
    key: 'apps',
    label: 'Aplicații',
    icon: 'apps',
    groups: [
      { items: [{ label: 'Aspectul aplicației', to: 'appearance' }, { label: 'Bannere în aplicație', to: 'promos' }] },
      { title: 'Linkuri', items: [{ label: 'Butonul „Programează” și recenzii', to: 'notifications/linkuri' }] },
      { title: 'Legal', items: [{ label: 'Regulamente și GDPR', to: 'legal' }] },
    ],
  },
  {
    key: 'shop',
    label: 'Magazin',
    icon: 'shop',
    groups: [
      { items: [{ label: 'Produse și comenzi', to: 'shop' }] },
      { title: 'Stoc', items: [{ label: 'NIR (intrări de marfă)', to: 'stock/nir' }, { label: 'Ieșire din stoc', to: 'stock/iesire' }, { label: 'Situația stocului', to: 'stock/situatie' }, { label: 'Fișa de magazie', to: 'stock/fisa' }] },
    ],
  },
  {
    key: 'reports',
    label: 'Rapoarte',
    icon: 'reports',
    groups: [
      { title: 'Vânzări', items: [{ label: 'Raportul zilei', to: 'reports/day' }, { label: 'Vânzări pe frizer', to: 'reports/sales-barber' }, { label: 'Vânzări pe servicii', to: 'reports/sales-service' }] },
      { title: 'Programări', items: [{ label: 'Rezervări pe frizer', to: 'reports/bookings-barber' }, { label: 'Anulări din partea echipei', to: 'reports/cancel-staff' }, { label: 'Anulări de către client', to: 'reports/cancel-client' }] },
      { items: [{ label: 'Toate rapoartele', to: 'reports' }] },
    ],
  },
  {
    key: 'settings',
    label: 'Setări',
    icon: 'settings',
    groups: [
      { items: [{ label: 'Datele salonului', to: 'settings/salon' }, { label: 'Datele firmei', to: 'settings/firma' }, { label: 'Reguli de programare', to: 'settings/reguli' }, { label: 'Utilizatori și drepturi', to: 'settings/echipa' }] },
      { title: 'Contul meu', items: [{ label: 'Schimbă parola', to: 'settings/parola' }, { label: 'Deconectare de pe alte dispozitive', to: 'settings/sesiuni' }] },
      { items: [{ label: 'Regulamente și GDPR', to: 'legal' }, { label: 'Mesaje trimise', to: 'settings/mesaje' }] },
    ],
  },
];

const THEME_KEY = 'taf-admin-theme';
function readTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [page, setPage] = useState(pageFromHash());
  const [hash, setHash] = useState(hashNow());
  const [flyout, setFlyout] = useState<string | null>(null);
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setMe(null);
    });
    const onHash = () => {
      setPage(pageFromHash());
      setHash(hashNow());
      setFlyout(null);
    };
    window.addEventListener('hashchange', onHash);
    if (getToken()) {
      api<Me>('GET', '/admin/me')
        .then(setMe, () => setToken(null))
        .finally(() => setChecked(true));
    } else setChecked(true);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // fără stocare: tema rămâne doar pentru sesiunea asta
    }
  }, [theme]);

  useEffect(() => {
    if (!flyout) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setFlyout(null);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [flyout]);

  if (!checked) return null;
  if (!me) return <Login onIn={setMe} />;

  const visible = PAGES.filter((p) => p.show(me));
  const current = visible.find((p) => p.key === page) ?? visible[0];
  const Page = current.el;
  const allowed = new Set(visible.map((p) => p.key));
  const sections = NAV.map((s) => ({
    ...s,
    groups: s.groups.map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(i.to.split('/')[0])) })).filter((g) => g.items.length),
  })).filter((s) => s.groups.length);
  // Secțiunea activă: cea care are exact adresa curentă, altfel prima care are pagina.
  const activeSection =
    sections.find((s) => s.groups.some((g) => g.items.some((i) => i.to === hash))) ??
    sections.find((s) => s.groups.some((g) => g.items.some((i) => i.to.split('/')[0] === current.key)));
  const open = sections.find((s) => s.key === flyout);
  const logout = async () => {
    await api('POST', '/admin/logout').catch(() => undefined);
    setToken(null);
    setMe(null);
  };

  return (
    <div className="shell">
      <aside className="rail" aria-label="Meniu">
        <a className="rail-brand" href="#/calendar" title="TAF Barber’s">
          T<i>B</i>
        </a>
        <nav className="rail-nav">
          {sections.map((s) => (
            <button
              key={s.key}
              className={`rail-btn${activeSection?.key === s.key ? ' on' : ''}${flyout === s.key ? ' open' : ''}`}
              onClick={() => setFlyout(flyout === s.key ? null : s.key)}
              aria-expanded={flyout === s.key}
              title={s.label}
            >
              <Icon name={s.icon} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <button className="rail-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? 'Temă închisă' : 'Temă deschisă'}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
            <span>{theme === 'light' ? 'Închis' : 'Deschis'}</span>
          </button>
          <button className="rail-btn" onClick={logout} title={`Ieși din cont (${me.name || me.email})`}>
            <Icon name="logout" />
            <span>Ieși</span>
          </button>
        </div>
      </aside>
      {open ? (
        <>
          <div className="flyout-back" onClick={() => setFlyout(null)} />
          <div className="flyout" role="menu" aria-label={open.label}>
            <div className="flyout-title">{open.label}</div>
            {open.groups.map((g, i) => (
              <div key={i} className="flyout-group">
                {g.title ? <div className="flyout-sub">{g.title}</div> : null}
                {g.items.map((it) => (
                  <a key={it.to + it.label} href={`#/${it.to}`} className={it.to === hash ? 'on' : ''} onClick={() => setFlyout(null)} role="menuitem">
                    {it.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}
      <main className="main">
        <div className="topbar">
          <span className="muted small crumb">
            {activeSection ? `${activeSection.label} · ` : ''}
            {current.label}
          </span>
          <span className="row" style={{ gap: 12, marginLeft: 'auto' }}>
            <RequestsBell me={me} />
            <span className="muted small crumb">{me.name || me.email}</span>
          </span>
        </div>
        <Page me={me} />
      </main>
    </div>
  );
}

function Login({ onIn }: { onIn: (m: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const { busy, error, run } = useAction();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r =
        mode === 'login'
          ? await api<{ token: string }>('POST', '/admin/login', { email, password })
          : await api<{ token: string }>('POST', '/admin/setup', { email, password, name, setupKey });
      setToken(r.token);
      onIn(await api<Me>('GET', '/admin/me'));
    });
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          TAF <i>Barber’s</i> <span className="muted small">admin</span>
        </div>
        {mode === 'setup' ? (
          <p className="muted small" style={{ margin: 0 }}>
            Prima configurare: creezi contul de proprietar. Cheia de configurare e cea pusă în Cloudflare (ADMIN_SETUP_KEY).
          </p>
        ) : null}
        {mode === 'setup' ? (
          <Field label="Numele tău">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        ) : null}
        <Field label="E-mail">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label={mode === 'setup' ? 'Parolă nouă (minim 10 caractere)' : 'Parolă'}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
            required
          />
        </Field>
        {mode === 'setup' ? (
          <Field label="Cheia de configurare">
            <input type="password" value={setupKey} onChange={(e) => setSetupKey(e.target.value)} required />
          </Field>
        ) : null}
        {error ? <div className="err">{error}</div> : null}
        <button disabled={busy}>{mode === 'login' ? 'Intră' : 'Creează contul'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'setup' : 'login')}>
          {mode === 'login' ? 'Prima dată aici? Configurează contul' : 'Am deja cont'}
        </button>
      </form>
    </div>
  );
}
