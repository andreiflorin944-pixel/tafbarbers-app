import type { EmailContent } from './emailLayout';

// Textele e-mailului cu codul de intrare (restul mesajelor sunt șabloane editabile, în templates.ts).

const EMAIL_OTP: Record<string, { subject: string; intro: string; expires: string; ignore: string }> = {
  ro: {
    subject: 'Codul tău de confirmare {shop}',
    intro: 'Codul pentru contul tău {shop} este:',
    expires: 'Codul expiră în 10 minute.',
    ignore: 'Dacă nu tu ai cerut codul, poți ignora acest e-mail.',
  },
  en: {
    subject: 'Your {shop} confirmation code',
    intro: 'The code for your {shop} account is:',
    expires: 'The code expires in 10 minutes.',
    ignore: 'If you did not ask for this code, you can ignore this e-mail.',
  },
  fr: {
    subject: 'Votre code de confirmation {shop}',
    intro: 'Le code de votre compte {shop} est :',
    expires: 'Le code expire dans 10 minutes.',
    ignore: 'Si vous n’avez pas demandé ce code, ignorez cet e-mail.',
  },
  ar: {
    subject: 'رمز التأكيد الخاص بك من {shop}',
    intro: 'رمز حسابك في {shop} هو:',
    expires: 'تنتهي صلاحية الرمز خلال 10 دقائق.',
    ignore: 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.',
  },
};

const TITLE: Record<string, { login: string; reset: string }> = {
  ro: { login: 'Codul tău de intrare', reset: 'Resetarea parolei' },
  en: { login: 'Your sign-in code', reset: 'Reset your password' },
  fr: { login: 'Votre code de connexion', reset: 'Réinitialisation du mot de passe' },
  ar: { login: 'رمز تسجيل الدخول', reset: 'إعادة تعيين كلمة المرور' },
};

/** E-mailul cu codul de intrare (cont nou sau recuperare): codul mare, auriu, cu aspectul TAF (emailLayout.ts). */
export function otpEmail(
  lang: string,
  shop: string,
  code: string,
  tpl?: { subject: string; intro: string; reset?: boolean },
): { subject: string; content: EmailContent } {
  const t = EMAIL_OTP[lang] ?? EMAIL_OTP.ro;
  const fill = (s: string) => s.replaceAll('{shop}', shop).replaceAll('{code}', code);
  const title = (TITLE[lang] ?? TITLE.ro)[tpl?.reset ? 'reset' : 'login'];
  return {
    subject: tpl?.subject || fill(t.subject),
    content: { lang, title, body: `${tpl?.intro || fill(t.intro)}\n\n${t.ignore}`, code, transactional: true, preheader: `${title}: ${code}` },
  };
}

const EMAIL_RESET: Record<string, { subject: string; intro: string }> = {
  ro: { subject: 'Resetarea parolei {shop}', intro: 'Ai cerut să-ți setezi o parolă nouă pentru contul tău {shop}. Codul de recuperare este:' },
  en: { subject: 'Reset your {shop} password', intro: 'You asked to set a new password for your {shop} account. Your recovery code is:' },
  fr: { subject: 'Réinitialisation du mot de passe {shop}', intro: 'Vous avez demandé un nouveau mot de passe pour votre compte {shop}. Votre code de récupération est :' },
  ar: { subject: 'إعادة تعيين كلمة مرور {shop}', intro: 'طلبت تعيين كلمة مرور جديدة لحسابك في {shop}. رمز الاستعادة هو:' },
};

/** E-mailul cu codul pentru „Am uitat parola” / schimbarea parolei. */
export function resetEmail(lang: string, shop: string, code: string): ReturnType<typeof otpEmail> {
  const t = EMAIL_RESET[lang] ?? EMAIL_RESET.ro;
  const fill = (s: string) => s.replaceAll('{shop}', shop).replaceAll('{code}', code);
  return otpEmail(lang, shop, code, { subject: fill(t.subject), intro: fill(t.intro), reset: true });
}
