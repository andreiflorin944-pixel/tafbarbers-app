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
};

export type Promo = {
  id: string;
  kicker: string;
  title: string;
  text: string;
  cta: string;
  icon: 'pricetag' | 'flame' | 'school' | 'bag-handle';
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
