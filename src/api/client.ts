import type { Barber, Booking, Business, Me, Order, Product, Promo, Service, Slot } from '@/data/types';

// Singura legătură dintre interfață și server. `http.ts` vorbește cu serverul nostru
// (Cloudflare Worker); `mock.ts` e varianta de test, folosită cât timp aplicația nu are
// adresa serverului configurată.
export interface BookingApi {
  getBusiness(): Promise<Business>;
  getServices(): Promise<Service[]>;
  getBarbers(): Promise<Barber[]>;
  getPromos(lang: string): Promise<Promo[]>;
  getAvailability(input: {
    serviceId: string;
    barberId: string | null; // null = oricine e liber
    day: string; // YYYY-MM-DD
  }): Promise<Slot[]>;

  /** Trimite codul pe e-mail (principal) sau SMS (alternativă). `devCode` vine doar de la serverul de test. */
  requestCode(
    input: { phone: string; email?: string; channel: 'email' | 'sms' },
    lang: string,
  ): Promise<{ phone: string; channel: 'email' | 'sms'; sentTo: string; devCode?: string }>;
  verifyCode(input: { phone: string; code: string; name: string; lang: string; acceptTerms: boolean }): Promise<{ token: string }>;
  getLegal(doc: 'terms' | 'privacy', lang: string): Promise<{ title: string; body: string; updatedAt: string | null }>;
  exportMe(token: string): Promise<unknown>;
  deleteMe(token: string): Promise<void>;
  logout(token: string): Promise<void>;
  me(token: string): Promise<Me>;
  updateMe(
    token: string,
    patch: Partial<Pick<Me, 'name' | 'email' | 'lang'>> & { marketing?: Partial<Me['marketing']> },
  ): Promise<Me>;

  listBookings(token: string): Promise<Booking[]>;
  createBooking(
    token: string,
    input: { serviceId: string; barberId: string | null; start: string; note?: string },
  ): Promise<Booking>;
  cancelBooking(token: string, id: string): Promise<Booking>;
  registerPushToken(token: string, pushToken: string, platform: string): Promise<void>;

  // Magazin: plata la ridicare din salon.
  getProducts(): Promise<Product[]>;
  listOrders(token: string): Promise<Order[]>;
  createOrder(token: string, input: { items: Array<{ productId: string; qty: number }>; note?: string }): Promise<Order>;
  cancelOrder(token: string, id: string): Promise<Order>;
}

/** Eroare de la server, cu codul lui (ex. `slot_unavailable`). */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
