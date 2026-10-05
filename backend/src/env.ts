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
export type AdminSession = { kind: 'admin'; adminId: string; barberId: string | null };

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
