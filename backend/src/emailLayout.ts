// Aspectul comun al tuturor e-mailurilor TAF Barbers: antet negru cu logo, titlu, text, casetă de detalii,
// cod mare (la intrare în cont), card cadou, buton auriu, subsol cu telefonul salonului și dezabonare (la oferte).
// Construit cu tabele și stiluri în linie, ca să arate la fel în Gmail, Outlook, Apple Mail și Yahoo, pe telefon întâi.

import { getBusiness } from './db';
import type { Env } from './env';
import { sendEmail } from './notify';

type Lang = 'ro' | 'en' | 'fr';
export type EmailTheme = 'dark' | 'light';

export type EmailParts = {
  lang?: string;
  shop: string;
  title: string;
  /** Rândul gri pe care îl arată căsuța de mail lângă subiect. */
  preheader?: string;
  body: string;
  /** true = mesaj despre cont/programare; false = ofertă (cere link de dezabonare). */
  transactional: boolean;
  details?: Array<[string, string]>;
  code?: string;
  gift?: { amount: string; code: string };
  button?: { label: string; url: string };
  logoUrl: string;
  siteUrl?: string;
  unsubscribeUrl?: string;
  footer: { phone?: string; email?: string };
  theme?: EmailTheme;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const T: Record<Lang, { tx: string; mk: string; unsub: string; codeHint: string; giftLabel: string; giftCode: string; phone: string }> = {
  ro: {
    tx: 'Primești acest e-mail pentru că ai cont la',
    mk: 'Primești acest e-mail pentru că ai acceptat ofertele',
    unsub: 'Nu mai vreau oferte pe e-mail',
    codeHint: 'Codul expiră în 10 minute.',
    giftLabel: 'CARD CADOU',
    giftCode: 'Cod',
    phone: 'Tel.',
  },
  en: {
    tx: 'You are receiving this e-mail because you have an account at',
    mk: 'You are receiving this e-mail because you accepted offers from',
    unsub: 'Unsubscribe from offers',
    codeHint: 'The code expires in 10 minutes.',
    giftLabel: 'GIFT CARD',
    giftCode: 'Code',
    phone: 'Phone',
  },
  fr: {
    tx: 'Vous recevez cet e-mail parce que vous avez un compte chez',
    mk: 'Vous recevez cet e-mail parce que vous avez accepté les offres de',
    unsub: 'Ne plus recevoir d’offres',
    codeHint: 'Le code expire dans 10 minutes.',
    giftLabel: 'CARTE CADEAU',
    giftCode: 'Code',
    phone: 'Tél.',
  },
};

const PALETTE = {
  dark: { page: '#000000', card: '#111112', line: '#2A2A2D', title: '#FFFFFF', text: '#E6E3DD', muted: '#9C988F', box: '#1A1A1C', link: '#F9A11B' },
  light: { page: '#F2EFE9', card: '#FFFFFF', line: '#E8E2D6', title: '#111111', text: '#2B2925', muted: '#7A756C', box: '#FAF6EE', link: '#B87410' },
};
const GOLD = '#F9A11B';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** Linkurile din text devin clicabile (aurii), fără adresa lungă la vedere. */
function textHtml(body: string, link: string) {
  const parts = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return parts
    .map((p) => {
      const h = esc(p)
        .replace(/https?:\/\/[^\s<]+[^\s<.,!?;:)]/g, (u) => {
          const short = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
          return `<a href="${u}" style="color:${link};text-decoration:underline">${short}</a>`;
        })
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 14px">${h}</p>`;
    })
    .join('');
}

export function emailLayout(o: EmailParts): string {
  const lang = (['ro', 'en', 'fr'].includes(o.lang ?? '') ? o.lang : 'ro') as Lang;
  const t = T[lang];
  const c = PALETTE[o.theme ?? 'dark'];
  const shop = esc(o.shop);
  const pre = esc(o.preheader ?? o.body.replace(/https?:\/\/\S+/g, '').slice(0, 110));

  const details = o.details?.length
    ? `<tr><td style="padding:4px 28px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.box};border:1px solid ${c.line};border-radius:14px">
${o.details
  .map(
    ([k, v], i) =>
      `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${c.line};` : ''}font:13px/1.3 ${FONT};color:${c.muted};width:38%">${esc(k)}</td><td style="padding:12px 16px;${i ? `border-top:1px solid ${c.line};` : ''}font:600 15px/1.35 ${FONT};color:${c.title};text-align:right">${esc(v)}</td></tr>`,
  )
  .join('')}
</table></td></tr>`
    : '';

  const code = o.code
    ? `<tr><td align="center" style="padding:6px 28px 22px"><div style="display:inline-block;background:${c.box};border:1px solid ${GOLD};border-radius:14px;padding:16px 26px;font:700 36px/1 ${FONT};letter-spacing:10px;color:${GOLD}">${esc(o.code)}</div>
<div style="font:13px/1.4 ${FONT};color:${c.muted};padding-top:10px">${t.codeHint}</div></td></tr>`
    : '';

  const gift = o.gift
    ? `<tr><td style="padding:4px 28px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0C;background-image:linear-gradient(135deg,#1C1A16 0%,#0B0B0C 60%);border:1px solid ${GOLD};border-radius:16px">
<tr><td style="padding:20px 22px 6px;font:700 12px/1 ${FONT};letter-spacing:3px;color:${GOLD}">${t.giftLabel} · ${shop.toUpperCase()}</td></tr>
<tr><td style="padding:6px 22px 4px;font:800 40px/1.1 ${FONT};color:#FFFFFF">${esc(o.gift.amount)}</td></tr>
<tr><td style="padding:6px 22px 20px;font:14px/1.4 ${FONT};color:#CFCAC0">${t.giftCode}: <span style="font-weight:700;letter-spacing:2px;color:${GOLD}">${esc(o.gift.code)}</span></td></tr>
</table></td></tr>`
    : '';

  const button = o.button
    ? `<tr><td align="center" style="padding:6px 28px 26px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${GOLD}" style="border-radius:999px">
<a href="${esc(o.button.url)}" style="display:inline-block;padding:15px 34px;font:700 16px/1 ${FONT};color:#000000;text-decoration:none;border-radius:999px">${esc(o.button.label)}</a></td></tr></table></td></tr>`
    : '';

  const f = o.footer;
  const site = o.siteUrl ? `<a href="${esc(o.siteUrl)}" style="color:${c.muted};text-decoration:underline">${esc(o.siteUrl.replace(/^https?:\/\//, ''))}</a>` : '';
  const contact = [f.phone ? `${t.phone} <a href="tel:${esc(f.phone.replace(/\s/g, ''))}" style="color:${c.muted};text-decoration:none">${esc(f.phone)}</a>` : '', f.email ? `<a href="mailto:${esc(f.email)}" style="color:${c.muted};text-decoration:none">${esc(f.email)}</a>` : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const why = `${o.transactional ? t.tx : t.mk} ${shop}.`;
  const unsub = !o.transactional && o.unsubscribeUrl ? `<br><a href="${esc(o.unsubscribeUrl)}" style="color:${c.muted};text-decoration:underline">${t.unsub}</a>` : '';

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="${o.theme === 'light' ? 'light' : 'dark'}"><meta name="supported-color-schemes" content="${o.theme === 'light' ? 'light' : 'dark'}"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${c.page};-webkit-text-size-adjust:100%">
<div data-preheader style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${pre}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.page}"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">
<tr><td align="center" style="background:#000000;border-radius:18px 18px 0 0;padding:26px 20px 22px;border-bottom:2px solid ${GOLD}">
<img src="${esc(o.logoUrl)}" width="86" alt="${shop}" style="display:block;width:86px;height:auto;border:0;outline:none"></td></tr>
<tr><td style="background:${c.card};border-radius:0 0 18px 18px;${o.theme === 'light' ? `border:1px solid ${c.line};border-top:0;` : ''}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font:800 24px/1.25 ${FONT};color:${c.title}">${esc(o.title)}</td></tr>
<tr><td style="padding:8px 28px 6px;font:16px/1.6 ${FONT};color:${c.text}">${textHtml(o.body, c.link)}</td></tr>
${code}${details}${gift}${button}
</table></td></tr>
<tr><td align="center" style="padding:22px 18px 0;font:12px/1.6 ${FONT};color:${c.muted}">
<div style="font:700 13px/1.4 ${FONT};color:${o.theme === 'light' ? c.title : '#FFFFFF'};letter-spacing:1px;padding-bottom:4px">${shop}</div>
${contact ? `${contact}<br>` : ''}${site ? `${site}<br>` : ''}
<div style="padding-top:10px">${why}${unsub}</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ——— Legătura cu restul serverului: datele firmei din panou, logo-ul, dezabonarea și trimiterea ———

export const langKey = (l?: string | null): Lang => (l === 'en' || l === 'fr' ? l : 'ro');

/** Etichetele din caseta de detalii și textele butoanelor, în limba clientului. */
export const EMAIL_WORDS: Record<Lang, Record<string, string>> = {
  ro: {
    service: 'Serviciu', barber: 'Frizer', when: 'Când', price: 'Preț', location: 'Locație', plan: 'Abonament', until: 'Valabil până la',
    amount: 'Sumă', order: 'Comanda', times: 'Ore libere', manage: 'Vezi, mută sau anulează', request: 'Vezi cererea', rebook: 'Alege altă oră',
    book: 'Programează-te acum', bookSlot: 'Rezervă acum', review: '★ Lasă o recenzie', pay: 'Plătește acum', open: 'Deschide aplicația', useGift: 'Folosește cardul',
  },
  en: {
    service: 'Service', barber: 'Barber', when: 'When', price: 'Price', location: 'Location', plan: 'Subscription', until: 'Valid until',
    amount: 'Amount', order: 'Order', times: 'Free times', manage: 'View, move or cancel', request: 'View request', rebook: 'Pick another time',
    book: 'Book now', bookSlot: 'Book now', review: '★ Leave a review', pay: 'Pay now', open: 'Open the app', useGift: 'Use the card',
  },
  fr: {
    service: 'Service', barber: 'Barbier', when: 'Quand', price: 'Prix', location: 'Adresse', plan: 'Abonnement', until: 'Valable jusqu’au',
    amount: 'Montant', order: 'Commande', times: 'Horaires libres', manage: 'Voir, déplacer ou annuler', request: 'Voir la demande', rebook: 'Choisir une autre heure',
    book: 'Réserver', bookSlot: 'Réserver', review: '★ Laisser un avis', pay: 'Payer', open: 'Ouvrir l’application', useGift: 'Utiliser la carte',
  },
};

export const publicBase = (env: Env) => (env.PUBLIC_URL ?? '').replace(/\/+$/, '');

/** Partea de e-mail pe care o completează fiecare mesaj; restul (logo, subsol, dezabonare) vine din setări. */
export type EmailContent = Pick<EmailParts, 'title' | 'body' | 'transactional' | 'preheader' | 'details' | 'code' | 'gift' | 'button'> & { lang?: string | null };

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function unsubSig(env: Env, email: string): Promise<string | null> {
  const secret = env.SOCIAL_KEY || env.ADMIN_SETUP_KEY;
  if (!secret) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`unsub:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.trim().toLowerCase())));
  return b64url(sig.slice(0, 18));
}

/** Linkul „Nu mai vreau oferte pe e-mail” (semnat: nu se poate dezabona altcineva schimbând adresa din link). */
export async function unsubscribeUrl(env: Env, email: string, lang?: string | null): Promise<string | undefined> {
  const base = publicBase(env);
  const t = await unsubSig(env, email);
  if (!base || !t) return undefined;
  return `${base}/dezabonare?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${t}&l=${langKey(lang)}`;
}

export async function unsubscribeValid(env: Env, email: string, t: string): Promise<boolean> {
  const want = await unsubSig(env, email);
  if (!want || want.length !== t.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i);
  return d === 0;
}

/** HTML-ul complet al unui e-mail, cu datele firmei din panou (Setări → Datele firmei). */
export async function brandEmail(env: Env, recipient: string, x: EmailContent): Promise<{ html: string; unsubscribe?: string }> {
  const biz = (await getBusiness(env)) as Awaited<ReturnType<typeof getBusiness>> & { legalEmail?: string };
  const base = publicBase(env);
  const unsubscribe = x.transactional ? undefined : await unsubscribeUrl(env, recipient, x.lang);
  const html = emailLayout({
    ...x,
    lang: langKey(x.lang),
    shop: biz.name,
    logoUrl: `${base || 'https://app.tafbarbers.ro'}/email-logo.png`,
    siteUrl: base || undefined,
    unsubscribeUrl: unsubscribe,
    // Doar telefonul salonului (Setări → Datele salonului), e-mailul de contact și site-ul; fără datele firmei (CUI, Reg. Com.).
    footer: { phone: biz.phone, email: biz.legalEmail },
  });
  return { html, unsubscribe };
}

/** Trimite un e-mail cu aspectul TAF Barbers (ofertele au și antetul de dezabonare dintr-un clic, cerut de Gmail și Yahoo). */
export async function sendBrandEmail(env: Env, log: Parameters<typeof sendEmail>[1], subject: string, x: EmailContent): Promise<boolean> {
  const { html, unsubscribe } = await brandEmail(env, log.recipient, x);
  return sendEmail(env, log, subject, html, unsubscribe ? { unsubscribeUrl: unsubscribe } : undefined);
}
