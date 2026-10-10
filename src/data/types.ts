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
  /** Durate proprii (minute) pe serviciu, doar unde diferă de durata standard. */
  durations?: Record<string, number>;
  /** Locația în care lucrează (un frizer lucrează într-o singură locație). */
  locationId?: string | null;
};

/** O locație a salonului: clientul o alege la primul pas al programării. */
export type Location = {
  id: string;
  name: string;
  address: string;
  /** Gol = telefonul salonului. */
  phone: string;
  photoUrl?: string | null;
};

export type Slot = {
  start: string; // ISO datetime
  barberId: string;
  /** Oră „Doar membri TAF Club”: o primesc doar membrii (și echipa). */
  membersOnly?: boolean;
};

// requested = cerere trimisă, în așteptarea confirmării salonului (când programările cer aprobare).
export type BookingStatus = 'requested' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';

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
  locationId?: string | null;
  locationName?: string | null;
  payment?: 'paid' | 'subscription' | null;
  paidAmount?: number | null;
  onlinePaid?: number | null; // plătită cu cardul din aplicație
  onlineRefunded?: boolean;
  requestOutcome?: 'accepted' | 'refused' | 'expired' | null;
  refuseReason?: string | null;
};

/** Intervalul din zi pentru lista de așteptare. */
export type DayPart = 'any' | 'morning' | 'afternoon' | 'evening';

/** O înscriere pe lista de așteptare („Anunță-mă dacă se eliberează un loc”). */
export type WaitlistEntry = {
  id: string;
  serviceId: string;
  serviceName: string;
  barberId: string | null; // null = orice frizer
  barberName: string | null;
  locationId?: string | null; // „orice frizer” din această locație
  day: string; // AAAA-LL-ZZ
  part: DayPart;
  // waiting = încă nimic; notified = a primit mesaj; booked = s-a programat; expired = ziua a trecut; removed = scos
  status: 'waiting' | 'notified' | 'booked' | 'expired' | 'removed';
  notifyCount: number;
  maxNotices: number;
  active: boolean; // încă poate primi mesaj
  lastSlot: string | null;
  createdAt: string;
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
  /** Contul are o parolă (pe lângă intrarea cu cod). */
  hasPassword?: boolean;
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
  maxDaysAhead?: number; // cu câte zile înainte se poate programa (Setări → Reguli de programare)
  cancellationPolicy?: string;
  // 0 = duminică ... 6 = sâmbătă; null = închis
  hours: Array<{ open: string; close: string } | null>;
  appearance?: Appearance;
  onlinePayments?: boolean; // plata cu cardul în aplicație (Stripe) e pornită
  /** Consilierul AI de tunsori e pornit în panou (cardul „Ce tunsoare mi se potrivește?”). */
  advisor?: boolean;
  otpSms?: boolean; // codul de intrare poate fi cerut și prin SMS
  // Logare cu Apple / Google (Google apare doar cu id-urile de client OAuth puse pe server).
  social?: { apple: boolean; google: { iosClientId: string | null; androidClientId: string | null; webClientId: string | null } | null };
  requireApproval?: boolean; // programările din aplicație intră ca cereri, confirmate de salon
  approvalBarberIds?: string[]; // doar la acești frizeri (listă goală = la toți)
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
export type BeforeAfter = { id: string; before: string; after: string; barberName: string | null; createdAt: string; showExample?: boolean };
