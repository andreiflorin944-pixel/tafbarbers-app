import type { Barber, Booking, Business, Me, Promo, Service, Slot } from '@/data/types';

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

  /** Trimite codul pe SMS. `devCode` vine doar de la serverul de test. */
  requestCode(phone: string, lang: string): Promise<{ phone: string; devCode?: string }>;
  verifyCode(input: { phone: string; code: string; name: string; lang: string }): Promise<{ token: string }>;
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
