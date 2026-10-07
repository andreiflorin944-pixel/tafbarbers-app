// Textele SMS. Fără diacritice: un SMS cu diacritice are 70 de caractere în loc de 160.

type Kind = 'otp' | 'confirm' | 'cancel' | 'reminder_24h' | 'reminder_2h' | 'order_ready';
type Vars = Record<string, string>;

const T: Record<string, Record<Kind, string>> = {
  ro: {
    otp: 'Codul tau {shop}: {code}. Expira in 10 minute.',
    confirm: 'Programare confirmata la {shop}: {service}, {when}, cu {barber}. Te asteptam!',
    cancel: 'Programarea ta la {shop} din {when} a fost anulata. Ne pare rau! Poti reprograma din aplicatie.',
    reminder_24h: 'Reminder {shop}: maine, {when}, ai programare la {barber}. Daca nu poti ajunge, anuleaz-o din aplicatie.',
    reminder_2h: 'Te asteptam la {shop} in curand: {when}, cu {barber}.',
    order_ready: 'Comanda ta {code} de la {shop} e gata. O poti ridica din salon, plata la ridicare.',
  },
  en: {
    otp: 'Your {shop} code: {code}. It expires in 10 minutes.',
    confirm: 'Booking confirmed at {shop}: {service}, {when}, with {barber}. See you!',
    cancel: 'Your {shop} booking on {when} was cancelled. Sorry! You can rebook in the app.',
    reminder_24h: 'Reminder from {shop}: tomorrow, {when}, with {barber}. Cannot make it? Cancel in the app.',
    reminder_2h: 'See you soon at {shop}: {when}, with {barber}.',
    order_ready: 'Your {shop} order {code} is ready. Pick it up at the shop and pay there.',
  },
  fr: {
    otp: 'Votre code {shop} : {code}. Il expire dans 10 minutes.',
    confirm: 'Rendez-vous confirme chez {shop} : {service}, {when}, avec {barber}. A bientot !',
    cancel: 'Votre rendez-vous chez {shop} du {when} a ete annule. Desole ! Reprenez RDV dans l app.',
    reminder_24h: 'Rappel {shop} : demain, {when}, avec {barber}. Empeche ? Annulez dans l app.',
    reminder_2h: 'A tout a l heure chez {shop} : {when}, avec {barber}.',
    order_ready: 'Votre commande {code} chez {shop} est prete. Retrait et paiement au salon.',
  },
};

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
    .replace(/[–—]/g, '-');

export function msg(lang: string, kind: Kind, vars: Vars): string {
  let s = (T[lang] ?? T.ro)[kind];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return strip(s);
}

const EMAIL_OTP: Record<string, { subject: string; intro: string; expires: string; ignore: string }> = {
  ro: {
    subject: 'Codul tău {shop}: {code}',
    intro: 'Codul pentru contul tău {shop} este:',
    expires: 'Codul expiră în 10 minute.',
    ignore: 'Dacă nu tu ai cerut codul, poți ignora acest e-mail.',
  },
  en: {
    subject: 'Your {shop} code: {code}',
    intro: 'The code for your {shop} account is:',
    expires: 'The code expires in 10 minutes.',
    ignore: 'If you did not ask for this code, you can ignore this e-mail.',
  },
  fr: {
    subject: 'Votre code {shop} : {code}',
    intro: 'Le code de votre compte {shop} est :',
    expires: 'Le code expire dans 10 minutes.',
    ignore: 'Si vous n’avez pas demandé ce code, ignorez cet e-mail.',
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** E-mailul cu codul de intrare (cont nou sau recuperare). */
export function otpEmail(lang: string, shop: string, code: string, tpl?: { subject: string; intro: string }): { subject: string; html: string } {
  const t = EMAIL_OTP[lang] ?? EMAIL_OTP.ro;
  const fill = (s: string) => s.replaceAll('{shop}', shop).replaceAll('{code}', code);
  return {
    subject: tpl?.subject || fill(t.subject),
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#222">
<p>${esc(tpl?.intro || fill(t.intro))}</p>
<p style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:16px 0">${code}</p>
<p>${esc(t.expires)}</p>
<p style="color:#777;font-size:13px">${esc(t.ignore)}</p>
</div>`,
  };
}
