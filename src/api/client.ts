import type { BeforeAfter, DayPart, WaitlistEntry, GiftCards, Barber, Booking, Business, Identity, Referrals, IdentityPhoto, Plan, Subscription, Me, Order, Product, Promo, Service, Slot } from '@/data/types';

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
    /** Cu contul clientului (membrii TAF Club văd și orele pentru membri) sau al echipei (le vede pe toate). */
    token?: string | null;
  }): Promise<Slot[]>;

  /** Trimite codul pe e-mail (principal) sau SMS (alternativă). `devCode` vine doar de la serverul de test. */
  requestCode(
    input: { phone: string; email?: string; channel: 'email' | 'sms' },
    lang: string,
  ): Promise<{ phone: string; channel: 'email' | 'sms'; sentTo: string; newAccount?: boolean; devCode?: string }>;
  verifyCode(input: { phone: string; code: string; name: string; lang: string; acceptTerms: boolean; marketing?: boolean; birthDate?: string; email?: string; ref?: string; qr?: string; socialTicket?: string }): Promise<{ token: string }>;
  /** Logare cu Apple / Google: intră direct dacă contul e legat, altfel cere telefonul (tichet pentru completare). */
  socialSignIn(input: { provider: 'apple' | 'google'; idToken: string; nonce?: string; name?: string }): Promise<{ token?: string; needsPhone?: boolean; ticket?: string; email?: string | null; name?: string }>;
  socialComplete(input: { ticket: string; phone: string; name: string; lang: string; acceptTerms: boolean; marketing?: boolean; birthDate?: string; ref?: string; qr?: string }): Promise<{ token: string }>;
  getLegal(doc: 'terms' | 'privacy', lang: string): Promise<{ title: string; body: string; updatedAt: string | null }>;
  exportMe(token: string): Promise<unknown>;
  deleteMe(token: string): Promise<void>;
  logout(token: string): Promise<void>;
  me(token: string): Promise<Me>;
  updateMe(
    token: string,
    patch: Partial<Pick<Me, 'name' | 'email' | 'lang' | 'birthDate'>> & { marketing?: Partial<Me['marketing']> },
  ): Promise<Me>;

  // Poza de profil și TAF Identity. `uri` = poza locală aleasă de pe telefon.
  setProfilePhoto(token: string, uri: string): Promise<{ photoUrl: string }>;
  removeProfilePhoto(token: string): Promise<void>;
  getIdentity(token: string): Promise<Identity>;
  getReferrals(token: string): Promise<Referrals>;
  getSubscriptions(token: string): Promise<{ plans: Plan[]; subscriptions: Subscription[] }>;
  saveIdentityNote(token: string, note: string): Promise<Identity>;
  addIdentityPhoto(token: string, uri: string): Promise<IdentityPhoto>;
  removeIdentityPhoto(token: string, id: string): Promise<void>;

  // Carduri cadou (plata la salon) și pozele înainte/după puse de frizer.
  getGiftCards(token: string): Promise<GiftCards>;
  buyGiftCard(token: string, input: { amount: number; recipientName: string; recipientPhone?: string; message?: string }): Promise<{ id: string }>;
  cancelGiftCard(token: string, id: string): Promise<void>;
  /** Adresa paginii de plată online (Stripe). */
  payGiftCard(token: string, id: string): Promise<{ url: string }>;
  getBeforeAfter(token: string): Promise<BeforeAfter[]>;

  listBookings(token: string): Promise<Booking[]>;
  createBooking(
    token: string,
    input: { serviceId: string; barberId: string | null; start: string; note?: string },
  ): Promise<Booking>;
  cancelBooking(token: string, id: string): Promise<Booking>;
  /** Lista de așteptare: înscrierile clientului, înscriere când ziua e plină, scoatere. */
  getWaitlist(token: string): Promise<WaitlistEntry[]>;
  joinWaitlist(token: string, input: { serviceId: string; barberId: string | null; day: string; part: DayPart }): Promise<WaitlistEntry>;
  leaveWaitlist(token: string, id: string): Promise<void>;
  registerPushToken(token: string, pushToken: string, platform: string): Promise<void>;

  // Magazin: plata la ridicare din salon.
  getProducts(): Promise<Product[]>;
  listOrders(token: string): Promise<Order[]>;
  createOrder(token: string, input: { items: Array<{ productId: string; qty: number }>; note?: string }): Promise<Order>;
  cancelOrder(token: string, id: string): Promise<Order>;
  payOrder(token: string, id: string): Promise<{ url: string }>;
  payBooking(token: string, id: string): Promise<{ url: string }>;
  /** Clientul din cont a deschis aplicația dintr-un cod QR de campanie. */
  qrOpen(token: string, code: string): Promise<{ ok: true }>;
  /** Asistentul: istoricul conversației → răspunsul și, poate, o programare propusă. */
  assistant(input: { messages: AssistantMsg[]; lang: string }, token?: string | null): Promise<{ reply: string; proposal?: AssistantProposal }>;
  /** Înregistrarea vocală (fișier local) → text. */
  assistantVoice(uri: string, lang: string, token?: string | null): Promise<{ text: string }>;
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

export type AssistantMsg = { role: 'user' | 'assistant'; content: string };
export type AssistantProposal = { serviceId: string; barberId: string; start: string; serviceName: string; barberName: string; price: number; when: string };
