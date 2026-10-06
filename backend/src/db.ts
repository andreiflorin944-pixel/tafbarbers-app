import type { Env } from './env';
import { isBirthdayOn, roLocal } from './time';

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
  timezone: string;
  slotStepMin: number;
  cancelHours: number;
  minLeadMin?: number;
  maxDaysAhead?: number;
  cancellationPolicy?: string;
};

export async function getSetting<T>(env: Env, key: string, fallback: T): Promise<T> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r ? { ...fallback, ...(JSON.parse(r.value) as T) } : fallback;
}

export async function setSetting(env: Env, key: string, value: unknown) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, JSON.stringify(value))
    .run();
}

const DEFAULT_BUSINESS: Business = {
  name: 'TAFBarbers',
  tagline: 'Barbershop',
  address: '',
  phone: '',
  website: '',
  instagram: '',
  timezone: 'Europe/Bucharest',
  slotStepMin: 15,
  cancelHours: 12,
  minLeadMin: 30,
  maxDaysAhead: 30,
};

export const getBusiness = (env: Env) => getSetting(env, 'business', DEFAULT_BUSINESS);

// --- Mapări rând SQL → JSON pentru API (camelCase, prețuri în lei) ---

export type ServiceRow = {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  price_bani: number;
  color: string;
  image_url: string | null;
  sort: number;
  active: number;
};
export const service = (r: ServiceRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  durationMin: r.duration_min,
  price: r.price_bani / 100,
  color: r.color,
  imageUrl: r.image_url,
  sort: r.sort,
  active: !!r.active,
});

export type BarberRow = {
  id: string;
  name: string;
  role: string;
  bio: string;
  photo_url: string | null;
  sort: number;
  active: number;
  service_ids?: string | null;
  service_prices?: string | null;
};
export const barber = (r: BarberRow) => ({
  id: r.id,
  name: r.name,
  role: r.role,
  bio: r.bio,
  photoUrl: r.photo_url,
  initials: r.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
  sort: r.sort,
  active: !!r.active,
  serviceIds: r.service_ids ? r.service_ids.split(',') : [],
  // Prețurile proprii ale frizerului, doar unde diferă de prețul standard: { serviceId: lei }.
  prices: Object.fromEntries(
    (r.service_prices ? r.service_prices.split(',') : []).map((x) => {
      const [sid, bani] = x.split(':');
      return [sid, Number(bani) / 100];
    }),
  ) as Record<string, number>,
});

/** Subselecturile cu serviciile și prețurile proprii ale unui frizer `b`. */
export const BARBER_SERVICE_COLS = `(SELECT group_concat(service_id) FROM barber_services WHERE barber_id = b.id) AS service_ids,
  (SELECT group_concat(service_id || ':' || price_bani) FROM barber_services WHERE barber_id = b.id AND price_bani IS NOT NULL) AS service_prices`;

export type BookingRow = {
  id: string;
  client_id: string;
  barber_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  price_bani: number;
  status: string;
  source: string;
  note: string;
  created_at: string;
  payment?: string | null;
  paid_bani?: number | null;
  subscription_id?: string | null;
  bonus_id?: string | null;
  completed_at?: string | null;
  tip_bani?: number | null;
  gift_bani?: number | null;
  cancelled_by?: string | null;
  client_name?: string;
  client_phone?: string;
  client_birth_date?: string | null;
  service_name?: string;
  barber_name?: string;
};
export const booking = (r: BookingRow) => ({
  id: r.id,
  clientId: r.client_id,
  barberId: r.barber_id,
  serviceId: r.service_id,
  start: r.starts_at,
  end: r.ends_at,
  price: r.price_bani / 100,
  status: r.status,
  source: r.source,
  note: r.note,
  createdAt: r.created_at,
  // La finalizare frizerul confirmă plata: suma încasată sau pe abonament.
  payment: (r.payment ?? null) as 'paid' | 'subscription' | null,
  paidAmount: r.paid_bani === null || r.paid_bani === undefined ? null : r.paid_bani / 100,
  subscriptionId: r.subscription_id ?? null,
  bonusId: r.bonus_id ?? null,
  completedAt: r.completed_at ?? null,
  tip: r.tip_bani ? r.tip_bani / 100 : null,
  // Partea plătită cu un card cadou (separat de `paidAmount`, care e ce s-a plătit în plus).
  giftAmount: r.gift_bani ? r.gift_bani / 100 : null,
  cancelledBy: (r.cancelled_by ?? null) as 'client' | 'staff' | null,
  ...(r.client_name !== undefined && { clientName: r.client_name, clientPhone: r.client_phone }),
  // Programare în ziua de naștere a clientului (frizerul vede o lumânare); data nașterii nu se trimite.
  ...(r.client_birth_date !== undefined && { clientBirthday: isBirthdayOn(r.client_birth_date, roLocal(r.starts_at).day) }),
  ...(r.service_name !== undefined && { serviceName: r.service_name, barberName: r.barber_name }),
});

export type ClientRow = {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  lang: string;
  marketing_sms: number;
  marketing_email: number;
  marketing_push: number;
  notes: string;
  created_at: string;
  birth_date?: string | null;
  photo_url?: string | null;
  identity_note?: string;
  referred_by?: string | null;
};
export const client = (r: ClientRow) => ({
  id: r.id,
  phone: r.phone,
  name: r.name,
  email: r.email,
  lang: r.lang,
  marketing: { sms: !!r.marketing_sms, email: !!r.marketing_email, push: !!r.marketing_push },
  notes: r.notes,
  createdAt: r.created_at,
  birthDate: r.birth_date ?? null,
  photoUrl: r.photo_url ?? null,
});

export type PromoRow = {
  id: string;
  kicker: string;
  title: string;
  text: string;
  cta: string;
  icon: string;
  action_type: 'service' | 'url' | 'book';
  action_value: string | null;
  translations: string;
  starts_at: string | null;
  ends_at: string | null;
  sort: number;
  active: number;
  image_url?: string | null;
  color?: string | null;
};
/** Cu `lang`, textele se înlocuiesc cu traducerea (unde există). */
export const promo = (r: PromoRow, lang?: string) => {
  const tr = (JSON.parse(r.translations || '{}') as Record<string, Partial<Record<'kicker' | 'title' | 'text' | 'cta', string>>>)[
    lang ?? ''
  ];
  const action =
    r.action_type === 'service'
      ? { type: 'service' as const, serviceId: r.action_value ?? '' }
      : r.action_type === 'url'
        ? { type: 'url' as const, url: r.action_value ?? '' }
        : { type: 'book' as const };
  return {
    id: r.id,
    kicker: tr?.kicker || r.kicker,
    title: tr?.title || r.title,
    text: tr?.text || r.text,
    cta: tr?.cta || r.cta,
    icon: r.icon,
    imageUrl: r.image_url ?? null,
    color: r.color ?? null,
    action,
    ...(lang === undefined && {
      translations: JSON.parse(r.translations || '{}'),
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      sort: r.sort,
      active: !!r.active,
    }),
  };
};
