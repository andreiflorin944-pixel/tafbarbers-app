import { Hono } from 'hono';
import { recordConsent } from './consents';
import { getBusiness } from './db';
import { langKey, unsubscribeValid } from './emailLayout';
import type { AppEnv } from './env';
import { iso } from './time';

// Dezabonarea de la ofertele pe e-mail, din linkul de la finalul e-mailurilor promoționale (și butonul „Dezabonare”
// pe care îl arată Gmail / Yahoo lângă expeditor). Linkul e semnat cu adresa, așa că nu se poate dezabona altcineva.
// Deschiderea paginii nu schimbă nimic (unele programe antivirus deschid toate linkurile): abia butonul, sau cererea
// „dintr-un clic” a căsuței de mail (POST), oprește ofertele.

const T = {
  ro: {
    title: 'Oferte pe e-mail',
    ask: 'Nu mai vrei să primești oferte pe e-mail la adresa',
    keep: 'Mesajele despre programările tale (confirmări, mementouri) vin în continuare.',
    btn: 'Da, nu mai vreau oferte',
    done: 'Gata, nu mai primești oferte pe e-mail.',
    again: 'Te poți abona din nou oricând din aplicație, din Cont.',
    bad: 'Linkul nu mai este valabil. Poți opri ofertele din aplicație, din Cont.',
  },
  en: {
    title: 'E-mail offers',
    ask: 'Stop receiving offers by e-mail at',
    keep: 'Messages about your bookings (confirmations, reminders) will still arrive.',
    btn: 'Yes, unsubscribe me',
    done: 'Done, you will no longer receive offers by e-mail.',
    again: 'You can subscribe again anytime in the app, under Account.',
    bad: 'This link is no longer valid. You can turn offers off in the app, under Account.',
  },
  fr: {
    title: 'Offres par e-mail',
    ask: 'Ne plus recevoir d’offres par e-mail à l’adresse',
    keep: 'Les messages sur vos rendez-vous (confirmations, rappels) continueront d’arriver.',
    btn: 'Oui, me désinscrire',
    done: 'C’est fait, vous ne recevrez plus d’offres par e-mail.',
    again: 'Vous pouvez vous réinscrire à tout moment dans l’application, dans Compte.',
    bad: 'Ce lien n’est plus valable. Vous pouvez désactiver les offres dans l’application, dans Compte.',
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(lang: keyof typeof T, shop: string, inner: string) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${T[lang].title} · ${esc(shop)}</title>
<style>body{margin:0;background:#000;color:#E6E3DD;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
main{max-width:460px;margin:0 auto;padding:40px 20px;text-align:center}img{width:86px;height:auto}h1{color:#fff;font-size:24px;margin:22px 0 12px}
.box{background:#111112;border:1px solid #2A2A2D;border-radius:18px;padding:24px 22px}.m{color:#9C988F;font-size:14px}
button{background:#F9A11B;color:#000;border:0;border-radius:999px;padding:15px 30px;font:700 16px/1 inherit;font-family:inherit;cursor:pointer;margin-top:8px}</style></head>
<body><main><img src="/email-logo.png" alt="${esc(shop)}"><div class="box">${inner}</div></main></body></html>`;
}

export const unsubscribePublic = new Hono<AppEnv>();

unsubscribePublic.get('/dezabonare', async (c) => {
  const lang = langKey(c.req.query('l'));
  const t = T[lang];
  const shop = (await getBusiness(c.env)).name;
  const email = (c.req.query('e') ?? '').trim().toLowerCase();
  const sig = c.req.query('t') ?? '';
  if (!email || !(await unsubscribeValid(c.env, email, sig))) return c.html(page(lang, shop, `<h1>${t.title}</h1><p>${t.bad}</p>`), 400);
  const action = `/dezabonare?e=${encodeURIComponent(email)}&t=${encodeURIComponent(sig)}&l=${lang}`;
  return c.html(
    page(
      lang,
      shop,
      `<h1>${t.title}</h1><p>${t.ask} <b>${esc(email)}</b>?</p><p class="m">${t.keep}</p>
<form method="post" action="${esc(action)}"><button type="submit">${t.btn}</button></form>`,
    ),
  );
});

unsubscribePublic.post('/dezabonare', async (c) => {
  const lang = langKey(c.req.query('l'));
  const t = T[lang];
  const shop = (await getBusiness(c.env)).name;
  const email = (c.req.query('e') ?? '').trim().toLowerCase();
  if (!email || !(await unsubscribeValid(c.env, email, c.req.query('t') ?? ''))) return c.html(page(lang, shop, `<h1>${t.title}</h1><p>${t.bad}</p>`), 400);
  const rows = await c.env.DB.prepare(
    'SELECT id, lang, marketing_push, marketing_sms FROM clients WHERE lower(email) = ? AND marketing_email = 1 AND deleted_at IS NULL',
  )
    .bind(email)
    .all<{ id: string; lang: string | null; marketing_push: number; marketing_sms: number }>();
  const now = iso(new Date());
  for (const r of rows.results) {
    await c.env.DB.prepare('UPDATE clients SET marketing_email = 0, marketing_consent_at = ? WHERE id = ?').bind(now, r.id).run();
    // Dovada retragerii acordului, ca la schimbarea din aplicație.
    await recordConsent(c.env, c, r.id, {
      source: 'unsubscribe',
      terms: false,
      marketing: { push: !!r.marketing_push, sms: !!r.marketing_sms, email: false },
      lang: r.lang,
    });
  }
  return c.html(page(lang, shop, `<h1>${t.title}</h1><p>${t.done}</p><p class="m">${t.again}</p>`));
});
