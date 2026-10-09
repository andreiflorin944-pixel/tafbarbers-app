export type Env = {
  DB: D1Database;
  TIMEZONE: string;
  CORS_ORIGINS: string;
  SMSADVERT_TOKEN?: string;
  /** phone = trimite de pe telefonul conectat în SMSAdvert; altfel de pe numărul scurt. */
  SMSADVERT_SENDER?: string;
  /** Logare cu Apple: id-urile aplicației acceptate (implicit ro.tafbarbers.app și Expo Go). */
  APPLE_AUDIENCES?: string;
  /** Logare cu Google: id-urile de client OAuth (nu sunt secrete). Fără ele butonul Google nu apare. */
  GOOGLE_IOS_CLIENT_ID?: string;
  GOOGLE_ANDROID_CLIENT_ID?: string;
  GOOGLE_WEB_CLIENT_ID?: string;
  /** Doar pentru teste locale: de unde se iau cheile publice Apple / Google. */
  SOCIAL_JWKS_BASE?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Adresa la care ajung răspunsurile clienților (altfel e-mailul de contact din Datele firmei). */
  EMAIL_REPLY_TO?: string;
  ADMIN_SETUP_KEY?: string;
  // Plata online (Stripe). Fără ele butoanele „Plătește online” nu apar și totul se plătește la salon.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // Adresa publică a serverului (ex. https://app.tafbarbers.ro), pentru paginile la care revine clientul după plată.
  PUBLIC_URL?: string;
  // Contul demo pentru verificarea din magazine, „telefon:cod” (ex. 0700000000:4826).
  REVIEW_LOGIN?: string;
  // Workers AI (legătura „AI” din wrangler.toml): traducerea automată a textelor în engleză și franceză.
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  // Postări pe rețele: aplicația Meta (Facebook + Instagram) și aplicația TikTok, plus spațiul de fișiere R2 pentru clipuri.
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  // Cheia cu care se criptează tokenurile conturilor conectate (dacă lipsește, se folosește ADMIN_SETUP_KEY).
  SOCIAL_KEY?: string;
  MEDIA?: R2Bucket;
  SOCIAL_MOCK_BASE?: string;
  // Doar local: server de probă în locul Workers AI pentru asistent.
  DEV_AI_MOCK_BASE?: string;
  // Doar pentru dezvoltare locală: codul OTP se întoarce în răspuns în loc de SMS.
  DEV_OTP?: string;
};

export type ClientSession = { kind: 'client'; clientId: string };
// Drepturi configurabile pe conturile echipei. Administratorul de organizație le are pe toate;
// celelalte roluri pornesc de la drepturile implicite ale rolului, iar adminul le poate schimba pe fiecare cont.
export const PERMS = ['bookings_all', 'bookings_create', 'bookings_manage', 'clients', 'contacts', 'timeoff', 'stats', 'reports', 'shop'] as const;
export type Perm = (typeof PERMS)[number];
export type Perms = Record<Perm, boolean>;
export const ROLES = ['org_admin', 'location_admin', 'barber'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_PERMS: Record<Exclude<Role, 'org_admin'>, Perms> = {
  // Frizerul: își vede programările, caută clienți și le completează fișa, dar fără telefon și e-mail.
  barber: {
    bookings_all: false, // vede programările tuturor frizerilor
    bookings_create: true, // adaugă programări
    bookings_manage: true, // anulează / marchează finalizată sau neprezentare
    clients: true, // caută clienți și le vede fișa și istoricul
    contacts: false, // vede telefonul și e-mailul clienților
    timeoff: true, // își pune concedii și pauze
    stats: false, // vede încasările
    reports: false, // vede tabloul de bord și rapoartele (și le descarcă în Excel)
    shop: false, // vede și pregătește comenzile din magazin
  },
  // Administratorul de locație: vede toate programările și datele de contact.
  location_admin: { bookings_all: true, bookings_create: true, bookings_manage: true, clients: true, contacts: true, timeoff: true, stats: true, reports: true, shop: true },
};
export const DEFAULT_BARBER_PERMS = ROLE_PERMS.barber;
export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);
export function parsePerms(raw: string | null | undefined, role: Role): Perms {
  if (role === 'org_admin') return Object.fromEntries(PERMS.map((p) => [p, true])) as Perms;
  let saved: Partial<Perms> = {};
  try {
    saved = JSON.parse(raw || '{}');
  } catch {
    // valori stricate: rămân cele implicite
  }
  const base = ROLE_PERMS[role] ?? ROLE_PERMS.barber;
  return Object.fromEntries(PERMS.map((p) => [p, typeof saved[p] === 'boolean' ? saved[p] : base[p]])) as Perms;
}

export type AdminSession = { kind: 'admin'; adminId: string; barberId: string | null; role: Role; owner: boolean; perms: Perms };

export type AppEnv = {
  Bindings: Env;
  Variables: { client: ClientSession; admin: AdminSession };
};

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 500,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
