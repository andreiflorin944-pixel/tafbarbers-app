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
// Drepturi configurabile pentru conturile de frizer. Proprietarul le are pe toate.
export const PERMS = ['bookings_all', 'bookings_create', 'bookings_manage', 'clients', 'timeoff', 'stats', 'shop'] as const;
export type Perm = (typeof PERMS)[number];
export type Perms = Record<Perm, boolean>;
export const DEFAULT_BARBER_PERMS: Perms = {
  bookings_all: false, // vede programările tuturor frizerilor
  bookings_create: true, // adaugă programări
  bookings_manage: true, // anulează / marchează finalizată sau neprezentare
  clients: false, // lista de clienți și istoricul lor
  timeoff: true, // își pune concedii și pauze
  stats: false, // vede încasările
  shop: false, // vede și pregătește comenzile din magazin
};
export function parsePerms(raw: string | null | undefined, owner: boolean): Perms {
  if (owner) return Object.fromEntries(PERMS.map((p) => [p, true])) as Perms;
  let saved: Partial<Perms> = {};
  try {
    saved = JSON.parse(raw || '{}');
  } catch {
    // valori stricate: rămân cele implicite
  }
  return Object.fromEntries(PERMS.map((p) => [p, typeof saved[p] === 'boolean' ? saved[p] : DEFAULT_BARBER_PERMS[p]])) as Perms;
}

export type AdminSession = { kind: 'admin'; adminId: string; barberId: string | null; owner: boolean; perms: Perms };

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
