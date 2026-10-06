export type Env = {
  DB: D1Database;
  TIMEZONE: string;
  CORS_ORIGINS: string;
  SMSADVERT_TOKEN?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  ADMIN_SETUP_KEY?: string;
  // Doar pentru dezvoltare locală: codul OTP se întoarce în răspuns în loc de SMS.
  DEV_OTP?: string;
};

export type ClientSession = { kind: 'client'; clientId: string };
// Drepturi configurabile pe conturile echipei. Administratorul de organizație le are pe toate;
// celelalte roluri pornesc de la drepturile implicite ale rolului, iar adminul le poate schimba pe fiecare cont.
export const PERMS = ['bookings_all', 'bookings_create', 'bookings_manage', 'clients', 'contacts', 'timeoff', 'stats', 'shop'] as const;
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
    shop: false, // vede și pregătește comenzile din magazin
  },
  // Administratorul de locație: vede toate programările și datele de contact.
  location_admin: { bookings_all: true, bookings_create: true, bookings_manage: true, clients: true, contacts: true, timeoff: true, stats: true, shop: true },
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
