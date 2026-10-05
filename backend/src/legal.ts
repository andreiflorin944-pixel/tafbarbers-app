import type { Env } from './env';
import { getBusiness, getSetting, setSetting } from './db';

// Regulamentele afișate în aplicație și pe web. Se editează din panou (Regulamente);
// până atunci se folosesc modelele de mai jos. Limbile lipsă cad pe română.

export const DOCS = ['terms', 'privacy'] as const;
export type Doc = (typeof DOCS)[number];
type Version = { title: string; body: string };
export type LegalStore = Record<Doc, { updatedAt: string | null; versions: Partial<Record<'ro' | 'en' | 'fr', Version>> }>;

const TERMS_RO = `Acești termeni se aplică folosirii aplicației și site-ului {name} pentru programări și cumpărături.

1. Contul
Îți creezi contul cu numărul de telefon, confirmat printr-un cod SMS. Ești responsabil pentru datele introduse și pentru folosirea contului.

2. Programări
O programare e confirmată când o vezi în aplicație și primești SMS-ul de confirmare. Te rugăm să ajungi la timp; întârzierile mari pot duce la scurtarea serviciului sau la reprogramare.

3. Anulare și neprezentare
{policy}

4. Prețuri și plată
Prețurile afișate sunt în lei și includ TVA, unde e cazul. Plata se face la locație, dacă nu se specifică altfel.

5. Comunicări
Îți trimitem SMS-uri legate de programări (confirmare, reamintire, anulare). Ofertele le primești doar dacă ai acceptat, și te poți dezabona oricând din Cont.

6. Modificări
Putem actualiza acești termeni; versiunea curentă e mereu în aplicație, cu data ultimei modificări.

Contact: {contact}`;

const PRIVACY_RO = `{name} („noi”) prelucrează datele tale personale conform Regulamentului (UE) 2016/679 (GDPR).

Ce date colectăm
• nume, număr de telefon și, opțional, adresa de e-mail;
• programările tale (serviciu, frizer, dată, stare) și notițele interne legate de serviciile primite;
• preferințele de comunicare și, dacă le activezi, identificatorul pentru notificări push.

De ce
• pentru a face și a gestiona programările (executarea contractului);
• pentru SMS-uri de confirmare și reamintire (interes legitim, legat de serviciu);
• pentru oferte, doar cu acordul tău, pe care îl poți retrage oricând din Cont.

Cât timp
Păstrăm datele cât timp ai cont. Dacă îți ștergi contul, datele de identificare sunt șterse imediat; istoricul programărilor rămâne anonimizat, pentru evidența contabilă.

Cine le mai vede
Furnizori care ne ajută să livrăm serviciul: găzduire (Cloudflare), trimitere SMS (SMSAdvert), trimitere e-mail și notificări (Expo). Nu vindem datele nimănui.

Drepturile tale
Ai dreptul de acces, rectificare, ștergere, restricționare, portabilitate și opoziție. Din aplicație (Cont) îți poți descărca datele sau șterge contul. Poți depune plângere la ANSPDCP (www.dataprotection.ro).

Contact pentru date personale: {contact}`;

const DEFAULTS: Record<Doc, Version> = {
  terms: { title: 'Termeni și condiții', body: TERMS_RO },
  privacy: { title: 'Politica de confidențialitate', body: PRIVACY_RO },
};

export async function getLegal(env: Env): Promise<LegalStore> {
  const empty: LegalStore = { terms: { updatedAt: null, versions: {} }, privacy: { updatedAt: null, versions: {} } };
  return getSetting(env, 'legal', empty);
}

export async function saveLegal(env: Env, store: LegalStore) {
  await setSetting(env, 'legal', store);
}

/** Textul gata de afișat: din panou sau modelul implicit, cu datele salonului completate. */
export async function legalDoc(env: Env, doc: Doc, lang: string) {
  const [store, biz] = await Promise.all([getLegal(env), getBusiness(env)]);
  const v = store[doc]?.versions ?? {};
  const chosen = v[lang as 'ro'] ?? v.ro ?? DEFAULTS[doc];
  const contact = [biz.phone, biz.address, biz.website].filter(Boolean).join(' · ') || biz.name;
  const fill = (s: string) =>
    s
      .replaceAll('{name}', biz.name)
      .replaceAll('{contact}', contact)
      .replaceAll('{policy}', biz.cancellationPolicy || `Poți anula din aplicație cu cel puțin ${biz.cancelHours} ore înainte.`);
  return { doc, title: fill(chosen.title), body: fill(chosen.body), updatedAt: store[doc]?.updatedAt ?? null, isDefault: !v.ro };
}

export const defaultLegal = DEFAULTS;
