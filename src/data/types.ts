// Formele datelor, la fel ca în răspunsurile serverului nostru (backend/src/db.ts).

export type Service = {
  id: string;
  name: string;
  description: string;
  price: number; // lei
  durationMin: number;
  color: string;
  imageUrl?: string | null;
};

export type Barber = {
  id: string;
  name: string;
  role: string;
  initials: string;
  photoUrl?: string | null;
  serviceIds?: string[];
  /** Prețuri proprii (lei) pe serviciu, doar unde diferă de prețul standard. */
  prices?: Record<string, number>;
};

export type Slot = {
  start: string; // ISO datetime
  barberId: string;
};

export type BookingStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show';

export type Booking = {
  id: string;
  serviceId: string;
  barberId: string;
  start: string; // ISO datetime
  end?: string;
  price?: number;
  status: BookingStatus;
  serviceName?: string;
  barberName?: string;
};

export type Me = {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  lang: string;
  marketing: { sms: boolean; email: boolean; push: boolean };
  birthDate?: string | null; // AAAA-LL-ZZ
  photoUrl?: string | null;
};

/** O poză din TAF Identity. `addedBy` apare doar la pozele urcate de echipă. */
export type IdentityPhoto = { id: string; url: string; caption: string; createdAt?: string; addedBy?: string | null };
export type Bonus = {
  id: string;
  title: string;
  kind: 'percent' | 'amount' | 'free' | 'other';
  value: number | null;
  source: 'manual' | 'referral';
  status: 'active' | 'used' | 'expired';
  expiresAt: string | null;
  createdAt: string;
  usedAt: string | null;
  referralName?: string | null;
};
export type Referrals = { enabled: boolean; code: string; referred: number; reward: string | null; bonuses: Bonus[] };
export type Identity = { note: string; photos: IdentityPhoto[]; staffPhotos?: IdentityPhoto[] };

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
  cancelHours?: number;
  cancellationPolicy?: string;
  // 0 = duminică ... 6 = sâmbătă; null = închis
  hours: Array<{ open: string; close: string } | null>;
  appearance?: Appearance;
};

export type Appearance = {
  accent: string;
  background?: string;
  logoUrl: string | null;
  title: string;
  welcome: { ro: string; en: string; fr: string };
  buttonText?: string | null;
  text?: string;
  muted?: string;
  card?: string | null;
  backgroundImage?: string | null;
  backgroundDim?: number;
};

export type Promo = {
  id: string;
  kicker: string;
  title: string;
  text: string;
  cta: string;
  icon: 'pricetag' | 'flame' | 'school' | 'bag-handle';
  imageUrl?: string | null; // poză de fundal a bannerului
  color?: string | null; // culoarea bannerului; null = alternativ culoarea principală / închis
  // ce face butonul
  action: { type: 'service'; serviceId: string } | { type: 'url'; url: string } | { type: 'book' };
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  stock: number | null; // null = fără limită
};

export type OrderStatus = 'new' | 'ready' | 'picked_up' | 'cancelled';
export type Order = {
  id: string;
  code: string; // codul spus la ridicare
  status: OrderStatus;
  total: number;
  note: string;
  createdAt: string;
  items: Array<{ productId: string; name: string; price: number; qty: number }>;
};
