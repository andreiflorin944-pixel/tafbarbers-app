import type { Bonus, Identity, IdentityPhoto, Plan, Subscription } from '@/data/types';
import Constants from 'expo-constants';
import { tr, type Key } from '@/i18n';
import { ApiError } from './client';
import { withLang } from './http';

// Partea de echipă a aplicației (proprietar și frizeri) vorbește cu /v1/admin, cu contul din panou.
/** Pozele urcate din panou au adrese relative la server (/v1/media/...). */
export const mediaUrl = (u: string | null | undefined): string | null => (!u ? null : u.startsWith('/') ? `${apiUrl}${u}` : u);

// În dezvoltare (Expo Go pe telefon), fără adresă setată, folosim serverul local de pe același laptop ca Expo,
// pe portul 8787. Așa aplicația merge și când laptopul primește altă adresă în Wi-Fi.
const devHost = __DEV__ ? (Constants.expoConfig?.hostUri ?? '').split(':')[0] : '';
export const apiUrl: string = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  (devHost ? `http://${devHost}:8787` : '')
).replace(/\/+$/, '');

export type Perm = 'bookings_all' | 'bookings_create' | 'bookings_manage' | 'clients' | 'contacts' | 'timeoff' | 'stats' | 'reports' | 'shop';
export type StaffRole = 'org_admin' | 'location_admin' | 'barber';
export const ROLE_LABELS: Record<StaffRole, Key> = { org_admin: 'role.orgAdmin', location_admin: 'role.locationAdmin', barber: 'role.barber' };
export type StaffMe = { id: string; email: string; name: string; barberId: string | null; role?: StaffRole; owner: boolean; permissions: Record<Perm, boolean> };
export type StaffBooking = {
  id: string;
  clientId: string;
  barberId: string;
  serviceId: string;
  start: string;
  end: string;
  price: number;
  status: 'requested' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'; // requested = cerere care așteaptă răspuns
  source: string;
  note: string;
  clientName: string;
  clientPhone?: string; // lipsește fără dreptul „contacts”
  serviceName: string;
  barberName: string;
  // Confirmarea frizerului la finalizare: suma plătită sau pe abonament.
  payment?: 'paid' | 'subscription' | null;
  paidAmount?: number | null;
  onlinePaid?: number | null;
  onlineRefunded?: boolean;
  tip?: number | null;
  bonusId?: string | null;
  clientBirthday?: boolean; // programarea cade de ziua clientului
};
export type StaffCheckout = { booking: StaffBooking; subscription: Subscription | null; bonuses: Bonus[] };

async function call<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  if (!apiUrl) throw new ApiError('no_server', 0);
  let res: Response;
  try {
    // Limba aplicației pleacă la fiecare cerere: rapoartele și numele serviciilor vin traduse.
    res = await fetch(`${apiUrl}/v1${withLang(path)}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
  return json as T;
}

/** Sarcină, script de filmat sau notiță dată de admin. barberId null = pentru toată echipa. */
export type StaffNote = {
  id: string;
  kind: 'task' | 'script' | 'note';
  title: string;
  body: string;
  barberId: string | null;
  barberName: string | null;
  dueDay: string | null;
  doneAt: string | null;
  doneByName: string | null;
  authorName: string | null;
  createdAt: string;
};

export const staffApi = {
  login: (email: string, password: string) => call<{ token: string }>('POST', '/admin/login', null, { email, password }),
  logout: (t: string) => call('POST', '/admin/logout', t).catch(() => undefined),
  me: (t: string) => call<StaffMe>('GET', '/admin/me', t),
  logoutOthers: (t: string) => call<{ loggedOut: number }>('POST', '/admin/me/logout-others', t),
  bookings: (t: string, from: string, to: string) => call<StaffBooking[]>('GET', `/admin/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, t),
  setStatus: (t: string, id: string, status: string) => call<StaffBooking>('PATCH', `/admin/bookings/${id}`, t, { status }),
  // Cererile de programare (când programările din aplicație cer aprobare).
  requests: (t: string) => call<{ count: number; items: StaffBooking[] }>('GET', '/admin/bookings/requests', t),
  acceptRequest: (t: string, id: string) => call<StaffBooking>('POST', `/admin/bookings/${encodeURIComponent(id)}/accept`, t),
  refuseRequest: (t: string, id: string, reason: string) => call<StaffBooking>('POST', `/admin/bookings/${encodeURIComponent(id)}/refuse`, t, { reason }),
  create: (t: string, body: { phone: string; name: string; serviceId: string; barberId: string; start: string; notify: boolean }) =>
    call<StaffBooking>('POST', '/admin/bookings', t, body),
  timeOff: (t: string, body: { fromDay: string; toDay: string; reason: string; barberId?: string | null }) => call('POST', '/admin/time-off', t, body),
  listTimeOff: (t: string, from: string) => call<StaffTimeOff[]>('GET', `/admin/time-off?from=${encodeURIComponent(from)}`, t),
  deleteTimeOff: (t: string, id: number) => call('DELETE', `/admin/time-off/${id}`, t),
  // Blocuri în program: pauză de masă, liber, educațional, altceva, doar membri TAF Club.
  listBlocks: (t: string) => call<StaffBlock[]>('GET', '/admin/blocks', t),
  blockOccurrences: (t: string, from: string, to: string) =>
    call<Array<{ blockId: string; barberId: string | null; kind: BlockKind; label: string; customLabel?: string; start: string; end: string }>>('GET', `/admin/blocks/occurrences?from=${from}&to=${to}`, t),
  addBlock: (t: string, body: StaffBlockInput) => call<{ block: StaffBlock; conflicts: number }>('POST', '/admin/blocks', t, body),
  deleteBlock: (t: string, id: string) => call('DELETE', `/admin/blocks/${encodeURIComponent(id)}`, t),
  barbers: (t: string) => call<StaffBarber[]>('GET', '/admin/barbers', t),
  clients: (t: string, q: string) => call<StaffClient[]>('GET', `/admin/clients?q=${encodeURIComponent(q)}`, t),
  client: (t: string, id: string) => call<StaffClient>('GET', `/admin/clients/${encodeURIComponent(id)}`, t),
  saveClient: (t: string, id: string, body: { name?: string; notes?: string }) => call<StaffClient>('PATCH', `/admin/clients/${encodeURIComponent(id)}`, t, body),
  /** Poză despre client, vizibilă doar echipei. `uri` = poza locală deja micșorată. */
  addClientPhoto: async (t: string, id: string, uri: string): Promise<IdentityPhoto> => {
    if (!apiUrl) throw new ApiError('no_server', 0);
    let res: Response;
    try {
      const blob = await (await fetch(uri)).blob();
      res = await fetch(`${apiUrl}/v1/admin/clients/${encodeURIComponent(id)}/photos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${t}` }, body: blob });
    } catch {
      throw new ApiError('network', 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
    return json as IdentityPhoto;
  },
  /** Urcă o poză înainte/după; întoarce id-ul ei, apoi `saveBeforeAfter` leagă perechea de client. */
  uploadBeforeAfter: async (t: string, id: string, uri: string): Promise<{ mediaId: string }> => {
    if (!apiUrl) throw new ApiError('no_server', 0);
    let res: Response;
    try {
      const blob = await (await fetch(uri)).blob();
      res = await fetch(`${apiUrl}/v1/admin/clients/${encodeURIComponent(id)}/before-after/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${t}` },
        body: blob,
      });
    } catch {
      throw new ApiError('network', 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
    return json as { mediaId: string };
  },
  saveBeforeAfter: (t: string, id: string, before: string, after: string) =>
    call<{ id: string }>('POST', `/admin/clients/${encodeURIComponent(id)}/before-after`, t, { before, after }),
  deleteBeforeAfter: (t: string, pid: string) => call<{ ok: true }>('DELETE', `/admin/before-after/${encodeURIComponent(pid)}`, t),
  unclosed: (t: string) => call<StaffBooking[]>('GET', '/admin/bookings/unclosed', t),
  notes: (t: string, status = 'open') => call<StaffNote[]>('GET', `/admin/notes?status=${status}`, t),
  setNoteDone: (t: string, id: string, done: boolean) => call<StaffNote>('PATCH', `/admin/notes/${encodeURIComponent(id)}`, t, { done }),
  checkGiftCard: (t: string, code: string) =>
    call<{ code: string; balance: number; amount: number; status: string; expiresAt: string | null }>('GET', `/admin/gift-cards/check?code=${encodeURIComponent(code)}`, t),
  checkout: (t: string, id: string) => call<StaffCheckout>('GET', `/admin/bookings/${encodeURIComponent(id)}/checkout`, t),
  complete: (
    t: string,
    id: string,
    body: {
      payment: 'paid' | 'subscription';
      amount?: number;
      tip?: number | null;
      bonusId?: string | null;
      giftCode?: string | null;
      giftAmount?: number | null;
      payMethod?: 'cash' | 'card' | 'transfer' | 'online';
    },
  ) =>
    call<StaffBooking>('POST', `/admin/bookings/${encodeURIComponent(id)}/complete`, t, body),
  plans: (t: string) => call<Plan[]>('GET', '/admin/plans', t),
  activateSubscription: (t: string, clientId: string, planId: string) =>
    call<{ id: string }>('POST', `/admin/clients/${encodeURIComponent(clientId)}/subscriptions`, t, { planId }),
  useBonus: (t: string, bonusId: string) => call<{ ok: true }>('PATCH', `/admin/bonuses/${encodeURIComponent(bonusId)}`, t, { status: 'used' }),
  deleteClientPhoto: (t: string, id: string, pid: string) => call<{ ok: true }>('DELETE', `/admin/clients/${encodeURIComponent(id)}/photos/${encodeURIComponent(pid)}`, t),
  stats: (t: string) => call<StaffStats>('GET', '/admin/stats', t),
  dashboard: (t: string) => call<StaffDashboard>('GET', '/admin/dashboard', t),
  reports: (t: string) => call<ReportMeta[]>('GET', '/admin/reports', t),
  report: (t: string, kind: string, from: string, to: string) =>
    call<Report>('GET', `/admin/reports/${encodeURIComponent(kind)}?from=${from}&to=${to}`, t),
  orders: (t: string, status: string) => call<StaffOrder[]>('GET', `/admin/orders?status=${status}`, t),
  setOrderStatus: (t: string, id: string, status: string) => call<StaffOrder>('PATCH', `/admin/orders/${encodeURIComponent(id)}`, t, { status }),
};

/** Adresa unei pagini din panoul web (ex. „settings”). */
export const panelUrl = (page = '') => (apiUrl ? `${apiUrl}/${page ? `#/${page}` : ''}` : '');

export type StaffBarber = {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
  initials: string;
  active: boolean;
  hours: Array<{ weekday: number; start: number; end: number }>; // minute de la miezul nopții
};
export type BlockKind = 'lunch' | 'off' | 'education' | 'other' | 'members';
export const BLOCK_KINDS: Array<{ kind: BlockKind; label: Key; color: string }> = [
  { kind: 'lunch', label: 'block.lunch', color: '#F2A541' },
  { kind: 'off', label: 'block.off', color: '#8B8B94' },
  { kind: 'education', label: 'block.education', color: '#3E7BFA' },
  { kind: 'other', label: 'block.other', color: '#8E4EC6' },
  { kind: 'members', label: 'block.members', color: '#D4AF37' },
];
/** Numele blocului: cel scris de om (`customLabel`) sau numele tipului, în limba aplicației. */
export const blockLabel = (b: { kind: BlockKind; label: string; customLabel?: string }) => {
  if (b.customLabel) return b.customLabel;
  const k = BLOCK_KINDS.find((x) => x.kind === b.kind);
  return k && (b.customLabel !== undefined || b.kind !== 'other') ? tr(k.label) : b.label;
};
export type StaffBlock = {
  id: string;
  barberId: string | null;
  kind: BlockKind;
  label: string;
  customLabel?: string; // numele scris de om (gol = numele tipului)
  repeat: boolean;
  day: string | null;
  weekdays: number[];
  start: string;
  end: string;
  fromDay: string | null;
  untilDay: string | null;
};
export type StaffBlockInput = { barberId?: string | null; kind: BlockKind; label?: string; repeat: boolean; day?: string; weekdays?: number[]; start: string; end: string };
export type StaffTimeOff = { id: number; barberId: string | null; start: string; end: string; reason: string };
export type StaffClient = {
  id: string;
  phone?: string; // lipsește fără dreptul „contacts”
  name: string;
  email: string | null;
  notes: string;
  birthDate?: string | null;
  photoUrl?: string | null;
  identity?: Identity;
  beforeAfter?: Array<{ id: string; before: string; after: string; barberName: string | null; createdAt: string }>;
  bonuses?: Bonus[];
  subscriptions?: Subscription[];
  referredBy?: { id: string; name: string } | null;
  referredCount?: number;
  visits?: number;
  lastVisit?: string | null;
  bookings?: StaffBooking[];
};
export type StaffStats = {
  upcoming: number;
  last30: { bookings: number; revenue: number | null; cancelled: number; noShow: number; newClients: number | null };
};
export type StaffOrder = {
  id: string;
  code: string;
  status: 'new' | 'ready' | 'picked_up' | 'cancelled';
  total: number;
  note: string;
  createdAt: string;
  clientName: string;
  clientPhone?: string; // lipsește fără dreptul „contacts”
  items: Array<{ productId: string; name: string; price: number; qty: number }>;
};

// Tabloul de bord și rapoartele (dreptul „reports”; sumele apar doar cu „stats”).
type WeekStats = { bookings: number; revenue: number | null; clients: number; newClients: number; cancelled: number; noShow: number };
export type StaffDashboard = {
  today: string;
  canSeeMoney: boolean;
  upcoming: number;
  daily: Array<{ day: string; bookings: number; revenue: number | null; newClients: number; returning: number }>;
  monthly: Array<{ month: string; bookings: number; revenue: number | null }>;
  week: { current: WeekStats; previous: WeekStats };
  last30: { clients: number; newClients: number; returning: number };
  retention: { base: number; returned: number; rate: number };
  todayClients: Array<{ bookingId: string; clientId: string; name: string; start: string; status: string; barberName: string; serviceName: string; visits: number; noShows: number; cancellations: number; tags: string[] }>;
  atRisk: Array<{ clientId: string; name: string; visits: number; lastVisit: string; avgGapDays: number; daysSince: number; spent: number | null }>;
  topClients: Array<{ clientId: string; name: string; visits: number; spent: number | null }>;
};
export type ReportMeta = { kind: string; title: string; range: 'day' | 'period' | 'future' | 'months' };
export type ReportCol = { key: string; label: string; type: 'text' | 'int' | 'money' | 'pct' | 'date' | 'datetime' };
export type Report = { kind: string; title: string; from: string; to: string; columns: ReportCol[]; rows: Record<string, string | number | null>[]; totals: Record<string, string | number | null> | null };
