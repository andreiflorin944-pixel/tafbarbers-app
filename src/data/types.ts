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
  payment?: 'paid' | 'subscription' | null;
  paidAmount?: number | null;
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
export type Plan = { id: string; name: string; description: string; price: number; periodDays: number; cuts: number | null; serviceIds: string[]; sort?: number; active?: boolean };
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
  createdAt: string;
  cancelledAt: string | null;
  note?: string;
  createdByName?: string | null;
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
  onlinePayments?: boolean; // plata cu cardul în aplicație (Stripe) e pornită
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
  paidAt?: string | null;
  payMethod?: string | null; // cash | card | transfer | online
  createdAt: string;
  items: Array<{ productId: string; name: string; price: number; qty: number }>;
};

export type GiftCard = {
  id: string;
  code: string | null; // apare după ce cardul e plătit la salon
  amount: number;
  balance: number;
  recipientName: string;
  recipientPhone: string | null;
  message: string;
  status: 'pending' | 'active' | 'used' | 'cancelled' | 'expired';
  paidAt: string | null;
  payMethod?: string | null;
  expiresAt: string | null;
  createdAt: string;
  buyerName?: string | null;
};
export type GiftCards = { enabled: boolean; amounts: number[]; validMonths: number; bought: GiftCard[]; received: GiftCard[] };
export type BeforeAfter = { id: string; before: string; after: string; barberName: string | null; createdAt: string };
