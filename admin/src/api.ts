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
  range_too_long: 'Perioada e prea lungă. Alege cel mult un an.',
  invalid_tip: 'Bacșișul nu e valid.',
  no_permission: 'Nu ai drept pentru asta. Cere-i proprietarului.',
  cannot_demote_self: 'Nu îți poți lua singur drepturile de proprietar.',
  ro_required: 'Completează titlul și textul în română.',
  not_cancellable: 'Nu mai poate fi anulat.',
  barber_required: 'Alege frizerul.',
  unsupported_image: 'Poza trebuie să fie JPG, PNG sau WebP.',
  image_too_large: 'Poza e prea mare.',
  invalid_url: 'Linkul nu e corect (trebuie să înceapă cu https://).',
  invalid_color: 'Culoarea nu e corectă.',
  invalid_stock: 'Stocul trebuie să fie un număr întreg (sau gol, fără limită).',
  invalid_transition: 'Comanda și-a schimbat deja starea. Reîncarcă pagina.',
  no_active_subscription: 'Clientul nu are un abonament activ (cu tunsori rămase) pentru acest serviciu.',
  already_completed: 'Tunsoarea a fost deja confirmată.',
  booking_cancelled: 'Programarea e anulată.',
  plan_not_found: 'Abonamentul nu mai există sau e ascuns.',
  invalid_amount: 'Suma nu e corectă (cardurile cadou: între 10 și 5000 de lei, maxim 6 sume propuse).',
  bonus_not_active: 'Bonusul nu mai e activ.',
  invalid_role: 'Rolul nu e corect.',
  invalid_hour: 'Ora nu e corectă (la orele libere: între una și patru ore, 07:00–20:00).',
  invalid_period: 'Perioada trebuie să fie între 1 și 3650 de zile.',
  invalid_cuts: 'Numărul de tunsori trebuie să fie între 1 și 1000 (sau bifează Nelimitat).',
  not_completed: 'Programarea nu e confirmată ca plătită.',
  title_required: 'Completează ce vede clientul.',
  invalid_value: 'Verifică valoarea și valabilitatea.',
  invalid_weeks: 'Numărul de săptămâni trebuie să fie între 2 și 52.',
  invalid_window: 'Intervalul trebuie să fie între 1 și 10 ore.',
  invalid_max: 'Maxim de câte ori pe săptămână: între 1 și 7.',
  invalid_months: 'Valabilitatea trebuie să fie între 1 și 36 de luni.',
  not_pending: 'Cardul a fost deja încasat sau anulat.',
  supplier_required: 'Scrie furnizorul.',
  lines_required: 'Adaugă cel puțin un produs.',
  invalid_qty: 'Cantitatea nu e corectă.',
  invalid_vat: 'Cota de TVA nu e corectă.',
  invalid_day: 'Data nu e corectă.',
  invalid_barber: 'Frizerul ales nu mai există.',
  import_empty: 'Fișierul nu are niciun rând cu clienți.',
  import_too_big: 'Fișierul are prea multe rânduri (maxim 3000 o dată). Împarte-l în mai multe.',
  review_not_completed: 'Cererea de recenzie se trimite după ce tunsoarea e încheiată.',
  review_off: 'Cererea de recenzie e oprită la Notificări → Ce se trimite și pe unde.',
  unknown_wildcard: 'Textul are o variabilă pe care mesajul ăsta nu o cunoaște. Folosește doar butoanele de sub text.',
  text_too_long: 'Textul e prea lung.',
  review_link_missing: 'Pune întâi linkul de recenzie Google în Aplicații → Linkuri.',
  review_already_sent: 'Clientul a primit deja cererea de recenzie pentru tunsoarea asta.',
  send_failed: 'Mesajul nu a putut fi trimis.',
  product_not_found: 'Produsul nu mai există.',
  stock_too_low: 'Nu e destul stoc (produsele s-au vândut sau folosit între timp).',
  stock_not_tracked: 'Produsul nu are stoc urmărit.',
  already_cancelled: 'E deja anulat.',
  gift_card_not_found: 'Nu există un card cadou activ cu acest cod.',
  gift_card_expired: 'Cardul cadou a expirat.',
  gift_card_empty: 'Pe cardul cadou nu mai sunt bani.',
  unsupported_media: 'Merg doar poze și clipuri MP4 sau MOV.',
  video_too_large: 'Clipul e prea mare (cel mult 95 MB).',
  video_needs_storage: 'Pentru clipuri trebuie pornit spațiul de fișiere (Cloudflare R2).',
  one_video_only: 'Un clip se postează singur, fără alte poze.',
  tiktok_video_only: 'Pe TikTok se pot posta doar clipuri.',
  media_required: 'Adaugă cel puțin o poză sau un clip.',
  targets_required: 'Bifează unde să plece postarea.',
  media_missing: 'O poză sau un clip nu mai există. Încarcă-l din nou.',
  account_missing: 'Unul dintre conturi a fost deconectat.',
  public_url_missing: 'Lipsește adresa publică a serverului (PUBLIC_URL).',
  post_already_sent: 'Postarea a plecat deja și nu se mai poate schimba.',
  post_in_progress: 'Postarea se trimite acum. Încearcă puțin mai târziu.',
  meta_not_configured: 'Lipsește aplicația Meta pe server.',
  tiktok_not_configured: 'Lipsește aplicația TikTok pe server.',
  social_key_missing: 'Lipsește cheia de criptare pe server.',
  invalid_date: 'Alege data și ora.',
  empty_file: 'Fișierul e gol.',
};
export const errorText = (e: unknown) =>
  e instanceof ApiError ? (MESSAGES[e.code] ?? `Eroare: ${e.code}`) : 'A apărut o problemă.';

/** Micșorează poza în browser (max `maxPx` pe latura mare) și o urcă. Întoarce adresa ei. */
export async function uploadImage(file: File, opts: { maxPx?: number; keepAlpha?: boolean; path?: string } = {}): Promise<string> {
  return ((await uploadImageTo(opts.path ?? '/v1/admin/media', file, opts)) as { url: string }).url;
}

/** Ca `uploadImage`, dar spre altă adresă; întoarce răspunsul serverului. */
export async function uploadImageTo(path: string, file: File, opts: { maxPx?: number; keepAlpha?: boolean } = {}): Promise<unknown> {
  const maxPx = opts.maxPx ?? 1000;
  const bmp = await createImageBitmap(file).catch(() => {
    throw new ApiError('unsupported_image', 400);
  });
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = opts.keepAlpha ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
  if (!blob) throw new ApiError('unsupported_image', 400);
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': type, Authorization: `Bearer ${getToken()}` }, body: blob });
  } catch {
    throw new ApiError('network', 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
  return json;
}

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  stock: number | null;
  sort: number;
  active: boolean;
  forSale: boolean;
  unit: string;
  cost: number | null;
};
export type OrderStatus = 'new' | 'ready' | 'picked_up' | 'cancelled';
export type Order = {
  id: string;
  code: string;
  status: OrderStatus;
  total: number;
  note: string;
  paidAt?: string | null;
  payMethod?: string | null; // cash | card | transfer | online
  createdAt: string;
  clientName: string;
  clientPhone: string;
  items: Array<{ productId: string; name: string; price: number; qty: number }>;
};

export type Appearance = {
  accent: string;
  background: string;
  logoUrl: string | null;
  title: string;
  welcome: { ro: string; en: string; fr: string };
  buttonText: string | null;
  text: string;
  muted: string;
  card: string | null;
  backgroundImage: string | null;
  backgroundDim: number;
};

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
  /** Culoarea frizerului în calendar (#RRGGBB); null = una din paleta implicită. */
  color: string | null;
  initials: string;
  sort: number;
  active: boolean;
  serviceIds: string[];
  /** Prețuri proprii în lei, doar unde diferă de prețul standard. */
  prices: Record<string, number>;
  durations?: Record<string, number>;
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
  payment?: 'paid' | 'subscription' | null;
  paidAmount?: number | null;
  onlinePaid?: number | null; // plătită cu cardul din aplicație, înainte de vizită
  onlineRefunded?: boolean;
  tip?: number | null;
  cancelledBy?: 'client' | 'staff' | null;
  bonusId?: string | null;
  clientBirthday?: boolean;
};
export type Plan = { id: string; name: string; description: string; price: number; periodDays: number; cuts: number | null; serviceIds: string[]; sort: number; active: boolean };
export type Subscription = {
  id: string;
  planId: string | null;
  name: string;
  price: number;
  cutsTotal: number | null;
  cutsUsed: number;
  cutsLeft: number | null;
  serviceIds: string[];
  startsAt: string;
  endsAt: string;
  state: 'active' | 'upcoming' | 'expired' | 'used_up' | 'cancelled';
  note: string;
  createdAt: string;
  cancelledAt: string | null;
  createdByName?: string | null;
  client?: { id: string; name: string; phone: string };
};
export type Checkout = { booking: Booking; subscription: Subscription | null; bonuses: Bonus[] };
export type BonusKind = 'percent' | 'amount' | 'free' | 'other';
export type Reward = { title: string; kind: BonusKind; value: number | null; validDays: number | null };
export type ReferralSettings = { enabled: boolean; auto: boolean; standard: Reward };
export type Bonus = {
  id: string;
  title: string;
  kind: BonusKind;
  value: number | null;
  source: 'manual' | 'referral';
  status: 'active' | 'used' | 'expired';
  expiresAt: string | null;
  createdAt: string;
  usedAt: string | null;
  referralName?: string | null;
};
export type Referral = {
  newClient: { id: string; name: string; phone: string };
  referrer: { id: string; name: string; phone: string };
  createdAt: string;
  bonusTitle: string | null;
};
export type ClientPhoto = { id: string; url: string; caption: string; createdAt?: string; addedBy?: string | null };
export type Client = {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  lang: string;
  marketing: { sms: boolean; email: boolean; push: boolean };
  notes: string;
  createdAt: string;
  birthDate?: string | null;
  photoUrl?: string | null;
  identity?: { note: string; photos: ClientPhoto[]; staffPhotos?: ClientPhoto[] };
  beforeAfter?: Array<{ id: string; before: string; after: string; barberName: string | null; createdAt: string }>;
  bonuses?: Bonus[];
  subscriptions?: Subscription[];
  referredBy?: { id: string; name: string } | null;
  referredCount?: number;
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
  imageUrl: string | null;
  color: string | null;
  action: { type: 'service'; serviceId: string } | { type: 'url'; url: string } | { type: 'book' };
  translations: Record<string, Partial<Record<'kicker' | 'title' | 'text' | 'cta', string>>>;
  startsAt: string | null;
  endsAt: string | null;
  sort: number;
  active: boolean;
};
export type Business = {
  name: string;
  /** Datele firmei, pentru regulamente: denumire, CUI, Registrul Comerțului, sediu, e-mail. */
  legalName?: string;
  cui?: string;
  regCom?: string;
  legalAddress?: string;
  legalEmail?: string;
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
export type Perm = 'bookings_all' | 'bookings_create' | 'bookings_manage' | 'clients' | 'contacts' | 'timeoff' | 'stats' | 'reports' | 'shop';
export type Role = 'org_admin' | 'location_admin' | 'barber';
export const ROLE_LABELS: Record<Role, string> = {
  org_admin: 'Administrator de organizație',
  location_admin: 'Administrator de locație',
  barber: 'Frizer',
};
export const ROLE_HELP: Record<Role, string> = {
  org_admin: 'Vede și schimbă tot, inclusiv setările, serviciile și echipa.',
  location_admin: 'Vede toate programările și datele de contact ale clienților. Nu schimbă setările afacerii.',
  barber: 'Își vede programările, caută clienți și le completează fișa. Fără telefon și e-mail, dacă nu bifezi.',
};
export type Me = { id: string; email: string; name: string; barberId: string | null; role?: Role; owner: boolean; permissions: Record<Perm, boolean> };
export const PERM_LABELS: Record<Perm, string> = {
  bookings_all: 'Vede programările tuturor frizerilor',
  bookings_create: 'Adaugă programări',
  bookings_manage: 'Anulează și marchează programări (finalizată, neprezentare)',
  clients: 'Caută clienți, le vede fișa și istoricul',
  contacts: 'Vede telefonul și e-mailul clienților (și exportă lista)',
  timeoff: 'Își pune singur concedii și pauze',
  stats: 'Vede încasările',
  reports: 'Vede tabloul de bord și rapoartele (și le descarcă în Excel)',
  shop: 'Vede și pregătește comenzile din magazin',
};
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
