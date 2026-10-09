// Textele e-mailului cu codul de intrare (restul mesajelor sunt șabloane editabile, în templates.ts).

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
