/**
 * „Client fără programare” (walk-in): clientul intrat de pe stradă, trecut în calendar fără cont.
 * Toate programările lui stau pe un client de sistem ascuns (marcat ca șters, cu telefon „deleted:…”),
 * deci nu apare în lista de clienți, nu primește mesaje și nu intră în campanii, tombolă sau curățenie.
 * Numele scris de echipă (opțional) stă pe programare, în `walkin_name`.
 */
export const WALKIN_ID = 'cl_walkin';
export const WALKIN_LABEL = 'Client fără programare';

/** Numele de afișat (SQL), pentru o interogare cu `b` = bookings și `c` = clients. */
export const WALKIN_NAME_SQL = `CASE WHEN b.client_id = '${WALKIN_ID}' THEN coalesce(nullif(trim(b.walkin_name), ''), '${WALKIN_LABEL}') ELSE c.name END`;
/** În rapoarte fiecare walk-in e un client separat, venit o singură dată (nou), nu un „client” cu sute de vizite. */
export const WALKIN_CLIENT_KEY_SQL = `CASE WHEN b.client_id = '${WALKIN_ID}' THEN 'walkin:' || b.id ELSE b.client_id END`;
export const isWalkinKey = (id: string) => id === WALKIN_ID || id.startsWith('walkin:');
