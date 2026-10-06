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

const PAGES = [
  { key: 'calendar', label: 'Programări', show: () => true, el: CalendarPage },
  { key: 'dashboard', label: 'Tablou de bord', show: (m: Me) => m.permissions.reports, el: DashboardPage },
  { key: 'reports', label: 'Rapoarte', show: (m: Me) => m.permissions.reports, el: ReportsPage },
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
  { key: 'timeoff', label: 'Concedii', show: (m: Me) => m.permissions.timeoff, el: TimeOffPage },
  { key: 'appearance', label: 'Aspect aplicație', show: (m: Me) => m.owner, el: AppearancePage },
  { key: 'promos', label: 'Bannere aplicație', show: (m: Me) => m.owner, el: PromosPage },
  { key: 'campaigns', label: 'Campanii', show: (m: Me) => m.owner, el: CampaignsPage },
  { key: 'legal', label: 'Regulamente și GDPR', show: (m: Me) => m.owner, el: LegalPage },
  { key: 'notifications', label: 'Notificări', show: (m: Me) => m.owner, el: NotificationsPage },
  { key: 'settings', label: 'Setări', show: () => true, el: SettingsPage },
];

const pageFromHash = () => location.hash.replace(/^#\/?/, '').split('/')[0] || 'calendar';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [page, setPage] = useState(pageFromHash());

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setMe(null);
    });
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    if (getToken()) {
      api<Me>('GET', '/admin/me')
        .then(setMe, () => setToken(null))
        .finally(() => setChecked(true));
    } else setChecked(true);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!checked) return null;
  if (!me) return <Login onIn={setMe} />;

  const visible = PAGES.filter((p) => p.show(me));
  const current = visible.find((p) => p.key === page) ?? visible[0];
  const Page = current.el;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          TAF <i>Barber’s</i> <span className="muted small">admin</span>
        </div>
        <nav className="nav">
          {visible.map((p) => (
            <a key={p.key} href={`#/${p.key}`} className={p.key === current.key ? 'on' : ''}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="side-foot muted">
          <div>{me.name || me.email}</div>
          <button
            className="link"
            onClick={async () => {
              await api('POST', '/admin/logout').catch(() => undefined);
              setToken(null);
              setMe(null);
            }}
          >
            Ieși din cont
          </button>
        </div>
      </aside>
      <main className="main">
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
