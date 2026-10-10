import { getSetting, setSetting } from './db';
import { HttpError, type Env } from './env';
import { autoTranslate, type Texts3 } from './translate';

// Șabloanele mesajelor automate (cod de intrare, programări, comenzi, abonamente), pe canale: SMS, push, e-mail.
// Adminul le scrie în română, cu variabile de tipul ##customerfirstname##; engleza și franceza se traduc singure.

export type TplEvent = 'otp' | 'confirm' | 'cancel' | 'booking_request' | 'booking_request_refused' | 'booking_request_expired' | 'waitlist_slot' | 'reminder_24h' | 'reminder_2h' | 'review' | 'order_created' | 'order_ready' | 'order_ready_paid' | 'order_cancelled' | 'sub_started' | 'pay_request';
export type TplField = 'sms' | 'pushTitle' | 'pushBody' | 'emailSubject' | 'emailBody';
type Lang = 'ro' | 'en' | 'fr';
type Stored = Partial<Record<TplEvent, Partial<Record<TplField, Texts3>>>>;

export const WILDCARDS: Record<string, string> = {
  businessname: 'numele salonului',
  customerfullname: 'numele clientului',
  customerfirstname: 'prenumele clientului',
  servicename: 'serviciul',
  barbername: 'frizerul',
  datetime: 'data și ora programării',
  code: 'codul de intrare',
  ordernumber: 'numărul comenzii',
  reviewlink: 'linkul de recenzie Google',
  membershipplanname: 'numele abonamentului',
  enddate: 'data până la care e valabil abonamentul',
  reason: 'motivul refuzului',
  times: 'orele eliberate (ex. 14:30, 15:00)',
  booklink: 'linkul care deschide programarea în aplicație',
  locationname: 'numele locației',
  locationaddress: 'adresa locației',
  location: 'locația și adresa (doar când salonul are mai multe locații; altfel nu apare nimic)',
  amount: 'suma de plătit (ex. 80 lei)',
  paylink: 'linkul care deschide aplicația la plată',
};

const BOOKING = ['businessname', 'customerfullname', 'customerfirstname', 'servicename', 'barbername', 'datetime', 'locationname', 'locationaddress', 'location'];
const ORDER = ['businessname', 'customerfullname', 'customerfirstname', 'ordernumber'];

type Def = { label: string; vars: string[]; fields: TplField[]; ro: Partial<Record<TplField, string>>; en?: Partial<Record<TplField, string>>; fr?: Partial<Record<TplField, string>> };

/** Textele de pornire; cele de SMS în engleză și franceză sunt cele folosite până acum. */
export const TEMPLATE_DEFS: Record<TplEvent, Def> = {
  otp: {
    label: 'Codul de intrare în cont',
    vars: ['businessname', 'code'],
    fields: ['sms', 'emailSubject', 'emailBody'],
    ro: { sms: 'Codul tău ##businessname##: ##code##. Expiră în 10 minute.', emailSubject: 'Codul tău de confirmare ##businessname##', emailBody: 'Codul pentru contul tău ##businessname## este:' },
    en: { sms: 'Your ##businessname## code: ##code##. It expires in 10 minutes.', emailSubject: 'Your ##businessname## confirmation code', emailBody: 'The code for your ##businessname## account is:' },
    fr: { sms: 'Votre code ##businessname## : ##code##. Il expire dans 10 minutes.', emailSubject: 'Votre code de confirmation ##businessname##', emailBody: 'Le code de votre compte ##businessname## est :' },
  },
  confirm: {
    label: 'Confirmarea programării',
    vars: BOOKING,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Programare confirmată la ##businessname##: ##servicename##, ##datetime##, cu ##barbername##. ##location## Te așteptăm!',
      pushTitle: 'Programare confirmată',
      pushBody: '##servicename## cu ##barbername##, ##datetime##',
      emailSubject: 'Programare confirmată · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, programarea ta e confirmată: ##servicename## cu ##barbername##, ##datetime##. ##location## Te așteptăm!',
    },
    en: { sms: 'Booking confirmed at ##businessname##: ##servicename##, ##datetime##, with ##barbername##. ##location## See you!' },
    fr: { sms: 'Rendez-vous confirmé chez ##businessname## : ##servicename##, ##datetime##, avec ##barbername##. ##location## À bientôt !' },
  },
  cancel: {
    label: 'Programare anulată de salon',
    vars: BOOKING,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Programarea ta la ##businessname## din ##datetime## a fost anulată. Ne pare rău! Poți reprograma din aplicație.',
      pushTitle: 'Programare anulată',
      pushBody: '##servicename## cu ##barbername##, ##datetime##. Poți alege altă oră din aplicație.',
      emailSubject: 'Programare anulată · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, programarea ta din ##datetime## a fost anulată. Ne pare rău! Poți alege altă oră din aplicație.',
    },
    en: { sms: 'Your ##businessname## booking on ##datetime## was cancelled. Sorry! You can rebook in the app.' },
    fr: { sms: 'Votre rendez-vous chez ##businessname## du ##datetime## a été annulé. Désolé ! Reprenez RDV dans l’app.' },
  },
  booking_request: {
    label: 'Cerere de programare primită (când programările cer aprobare)',
    vars: BOOKING,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Am primit cererea ta la ##businessname##: ##servicename##, ##datetime##, cu ##barbername##. ##location## Îți scriem imediat ce o confirmăm.',
      pushTitle: 'Am primit cererea ta',
      pushBody: '##servicename## cu ##barbername##, ##datetime##. Îți scriem imediat ce o confirmăm.',
      emailSubject: 'Am primit cererea ta · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, am primit cererea ta de programare: ##servicename## cu ##barbername##, ##datetime##. ##location## Ora e rezervată pentru tine; îți scriem imediat ce o confirmăm.',
    },
    en: { sms: 'We got your request at ##businessname##: ##servicename##, ##datetime##, with ##barbername##. ##location## We will text you once it is confirmed.' },
    fr: { sms: 'Demande reçue chez ##businessname## : ##servicename##, ##datetime##, avec ##barbername##. ##location## Nous vous écrivons dès la confirmation.' },
  },
  booking_request_refused: {
    label: 'Cerere de programare refuzată',
    vars: [...BOOKING, 'reason'],
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Ne pare rău, nu putem confirma programarea la ##businessname## din ##datetime##. ##reason## Poți alege altă oră din aplicație.',
      pushTitle: 'Cerere neconfirmată',
      pushBody: 'Nu putem confirma ##servicename##, ##datetime##. ##reason## Alege altă oră din aplicație.',
      emailSubject: 'Nu putem confirma programarea · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, ne pare rău, nu putem confirma programarea din ##datetime## (##servicename## cu ##barbername##). ##reason## Poți alege altă oră din aplicație.',
    },
    en: { sms: 'Sorry, we cannot confirm your ##businessname## booking on ##datetime##. ##reason## Please pick another time in the app.' },
    fr: { sms: 'Désolé, nous ne pouvons pas confirmer votre RDV chez ##businessname## du ##datetime##. ##reason## Choisissez une autre heure dans l’app.' },
  },
  booking_request_expired: {
    label: 'Cerere de programare expirată (salonul n-a răspuns la timp)',
    vars: BOOKING,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Ne pare rău, cererea ta la ##businessname## din ##datetime## n-a putut fi confirmată la timp și s-a anulat. Poți alege altă oră din aplicație.',
      pushTitle: 'Cerere expirată',
      pushBody: 'Cererea pentru ##datetime## n-a fost confirmată la timp. Alege altă oră din aplicație.',
      emailSubject: 'Cererea de programare a expirat · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, ne pare rău, cererea ta pentru ##servicename## cu ##barbername##, ##datetime##, n-a putut fi confirmată la timp și s-a anulat. Poți alege altă oră din aplicație.',
    },
    en: { sms: 'Sorry, your ##businessname## request for ##datetime## could not be confirmed in time and was cancelled. Pick another time in the app.' },
    fr: { sms: 'Désolé, votre demande chez ##businessname## du ##datetime## n’a pas pu être confirmée à temps et a été annulée. Choisissez une autre heure dans l’app.' },
  },
  waitlist_slot: {
    label: 'Listă de așteptare: s-a eliberat un loc',
    vars: [...BOOKING, 'times', 'booklink'],
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'S-a eliberat un loc la ##businessname##: ##servicename##, ##datetime##, cu ##barbername## (ore libere: ##times##). ##location## Rezervă repede: ##booklink##',
      pushTitle: 'S-a eliberat un loc',
      pushBody: '##servicename##, ##datetime## (ore libere: ##times##). Rezervă până nu-l ia altcineva.',
      emailSubject: 'S-a eliberat un loc · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, s-a eliberat un loc în ziua pentru care ai cerut să te anunțăm: ##servicename## cu ##barbername##, ##datetime## (ore libere: ##times##). ##location## Locul nu e rezervat pentru tine, așa că programează-te repede din aplicație: ##booklink##',
    },
    en: { sms: 'A spot opened up at ##businessname##: ##servicename##, ##datetime##, with ##barbername## (free times: ##times##). ##location## Book fast: ##booklink##' },
    fr: { sms: 'Une place s’est libérée chez ##businessname## : ##servicename##, ##datetime##, avec ##barbername## (horaires libres : ##times##). ##location## Réservez vite : ##booklink##' },
  },
  reminder_24h: {
    label: 'Memento cu o zi înainte',
    vars: BOOKING,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Memento ##businessname##: mâine, ##datetime##, ai programare la ##barbername##. ##location## Dacă nu poți ajunge, anuleaz-o din aplicație.',
      pushTitle: 'Programare mâine',
      pushBody: '##servicename## cu ##barbername##, ##datetime##',
      emailSubject: 'Memento programare · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, mâine, ##datetime##, ai programare la ##barbername## pentru ##servicename##. ##location## Dacă nu poți ajunge, anuleaz-o din aplicație.',
    },
    en: { sms: 'Reminder from ##businessname##: tomorrow, ##datetime##, with ##barbername##. ##location## Cannot make it? Cancel in the app.' },
    fr: { sms: 'Rappel ##businessname## : demain, ##datetime##, avec ##barbername##. ##location## Empêché ? Annulez dans l’app.' },
  },
  reminder_2h: {
    label: 'Memento cu 2 ore înainte',
    vars: BOOKING,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Te așteptăm la ##businessname## în curând: ##datetime##, cu ##barbername##. ##location##',
      pushTitle: 'Programare în curând',
      pushBody: '##servicename## cu ##barbername##, ##datetime##',
      emailSubject: 'Te așteptăm în curând · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, te așteptăm în curând: ##datetime##, cu ##barbername##. ##location##',
    },
    en: { sms: 'See you soon at ##businessname##: ##datetime##, with ##barbername##. ##location##' },
    fr: { sms: 'À tout à l’heure chez ##businessname## : ##datetime##, avec ##barbername##. ##location##' },
  },
  review: {
    label: 'Cerere de recenzie după tunsoare',
    vars: [...BOOKING, 'reviewlink'],
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: '##customerfirstname##, mulțumim că ai fost la ##businessname##! Ne lași o recenzie? Durează un minut: ##reviewlink##',
      pushTitle: 'Cum a fost tunsoarea?',
      pushBody: 'Ne lași o recenzie pe Google? Durează un minut.',
      emailSubject: 'Vă mulțumim că ne-ați vizitat!',
      emailBody: 'Salut ##customerfirstname##, mulțumim că ai fost la ##businessname##! Ne lași o recenzie? Durează un minut: ##reviewlink##',
    },
  },
  order_created: {
    label: 'Comandă primită (magazin)',
    vars: ORDER,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Am primit comanda ta ##ordernumber## la ##businessname##. Îți scriem când e gata de ridicare.',
      pushTitle: 'Comandă primită',
      pushBody: 'Comanda ##ordernumber## e înregistrată. Îți scriem când e gata de ridicare.',
      emailSubject: 'Comandă primită · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, am primit comanda ta ##ordernumber##. Îți scriem când e gata de ridicare din salon.',
    },
  },
  order_ready: {
    label: 'Comanda e gata de ridicare',
    vars: ORDER,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Comanda ta ##ordernumber## de la ##businessname## e gata. O poți ridica din salon, plata la ridicare.',
      pushTitle: 'Comanda ta e gata',
      pushBody: 'Comanda ##ordernumber## te așteaptă în salon. Plata la ridicare.',
      emailSubject: 'Comanda ta e gata · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, comanda ta ##ordernumber## e gata. O poți ridica din salon, plata la ridicare.',
    },
    en: { sms: 'Your ##businessname## order ##ordernumber## is ready. Pick it up at the shop and pay there.' },
    fr: { sms: 'Votre commande ##ordernumber## chez ##businessname## est prête. Retrait et paiement au salon.' },
  },
  order_ready_paid: {
    label: 'Comanda e gata de ridicare (plătită deja online)',
    vars: ORDER,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Comanda ta ##ordernumber## de la ##businessname## e gata. E plătită deja; o poți ridica din salon.',
      pushTitle: 'Comanda ta e gata',
      pushBody: 'Comanda ##ordernumber## te așteaptă în salon. E plătită deja.',
      emailSubject: 'Comanda ta e gata · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, comanda ta ##ordernumber## e gata. Ai plătit-o deja online, deci doar treci s-o ridici din salon.',
    },
    en: {
      sms: 'Your ##businessname## order ##ordernumber## is ready. It is already paid; pick it up at the shop.',
      pushTitle: 'Your order is ready',
      pushBody: 'Order ##ordernumber## is waiting for you at the shop. Already paid.',
      emailSubject: 'Your order is ready · ##businessname##',
      emailBody: 'Hi ##customerfirstname##, your order ##ordernumber## is ready. You already paid online, so just drop by the shop to pick it up.',
    },
    fr: {
      sms: 'Votre commande ##ordernumber## chez ##businessname## est prête. Elle est déjà payée ; retirez-la au salon.',
      pushTitle: 'Votre commande est prête',
      pushBody: 'La commande ##ordernumber## vous attend au salon. Déjà payée.',
      emailSubject: 'Votre commande est prête · ##businessname##',
      emailBody: 'Bonjour ##customerfirstname##, votre commande ##ordernumber## est prête. Vous l’avez déjà payée en ligne : passez simplement la retirer au salon.',
    },
  },
  order_cancelled: {
    label: 'Comandă anulată (magazin)',
    vars: ORDER,
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Comanda ta ##ordernumber## de la ##businessname## a fost anulată. Pentru întrebări, sună-ne.',
      pushTitle: 'Comandă anulată',
      pushBody: 'Comanda ##ordernumber## a fost anulată.',
      emailSubject: 'Comandă anulată · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, comanda ta ##ordernumber## a fost anulată. Pentru întrebări, sună-ne.',
    },
  },
  sub_started: {
    label: 'Abonament activat',
    vars: ['businessname', 'customerfullname', 'customerfirstname', 'membershipplanname', 'enddate'],
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: 'Bun venit la ##membershipplanname##, ##customerfirstname##! Abonamentul tău ##businessname## e activ până pe ##enddate##.',
      pushTitle: 'Bun venit la ##membershipplanname##!',
      pushBody: 'Abonamentul tău e activ până pe ##enddate##. Îl vezi în aplicație, la Abonamente.',
      emailSubject: 'Bun venit la ##membershipplanname##!',
      emailBody: 'Salut ##customerfirstname##, abonamentul tău ##membershipplanname## la ##businessname## e activ până pe ##enddate##.',
    },
  },
  pay_request: {
    label: 'Cerere de plată în aplicație (trimisă de echipă)',
    vars: [...BOOKING, 'amount', 'paylink'],
    fields: ['sms', 'pushTitle', 'pushBody', 'emailSubject', 'emailBody'],
    ro: {
      sms: '##businessname##: ai de plătit ##amount## pentru ##servicename## (##datetime##). Plătește din aplicație, cu cardul: ##paylink##',
      pushTitle: 'Plătește programarea: ##amount##',
      pushBody: '##servicename##, ##datetime##. Deschide aplicația și apasă „Plătește acum”.',
      emailSubject: 'Plătește programarea: ##amount## · ##businessname##',
      emailBody: 'Salut ##customerfirstname##, ai de plătit ##amount## pentru ##servicename## cu ##barbername##, ##datetime##. Deschide aplicația și apasă „Plătește acum” (card, Apple Pay sau Google Pay): ##paylink##',
    },
    en: {
      sms: '##businessname##: you have ##amount## to pay for ##servicename## (##datetime##). Pay by card in the app: ##paylink##',
      pushTitle: 'Pay for your booking: ##amount##',
      pushBody: '##servicename##, ##datetime##. Open the app and tap “Pay now”.',
      emailSubject: 'Pay for your booking: ##amount## · ##businessname##',
      emailBody: 'Hi ##customerfirstname##, you have ##amount## to pay for ##servicename## with ##barbername##, ##datetime##. Open the app and tap “Pay now” (card, Apple Pay or Google Pay): ##paylink##',
    },
    fr: {
      sms: '##businessname## : vous avez ##amount## à payer pour ##servicename## (##datetime##). Payez par carte dans l’app : ##paylink##',
      pushTitle: 'Payez votre rendez-vous : ##amount##',
      pushBody: '##servicename##, ##datetime##. Ouvrez l’app et appuyez sur « Payer maintenant ».',
      emailSubject: 'Payez votre rendez-vous : ##amount## · ##businessname##',
      emailBody: 'Bonjour ##customerfirstname##, vous avez ##amount## à payer pour ##servicename## avec ##barbername##, ##datetime##. Ouvrez l’app et appuyez sur « Payer maintenant » (carte, Apple Pay ou Google Pay) : ##paylink##',
    },
  },
};

export const TEMPLATE_EVENTS = Object.keys(TEMPLATE_DEFS) as TplEvent[];
const MAX: Record<TplField, number> = { sms: 300, pushTitle: 80, pushBody: 240, emailSubject: 150, emailBody: 2000 };

const getStored = (env: Env) => getSetting<Stored>(env, 'templates', {});

function defaultText(e: TplEvent, f: TplField, lang: Lang): string {
  const d = TEMPLATE_DEFS[e];
  return d[lang]?.[f] ?? d.ro[f] ?? '';
}

/** Șabloanele pentru panou: textul salvat sau cel de pornire, pe fiecare limbă. */
export async function listTemplates(env: Env) {
  const s = await getStored(env);
  return TEMPLATE_EVENTS.map((e) => ({
    event: e,
    label: TEMPLATE_DEFS[e].label,
    vars: TEMPLATE_DEFS[e].vars,
    fields: Object.fromEntries(
      TEMPLATE_DEFS[e].fields.map((f) => {
        const v = s[e]?.[f];
        return [f, v?.ro ? { ro: v.ro, en: v.en || v.ro, fr: v.fr || v.ro, custom: true, max: MAX[f] } : { ro: defaultText(e, f, 'ro'), en: defaultText(e, f, 'en'), fr: defaultText(e, f, 'fr'), custom: false, max: MAX[f] }];
      }),
    ),
  }));
}

/** Salvează textele în română ale unui șablon (gol = revine la textul de pornire); engleza și franceza se traduc singure. */
export async function saveTemplate(env: Env, e: TplEvent, patch: Partial<Record<TplField, string | null>>) {
  const def = TEMPLATE_DEFS[e];
  if (!def) throw new HttpError(404, 'not_found');
  const s = await getStored(env);
  const cur = { ...(s[e] ?? {}) };
  for (const f of def.fields) {
    if (!(f in patch)) continue;
    const ro = (patch[f] ?? '').trim();
    if (!ro || ro === defaultText(e, f, 'ro')) {
      delete cur[f];
      continue;
    }
    if (ro.length > MAX[f]) throw new HttpError(400, 'text_too_long');
    const unknown = [...ro.matchAll(/##([a-z_]+)##/g)].map((m) => m[1]).filter((v) => !def.vars.includes(v));
    if (unknown.length) throw new HttpError(400, 'unknown_wildcard');
    // Româna neschimbată (panoul trimite toate câmpurile): traducerile rămân cum erau, nu se refac (și nu se pierd dacă AI-ul nu răspunde).
    if (cur[f]?.ro === ro) continue;
    cur[f] = await autoTranslate(env, cur[f], { ro, en: '', fr: '' });
  }
  await setSetting(env, 'templates', { ...s, [e]: cur });
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
    .replace(/[–—]/g, '-')
    .replace(/[„”“]/g, '"')
    .replace(/[’‘]/g, "'");

export type Rendered = Record<TplField, string>;

/** Textele gata de trimis pentru un client (în limba lui). SMS-ul pleacă fără diacritice: altfel încap doar 70 de caractere. */
export async function renderTemplate(env: Env, e: TplEvent, lang: string, vars: Record<string, string>): Promise<Rendered> {
  const l: Lang = lang === 'en' || lang === 'fr' ? lang : 'ro';
  const s = (await getStored(env))[e] ?? {};
  const fill = (t: string) => t.replace(/##([a-z_]+)##/g, (m, k: string) => vars[k] ?? '').replace(/\s+([,.!?])/g, '$1').replace(/ {2,}/g, ' ').trim();
  const pick = (f: TplField) => {
    const v = s[f];
    // O limbă netradusă încă (AI indisponibil) folosește româna salvată, nu textul vechi.
    return v ? v[l] || v.ro : defaultText(e, f, l);
  };
  return {
    sms: strip(fill(pick('sms'))),
    pushTitle: fill(pick('pushTitle')),
    pushBody: fill(pick('pushBody')),
    emailSubject: fill(pick('emailSubject')),
    emailBody: fill(pick('emailBody')),
  };
}
