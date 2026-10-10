import type { Env } from './env';
import { getBusiness, getSetting, setSetting } from './db';
import { langOf, localizeText, lookup } from './contentI18n';

// Regulamentele afișate în aplicație și pe web. Se editează din panou (Regulamente), doar în română;
// până atunci se folosesc modelele de mai jos. În engleză și franceză se arată traducerea automată (cu mențiunea că
// varianta oficială e cea în română), iar până e gata, româna.

export const DOCS = ['terms', 'privacy'] as const;
export type Doc = (typeof DOCS)[number];
type Version = { title: string; body: string };
export type LegalStore = Record<Doc, { updatedAt: string | null; versions: Partial<Record<'ro' | 'en' | 'fr', Version>> }>;

// Modelele respectă legislația din România și UE: OUG 34/2014 (contracte la distanță, dreptul de retragere),
// Legea 296/2004 (Codul consumului), GDPR, Legea 506/2004 (comunicări electronice). Datele firmei vin din
// Setări → Datele firmei; unde lipsesc, apare „[de completat]”.
const TERMS_RO = `Ultima actualizare: {updated}

Acești termeni și condiții („Termenii”) se aplică folosirii aplicației mobile și a site-ului {name} („Aplicația”) pentru programări, cumpărături din magazin, carduri cadou și abonamente. Folosind Aplicația, ești de acord cu Termenii. Dacă nu ești de acord, te rugăm să nu folosești Aplicația.

1. Cine suntem
Aplicația este operată de {company}, cu sediul în {seat}, CUI {cui}, nr. de înregistrare la Registrul Comerțului {regcom} („noi”). Locația unde se prestează serviciile: {address}. Contact: {email}, telefon {phone}.

2. Contul
2.1. Contul se creează cu numărul de telefon, adresa de e-mail, numele și data nașterii, și se confirmă cu un cod de unică folosință trimis pe e-mail sau prin SMS. Nu folosim parole pentru clienți.
2.2. Trebuie să ai cel puțin 16 ani ca să îți faci cont. Pentru copii, programarea o face părintele sau tutorele, din contul lui.
2.3. Ești responsabil pentru corectitudinea datelor din cont și pentru păstrarea accesului la telefonul și e-mailul tău. Ne poți anunța oricând dacă suspectezi o folosire neautorizată.
2.4. Poți șterge contul oricând, din Aplicație (Cont → Șterge contul) sau de pe pagina {deleteUrl}. Ce se întâmplă cu datele tale la ștergere e descris în Politica de confidențialitate.
2.5. Putem suspenda sau închide un cont folosit abuziv (de exemplu programări false repetate, neprezentări repetate fără anunț, limbaj jignitor față de echipă), după ce te anunțăm, cu excepția cazurilor grave.

3. Programări
3.1. Programarea e confirmată când apare în Aplicație, la „Programările mele”, și primești confirmarea (notificare, SMS sau e-mail, după caz). Rezervarea unei ore prin Aplicație este gratuită; serviciul se plătește la salon, după prestare, dacă nu se precizează altfel.
3.2. Prețul și durata afișate sunt orientative pentru serviciul ales; prețul final poate diferi doar dacă, de comun acord, se schimbă serviciul sau se adaugă servicii.
3.3. Te rugăm să ajungi la timp. La o întârziere mare, serviciul poate fi scurtat sau mutat, ca să nu afectăm clienții următori.
3.4. Anularea și neprezentarea: {policy}
3.5. Dacă salonul trebuie să anuleze sau să mute o programare (de exemplu boala frizerului), te anunțăm cât mai repede și îți propunem o altă oră.
3.6. Serviciile de frizerie sunt prestate la data aleasă de tine. Dacă le plătești în avans prin Aplicație, ești de acord ca prestarea să înceapă înainte de expirarea termenului de retragere și iei la cunoștință că pierzi dreptul de retragere după ce serviciul a fost prestat integral (art. 16 lit. a din OUG 34/2014).

4. Magazinul din Aplicație
4.1. Produsele se comandă din Aplicație și se ridică de la salon. Comanda devine fermă când o confirmăm ca pregătită. Plata se face la ridicare sau online, cu cardul, unde această opțiune e afișată.
4.2. Prețurile sunt în lei și includ TVA, unde e cazul. Stocul e limitat; dacă un produs nu mai e disponibil, te anunțăm și nu plătești pentru el.
4.3. Dreptul de retragere: pentru produsele cumpărate prin Aplicație ai 14 zile calendaristice de la ridicare ca să te retragi din contract, fără să dai vreun motiv, anunțându-ne la {email} sau la salon. Îți returnăm banii în cel mult 14 zile de la primirea produsului înapoi, prin aceeași metodă de plată. Produsul trebuie returnat în starea în care l-ai primit. Nu se pot returna produsele sigilate care nu mai pot fi returnate din motive de igienă sau sănătate, dacă au fost desigilate (art. 16 lit. e din OUG 34/2014).
4.4. Garanția de conformitate se aplică potrivit legii (OUG 140/2021).

5. Carduri cadou
5.1. Cardul cadou are o valoare în lei și se poate folosi la salon, integral sau parțial, pentru servicii și produse, până la data de expirare afișată. Nu se schimbă în bani și nu se înlocuiește dacă e pierdut codul, decât dacă poți dovedi cumpărarea.
5.2. Ai 14 zile de la cumpărare ca să te retragi, dacă cardul nu a fost folosit deloc; îți returnăm integral suma plătită.

6. Abonamente
6.1. Abonamentul îți dă dreptul la numărul de servicii și la perioada afișate la cumpărare. Serviciile nefolosite până la expirare nu se reportează și nu se returnează în bani, dacă nu se precizează altfel.
6.2. Ai 14 zile de la cumpărare ca să te retragi. Dacă ai folosit deja servicii din abonament în acest timp, îți returnăm suma rămasă după scăderea valorii serviciilor folosite, la prețul lor standard.
6.3. Abonamentul este personal și nu poate fi transferat.

7. Bonusuri și recomandări
Bonusurile (de exemplu pentru recomandarea unui prieten sau de ziua ta) sunt oferite gratuit, au condițiile și valabilitatea afișate în Aplicație și nu se pot schimba în bani. Ne rezervăm dreptul de a anula bonusurile obținute prin fraudă (de exemplu conturi false).

8. Plata online
Plățile online cu cardul sunt procesate de Stripe Payments Europe Ltd. Noi nu vedem și nu păstrăm datele cardului tău. Rambursările se fac pe același card.

9. Comunicări
Îți trimitem mesaje legate de serviciu (codul de intrare, confirmarea, reamintirea sau anularea programării, comanda gata de ridicare). Ofertele și noutățile le primești doar dacă ți-ai dat acordul separat, pe care îl poți retrage oricând din Cont.

10. Conținutul Aplicației
Textele, logo-ul, pozele și designul Aplicației ne aparțin sau le folosim cu drept de folosință. Pozele „înainte și după” cu tine se publică doar cu acordul tău.

11. Răspundere
Ne străduim ca Aplicația să funcționeze fără întreruperi, dar pot exista pauze pentru mentenanță sau probleme tehnice. Nu răspundem pentru pagube indirecte cauzate de imposibilitatea temporară de a folosi Aplicația. Nimic din acești Termeni nu limitează drepturile pe care le ai prin lege ca și consumator.

12. Reclamații și litigii
Ne poți trimite orice reclamație la {email} sau la salon; îți răspundem în cel mult 30 de zile. Dacă nu ești mulțumit de răspuns, te poți adresa Autorității Naționale pentru Protecția Consumatorilor (ANPC, www.anpc.ro) sau poți apela la soluționarea alternativă a litigiilor (SAL), potrivit OG 38/2015 (informații pe www.anpc.ro/ce-este-sal/). Legea aplicabilă este legea română; litigiile se soluționează de instanțele competente din România, fără a-ți afecta dreptul de a te adresa instanței de la domiciliul tău.

13. Modificări
Putem actualiza acești Termeni. Versiunea curentă e mereu în Aplicație, cu data ultimei actualizări. Pentru schimbări importante te anunțăm în Aplicație sau pe e-mail înainte să intre în vigoare.

Contact: {company}, {seat} · {email} · {phone}`;

const PRIVACY_RO = `Ultima actualizare: {updated}

Această politică explică ce date personale prelucrăm când folosești aplicația și site-ul {name} („Aplicația”), de ce, cât timp le păstrăm și ce drepturi ai, potrivit Regulamentului (UE) 2016/679 („GDPR”).

1. Operatorul datelor
{company}, sediul în {seat}, CUI {cui}, Reg. Com. {regcom} („noi”). Pentru orice întrebare despre datele tale ne scrii la {email} sau ne suni la {phone}.

2. Ce date prelucrăm
• Date de cont: nume, număr de telefon, adresă de e-mail, data nașterii, limba aleasă.
• Programări: serviciul, frizerul, data și ora, starea (încheiată, neprezentare, anulată), plata la salon (sumă, metodă, bacșiș) și notițele interne ale echipei despre serviciu.
• TAF Identity (opțional): poza de profil și preferințele pe care le completezi tu; pozele făcute de echipă la salon pentru fișa ta și, doar cu acordul tău, poze „înainte și după”. Tot doar cu acordul tău (păstrăm data și cine din echipă l-a înregistrat), o pereche „înainte și după” poate fi arătată altor clienți, ca exemplu, în consilierul AI de tunsori; vezi asta în Aplicație (Cont → Tunsorile mele) și o poți opri oricând de acolo.
• Consilierul AI de tunsori (opțional): poza pe care o faci pentru analiză e trimisă serviciului Workers AI (Cloudflare), care descrie fața și părul ca să îți propună servicii ale salonului. Poza nu se salvează nicăieri și nu e văzută de echipă; păstrăm doar numărul de analize pe zi.
• Cumpărături: comenzi din magazin, carduri cadou, abonamente, bonusuri și recomandări (cine te-a recomandat și pe cine ai recomandat).
• Plăți online: identificatorul tranzacției și suma. Datele cardului sunt prelucrate direct de Stripe; noi nu le vedem.
• Comunicări: acordul pentru oferte (cu data), identificatorul dispozitivului pentru notificări push, jurnalul mesajelor trimise (tip, dată, stare).
• Date tehnice: date necesare funcționării (de exemplu sesiunea de conectare, adresa IP în jurnalele serverului, pentru securitate). Când accepți termenii și politica de confidențialitate sau îți dai ori îți retragi acordul pentru oferte, păstrăm dovada: data și ora, versiunea documentelor, adresa IP, tipul dispozitivului (browser sau aplicație) și limba. Nu folosim cookie-uri de urmărire sau publicitate și nu folosim instrumente de analiză care te urmăresc între aplicații.

3. De ce și pe ce temei
• Crearea contului, programările, comenzile, cardurile cadou și abonamentele: executarea contractului cu tine (art. 6 alin. 1 lit. b GDPR).
• Mesajele de serviciu (cod de intrare, confirmare, reamintire, anulare, comandă gata): executarea contractului și interesul nostru legitim de a reduce neprezentările.
• Oferte, noutăți, „Ne e dor de tine”, anunțuri cu ore libere: doar cu acordul tău (art. 6 alin. 1 lit. a GDPR și Legea 506/2004), pe care îl retragi oricând din Cont, fără să afecteze ce s-a trimis înainte.
• Urarea și bonusul de ziua ta: executarea contractului (programul de bonusuri din Aplicație); poți renunța scriindu-ne.
• Pozele „înainte și după” și arătarea lor ca exemplu altor clienți: acordul tău, pe care îl retragi oricând.
• Analiza pozei în consilierul AI de tunsori: acordul tău, dat în Aplicație înainte de fiecare analiză.
• Evidența financiar-contabilă (încasări, bonuri, NIR): obligație legală (art. 6 alin. 1 lit. c GDPR).
• Securitatea Aplicației și prevenirea fraudelor (de exemplu limitarea codurilor trimise): interesul nostru legitim.
• Dovada acordurilor tale (termeni, confidențialitate, oferte): obligația legală de a putea demonstra acordul (art. 7 alin. 1 și art. 6 alin. 1 lit. c GDPR).
Nu luăm decizii automate cu efecte juridice asupra ta și nu facem profilare în acest sens.

4. Cât timp păstrăm datele
• Datele de cont și istoricul: cât timp ai cont.
• La ștergerea contului: numele, telefonul, e-mailul, data nașterii, pozele, notițele și preferințele se șterg imediat. Din dovada acordurilor rămâne doar data și ce ai acceptat, fără adresa IP și fără dispozitiv, ca să putem arăta că acordul a existat. Programările și încasările rămân anonimizate (fără date despre tine), pentru evidența contabilă.
• Documentele financiar-contabile: pe durata cerută de legislația contabilă și fiscală.
• Codurile de intrare: câteva minute, până expiră.

5. Cui transmitem datele
Nu vindem datele tale. Le transmitem doar furnizorilor care ne ajută să livrăm serviciul, cu contracte care îi obligă să le protejeze:
• Cloudflare, Inc. (găzduire, bază de date, securitate, traducerea automată și analiza pozelor din consilierul AI de tunsori);
• SMSAdvert (trimiterea SMS-urilor, România);
• Resend (trimiterea e-mailurilor);
• Expo (650 Industries) și serviciile de notificări Apple și Google (notificări push);
• Stripe Payments Europe Ltd. (plăți online, doar dacă plătești online).
Unii furnizori pot prelucra date în afara Spațiului Economic European (de exemplu în SUA). În aceste cazuri transferul se face pe baza deciziei de adecvare UE-SUA (EU-U.S. Data Privacy Framework) sau a clauzelor contractuale standard aprobate de Comisia Europeană.
Putem divulga date autorităților doar când legea ne obligă.

6. Drepturile tale
Ai dreptul: de acces la date; la rectificare; la ștergere („dreptul de a fi uitat”); la restricționarea prelucrării; la portabilitate; de opoziție (inclusiv oricând față de marketing); de a-ți retrage acordul oricând.
Din Aplicație poți, singur: să îți modifici datele (Cont), să îți descarci datele (Cont → Descarcă datele mele), să oprești ofertele și să îți ștergi contul (Cont → Șterge contul sau {deleteUrl}). Pentru restul ne scrii la {email}; îți răspundem în cel mult o lună.
Ai dreptul să depui plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), www.dataprotection.ro, B-dul G-ral. Gheorghe Magheru 28-30, București.

7. Copii
Aplicația nu se adresează copiilor sub 16 ani. Pentru serviciile pentru copii, programarea o face părintele sau tutorele, din contul lui.

8. Securitate
Folosim conexiuni criptate (HTTPS), acces pe bază de cont și drepturi pentru echipă (de exemplu un frizer nu vede telefonul și e-mailul clienților dacă nu are acest drept), coduri de unică folosință cu limită de încercări și copii de siguranță.

9. Modificări
Putem actualiza această politică; versiunea curentă e mereu în Aplicație, cu data ultimei actualizări. Pentru schimbări importante te anunțăm înainte.

Contact pentru date personale: {company} · {email} · {phone}`;

/** Data ultimei schimbări a fiecărui model de mai sus (apare ca „Ultima actualizare” cât timp nu e editat în panou). */
const TEMPLATE_DATE: Record<Doc, string> = { terms: '2026-10-09', privacy: '2026-10-10' };

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

// Bucățile scrise de server în text, în limba cititorului.
const FILL: Record<'ro' | 'en' | 'fr', { todo: string; policy: (h: number) => string; what: Record<string, string> }> = {
  ro: {
    todo: 'de completat',
    policy: (h) => `Poți anula din aplicație cu cel puțin ${h} ore înainte.`,
    what: { company: 'denumirea firmei', cui: 'CUI', regcom: 'nr. Registrul Comerțului', seat: 'sediul social', email: 'e-mail de contact', phone: 'telefon', address: 'adresa salonului' },
  },
  en: {
    todo: 'to be completed',
    policy: (h) => `You can cancel in the app at least ${h} hours in advance.`,
    what: { company: 'company name', cui: 'tax ID', regcom: 'trade register no.', seat: 'registered office', email: 'contact e-mail', phone: 'phone', address: 'salon address' },
  },
  fr: {
    todo: 'à compléter',
    policy: (h) => `Vous pouvez annuler dans l’application au moins ${h} heures à l’avance.`,
    what: { company: 'nom de la société', cui: 'code fiscal', regcom: 'n° registre du commerce', seat: 'siège social', email: 'e-mail de contact', phone: 'téléphone', address: 'adresse du salon' },
  },
};

/** Textul românesc de bază al unui regulament (cel salvat în panou sau modelul), înainte de completarea datelor firmei. */
export async function legalBase(env: Env, doc: Doc, store?: LegalStore): Promise<Version> {
  const s = store ?? (await getLegal(env));
  return s[doc]?.versions?.ro ?? DEFAULTS[doc];
}

/** Textul gata de afișat: din panou sau modelul implicit, tradus dacă se poate, cu datele salonului completate. */
export async function legalDoc(env: Env, doc: Doc, lang: string) {
  const [store, biz] = await Promise.all([getLegal(env), getBusiness(env)]);
  const v = store[doc]?.versions ?? {};
  const base = await legalBase(env, doc, store);
  const want = langOf(lang);
  let chosen = base;
  let shown: 'ro' | 'en' | 'fr' = 'ro';
  if (want !== 'ro') {
    const m = await lookup(env, want, [base.title, base.body]);
    const body = m.get(base.body);
    if (body) {
      chosen = { title: m.get(base.title) ?? base.title, body };
      shown = want;
    }
  }
  const f = FILL[shown];
  const contact = [biz.phone, biz.address, biz.website].filter(Boolean).join(' · ') || biz.name;
  const b = biz as typeof biz & Partial<Record<'legalName' | 'cui' | 'regCom' | 'legalAddress' | 'legalEmail', string>>;
  const todo = (v: string | undefined, what: string) => (v?.trim() ? v.trim() : `[${f.todo}: ${f.what[what]}]`);
  const updated = store[doc]?.updatedAt ?? TEMPLATE_DATE[doc];
  const publicBase = (env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const policy = biz.cancellationPolicy ? await localizeText(env, shown, biz.cancellationPolicy) : f.policy(biz.cancelHours);
  const fill = (s: string) =>
    s
      .replaceAll('{name}', biz.name)
      .replaceAll('{contact}', contact)
      .replaceAll('{company}', todo(b.legalName, 'company'))
      .replaceAll('{cui}', todo(b.cui, 'cui'))
      .replaceAll('{regcom}', todo(b.regCom, 'regcom'))
      .replaceAll('{seat}', todo(b.legalAddress, 'seat'))
      .replaceAll('{email}', todo(b.legalEmail, 'email'))
      .replaceAll('{phone}', todo(biz.phone, 'phone'))
      .replaceAll('{address}', todo(biz.address, 'address'))
      .replaceAll('{deleteUrl}', `${publicBase || 'https://app.tafbarbers.ro'}/sterge-cont`)
      .replaceAll('{updated}', updated.slice(0, 10).split('-').reverse().join('.'))
      .replaceAll('{policy}', policy);
  // `lang` = limba în care e textul; `translated` = traducere automată (aplicația arată că varianta oficială e în română).
  return { doc, title: fill(chosen.title), body: fill(chosen.body), updatedAt: store[doc]?.updatedAt ?? null, isDefault: !v.ro, lang: shown, translated: shown !== 'ro' };
}

export const defaultLegal = DEFAULTS;

/**
 * Versiunea termenilor și a politicii de confidențialitate în acest moment, pentru dovada acordului: data și ora exactă a
 * ultimei salvări din panou (două corecturi în aceeași zi sunt versiuni diferite), sau data modelului implicit.
 */
export async function legalVersions(env: Env): Promise<Record<Doc, string>> {
  const store = await getLegal(env);
  const v = (d: Doc) => store[d]?.updatedAt ?? TEMPLATE_DATE[d];
  return { terms: v('terms'), privacy: v('privacy') };
}
