// Client pentru /v1/admin. Token-ul de sesiune stă în localStorage.

const TOKEN_KEY = 'taf.admin.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // fără stocare: sesiunea ține până la reîncărcarea paginii
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith('/admin/login') && !path.startsWith('/admin/setup')) onUnauthorized();
  if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
  return json as T;
}

const MESSAGES: Record<string, string> = {
  network: 'Nu ne putem conecta la server.',
  wrong_credentials: 'E-mail sau parolă greșită.',
  forbidden: 'Cheia de configurare nu e corectă.',
  already_set_up: 'Contul de administrator există deja. Intră cu e-mailul și parola.',
  password_too_short: 'Parola trebuie să aibă cel puțin 10 caractere.',
  invalid_email: 'Adresa de e-mail nu e corectă.',
  email_taken: 'Există deja un cont cu acest e-mail.',
  slot_unavailable: 'Ora nu mai e liberă la frizerul ales.',
  invalid_phone: 'Numărul de telefon nu e corect.',
  owner_only: 'Doar proprietarul poate face asta.',
  name_required: 'Completează numele.',
  invalid_duration: 'Durata trebuie să fie între 5 și 480 de minute.',
  invalid_price: 'Prețul nu e corect.',
  invalid_hours: 'Verifică intervalele de program (sfârșitul după început).',
  invalid_range: 'Verifică datele (sfârșitul după început).',
  not_sendable: 'Campania a fost deja trimisă.',
  title_and_body_required: 'Completează titlul și mesajul.',
  wrong_password: 'Parola actuală nu e corectă.',
  cannot_delete_self: 'Nu îți poți șterge propriul cont.',
  not_cancellable: 'Programarea nu mai poate fi anulată.',
  barber_required: 'Alege frizerul.',
};
export const errorText = (e: unknown) =>
  e instanceof ApiError ? (MESSAGES[e.code] ?? `Eroare: ${e.code}`) : 'A apărut o problemă.';

// --- Tipuri (la fel ca răspunsurile serverului) ---

export type Service = {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  price: number;
  color: string;
  imageUrl: string | null;
  sort: number;
  active: boolean;
};
export type Hours = { weekday: number; start: number; end: number };
export type Barber = {
  id: string;
  name: string;
  role: string;
  bio: string;
  photoUrl: string | null;
  initials: string;
  sort: number;
  active: boolean;
  serviceIds: string[];
  hours: Hours[];
};
export type Booking = {
  id: string;
  clientId: string;
  barberId: string;
  serviceId: string;
  start: string;
  end: string;
  price: number;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  source: string;
  note: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  barberName: string;
};
export type Client = {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  lang: string;
  marketing: { sms: boolean; email: boolean; push: boolean };
  notes: string;
  createdAt: string;
  visits?: number;
  lastVisit?: string | null;
  bookings?: Booking[];
};
export type Promo = {
  id: string;
  kicker: string;
  title: string;
  text: string;
  cta: string;
  icon: string;
  action: { type: 'service'; serviceId: string } | { type: 'url'; url: string } | { type: 'book' };
  translations: Record<string, Partial<Record<'kicker' | 'title' | 'text' | 'cta', string>>>;
  startsAt: string | null;
  endsAt: string | null;
  sort: number;
  active: boolean;
};
export type Business = {
  name: string;
  tagline: string;
  description?: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  facebook?: string;
  tiktok?: string;
  slotStepMin: number;
  cancelHours: number;
  minLeadMin?: number;
  maxDaysAhead?: number;
  cancellationPolicy?: string;
};
export type Me = { id: string; email: string; name: string; barberId: string | null; owner: boolean };
export type TimeOff = { id: number; barberId: string | null; start: string; end: string; reason: string };
export type Campaign = {
  id: string;
  channel: 'push' | 'email' | 'sms';
  title: string;
  body: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  recipients: number;
  created_at: string;
};
export type Slot = { start: string; end: string; barberId: string };
