import { ApiError } from '@/api/client';

const RO: Record<string, string> = {
  network: 'Nu ne putem conecta la server. Verifică internetul și încearcă din nou.',
  slot_unavailable: 'Ora aleasă tocmai a fost ocupată. Te rugăm alege alta.',
  too_late_to_cancel: 'Programarea nu se mai poate anula din aplicație atât de aproape de oră. Sună-ne, te rog.',
  too_many_active_bookings: 'Ai deja 3 programări viitoare. Anulează una ca să faci alta.',
  wrong_code: 'Codul nu e corect.',
  code_expired: 'Codul a expirat. Cere unul nou.',
  too_many_attempts: 'Prea multe încercări. Cere un cod nou.',
  too_many_requests: 'Ai cerut un cod de curând. Așteaptă puțin și încearcă din nou.',
  country_not_supported: 'Momentan acceptăm doar numere din România și Europa.',
  invalid_phone: 'Numărul de telefon nu pare corect.',
  invalid_email: 'Adresa de e-mail nu pare corectă.',
  email_not_on_account: 'Contul acestui număr nu are încă un e-mail salvat. Primește codul pe SMS, iar e-mailul scris se salvează în cont.',
  email_mismatch: 'E-mailul nu corespunde contului acestui număr. Scrie e-mailul contului sau primește codul pe SMS.',
  wrong_credentials: 'E-mail sau parolă greșită.',
  no_permission: 'Contul tău nu are drept pentru asta. Cere-i proprietarului.',
  no_server: 'Partea de echipă merge după ce serverul e online.',
  barber_required: 'Alege frizerul.',
  terms_required: 'Bifează acordul pentru termeni și confidențialitate.',
  unauthorized: 'Sesiunea a expirat. Intră din nou în cont.',
  out_of_stock: 'Unul dintre produse nu mai e pe stoc în cantitatea aleasă. Am actualizat lista, verifică coșul.',
  product_unavailable: 'Unul dintre produse nu mai e disponibil. Am actualizat coșul.',
  too_many_open_orders: 'Ai deja 3 comenzi nepreluate. Ridică-le sau anulează una ca să faci alta.',
  not_cancellable: 'Comanda e deja pregătită și nu mai poate fi anulată din aplicație. Sună-ne, te rog.',
};

/** Mesaj pe înțelesul clientului pentru o eroare de la server. */
export function errorMessage(e: unknown, fallback = 'A apărut o problemă. Încearcă din nou.'): string {
  return e instanceof ApiError ? (RO[e.code] ?? fallback) : fallback;
}
