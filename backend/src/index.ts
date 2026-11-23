import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HttpError, type AppEnv, type Env } from './env';
import { adminRoutes } from './routes/admin';
import { clientRoutes } from './routes/client';
import { publicRoutes } from './routes/public';
import { scheduled } from './cron';
import { socialPublic } from './social';
import { assistantRoutes } from './assistant';
import { advisorRoutes } from './advisor';
import { openAppPage, qrPublic } from './qr';
import { waitlistPublic } from './waitlist';
import { DOCS, legalDoc, type Doc } from './legal';
import { publicRaffle, raffleRules } from './raffle';
import { getBusiness } from './db';
import { formatLocal } from './time';
import { dirOf, isLang, langOf, localeOf, localizeText, requestLang, type Lang } from './contentI18n';
import { getWebsite, isSiteHost, siteDomain, sitePage, websitePublic } from './website';
import { health, recordServerError } from './serverErrors';
import { barberlyPublic } from './barberly';
import { captchaPublic, captchaSiteKey } from './captcha';
import { unsubscribePublic } from './unsubscribe';

const app = new Hono<AppEnv>();

// www.tafbarbers.ro → tafbarbers.ro (o singură adresă pentru Google; linkurile vechi cu www merg în continuare).
app.use('*', async (c, next) => {
  const u = new URL(c.req.url);
  const h = u.hostname.toLowerCase();
  if (h.startsWith('www.')) {
    const d = siteDomain(c.env, await getWebsite(c.env));
    if (d && h === `www.${d}`) return c.redirect(`https://${d}${u.pathname}${u.search}`, 301);
  }
  return next();
});

app.use('*', async (c, next) => {
  const origins = c.env.CORS_ORIGINS.split(',').map((s) => s.trim());
  return cors({
    origin: origins.includes('*') ? '*' : origins,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  })(c, next);
});

app.get('/v1', (c) => c.json({ name: 'tafbarbers-api', ok: true }));
// Pentru un monitor extern (ex. UptimeRobot): 200 cât timp cron-ul de la 5 minute rulează, 503 dacă s-a oprit.
app.get('/v1/health', async (c) => {
  const h = await health(c.env);
  return c.json(h, h.ok ? 200 : 503);
});
app.route('/v1', publicRoutes);
// Verificarea „nu sunt robot” (pagina deschisă de aplicație înainte de cererea unui cod).
app.route('/v1', captchaPublic);
app.route('/v1', socialPublic);
app.route('/v1', assistantRoutes);
app.route('/v1', advisorRoutes);
// E-mailurile Barberly trimise de scriptul din Gmail (cheia scriptului, nu sesiune de admin).
app.route('/v1', barberlyPublic);
app.route('/v1/admin', adminRoutes);
app.route('/v1', clientRoutes);
app.route('/', qrPublic);
app.route('/', waitlistPublic);
app.route('/', websitePublic);
// Dezabonarea de la ofertele pe e-mail (linkul din subsolul e-mailurilor promoționale).
app.route('/', unsubscribePublic);

// Rădăcina: la app.tafbarbers.ro (și la domeniul propriu al site-ului) e site-ul cu programare online; în rest (panou.…, workers.dev) e panoul.
app.get('/', async (c) => {
  if (await isSiteHost(c.env, new URL(c.req.url).host)) return c.html(await sitePage(c.env, { lang: c.req.query('lang') }));
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('Not found', 404);
});

// Pagini publice pentru regulamente (link pentru App Store / Google Play și site).
app.get('/legal/:doc', async (c) => {
  const doc = c.req.param('doc') as Doc;
  if (!DOCS.includes(doc)) return c.text('Not found', 404);
  const q = c.req.query('lang');
  const lang = isLang(q) ? q : 'ro';
  const d = await legalDoc(c.env, doc, lang);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const updated = d.updatedAt ? `<p class="m">${{ ro: 'Actualizat', en: 'Updated', fr: 'Mis à jour', ar: 'آخر تحديث' }[d.lang as 'ro']}: ${d.updatedAt.slice(0, 10)}</p>` : '';
  // Traducerea automată: varianta oficială rămâne cea în română.
  const note = d.translated ? `<p class="m">${d.lang === 'fr' ? 'Traduction automatique. La version officielle est celle en roumain.' : d.lang === 'ar' ? 'ترجمة آلية. النسخة الرسمية هي النسخة الرومانية.' : 'Automatic translation. The official version is the Romanian one.'}</p>` : '';
  return c.html(`<!doctype html><html lang="${d.lang}" dir="${d.lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title>
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px}h1{color:#F9A11B;font-size:26px}.m{color:#999;font-size:14px}p{white-space:pre-wrap}</style></head>
<body><main><h1>${esc(d.title)}</h1>${updated}${note}<p>${esc(d.body)}</p></main></body></html>`);
});

// Regulamentul tombolei săptămânale (public, gratuit, cum cere OG 99/2000), cu premiile și ultimii câștigători.
app.get('/tombola', async (c) => {
  const [r, p] = await Promise.all([raffleRules(c.env), publicRaffle(c.env, 'ro')]);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const day = (d: string) => d.split('-').reverse().join('.');
  const winners =
    p.enabled && p.winners.length
      ? `<h2>Ultimii câștigători</h2><ul>${p.winners.map((w) => `<li>${esc(w.name)}: ${esc(w.prize)} <span class="m">(săptămâna ${day(w.week)})</span></li>`).join('')}</ul>`
      : '';
  const status = p.enabled ? '' : '<p class="m">Tombola nu este activă în acest moment.</p>';
  return c.html(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)}</title>
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px}h1{color:#F9A11B;font-size:26px}h2{color:#F9A11B;font-size:19px;margin-top:32px}.m{color:#999;font-size:14px}p.b{white-space:pre-wrap}</style></head>
<body><main><h1>${esc(r.title)}</h1>${status}<p class="b">${esc(r.body)}</p>${winners}</main></body></html>`);
});

// Linkul de recomandare: pagină simplă care deschide aplicația cu codul completat (în limba browserului).
const INVITE_TEXT = {
  ro: { title: (n: string) => `Ai fost invitat la ${n}`, text: 'Fă-ți cont în aplicație cu codul de mai jos:', open: 'Deschide aplicația', hint: 'Dacă nu ai încă aplicația, instaleaz-o, apoi scrie codul la crearea contului.' },
  en: { title: (n: string) => `You are invited to ${n}`, text: 'Create an account in the app with the code below:', open: 'Open the app', hint: 'If you do not have the app yet, install it, then enter the code when you create your account.' },
  fr: { title: (n: string) => `Vous êtes invité chez ${n}`, text: 'Créez un compte dans l’app avec le code ci-dessous :', open: 'Ouvrir l’app', hint: 'Si vous n’avez pas encore l’app, installez-la, puis saisissez le code en créant votre compte.' },
  ar: { title: (n: string) => `أنت مدعو إلى ${n}`, text: 'أنشئ حساباً في التطبيق بالرمز أدناه:', open: 'افتح التطبيق', hint: 'إذا لم يكن لديك التطبيق بعد، ثبّته ثم اكتب الرمز عند إنشاء حسابك.' },
};
app.get('/r/:code', async (c) => {
  const code = c.req.param('code').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const biz = await getBusiness(c.env);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const deep = `tafbarbers://login?ref=${code}`;
  const lang = requestLang(c);
  const T = INVITE_TEXT[lang];
  return c.html(`<!doctype html><html lang="${lang}" dir="${dirOf(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(biz.name)}</title>
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:48px 20px;text-align:center}h1{font-size:26px}.code{font-size:34px;font-weight:800;letter-spacing:6px;color:#F9A11B;margin:18px 0}a.b{display:inline-block;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-top:10px}.m{color:#999;font-size:14px}</style></head>
<body><main><h1>${esc(T.title(biz.name))}</h1><p>${T.text}</p><div class="code">${esc(code)}</div>
<a class="b" href="${deep}">${T.open}</a><p class="m">${T.hint}</p></main></body></html>`);
});

// Ștergerea contului de pe web, fără aplicație (cerută de Google Play): codul vine pe SMS sau pe e-mailul din cont,
// apoi contul se șterge la fel ca din aplicație (Cont → Șterge contul).
app.get('/sterge-cont', async (c) => {
  const [biz, captcha] = await Promise.all([getBusiness(c.env), captchaSiteKey(c.env)]);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return c.html(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Șterge contul · ${esc(biz.name)}</title>
<meta name="robots" content="noindex">
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:40px 20px}h1{font-size:24px}
input{width:100%;box-sizing:border-box;background:#111;border:1px solid #333;border-radius:12px;color:#eee;font-size:16px;padding:14px;margin:6px 0 12px}
button{width:100%;background:#F9A11B;color:#000;font-weight:800;border:0;border-radius:999px;padding:14px;font-size:16px;cursor:pointer}button.d{background:#d9534f;color:#fff}
.m{color:#999;font-size:14px}.e{color:#ff6b6b}.ok{color:#8FC79A}[hidden]{display:none}</style></head>
<body><main><h1>Șterge contul ${esc(biz.name)}</h1>
<p class="m">Se șterg definitiv numele, telefonul, e-mailul, data nașterii, pozele și preferințele tale, iar programările viitoare se anulează. Păstrăm doar evidența plăților făcute, fără date care să te identifice, cât cere legea contabilității. Poți face același lucru din aplicație: Cont → Șterge contul.</p>
<form id="f1"><label>Numărul de telefon din cont<input id="phone" type="tel" placeholder="07xx xxx xxx" required autocomplete="tel"></label>
<label>E-mailul din cont (opțional; dacă îl scrii, codul vine pe e-mail, altfel prin SMS)<input id="email" type="email" placeholder="nume@exemplu.ro" autocomplete="email"></label>
${captcha ? '<div id="cf" style="margin:6px 0 14px;min-height:65px"></div>' : ''}<button>Trimite codul</button></form>
<form id="f2" hidden><label>Codul primit<input id="code" inputmode="numeric" maxlength="6" placeholder="123456" required></label>
<p id="dev" class="m"></p><button class="d">Șterge definitiv contul</button></form>
<p id="msg"></p></main>
${captcha ? `<script>let cfTok=null;window.cfGo=()=>turnstile.render('#cf',{sitekey:${JSON.stringify(captcha)},language:'ro',theme:'dark',callback:(x)=>{cfTok=x},'expired-callback':()=>{cfTok=null},'error-callback':()=>{cfTok=null}});</script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=cfGo&render=explicit" async defer></script>` : '<script>const cfTok=null;</script>'}
<script>
const $=(i)=>document.getElementById(i),msg=(t,ok)=>{$('msg').textContent=t;$('msg').className=ok?'ok':'e'};
const E={invalid_phone:'Numărul de telefon nu pare corect.',email_mismatch:'E-mailul nu e cel din cont.',email_not_on_account:'Contul nu are e-mail; lasă câmpul gol și primești codul prin SMS.',too_many_requests:'Ai cerut un cod de curând. Mai încearcă peste un minut.',wrong_code:'Codul nu e corect.',too_many_attempts:'Prea multe încercări greșite. Încearcă din nou peste o oră.',code_expired:'Codul a expirat. Cere altul.',terms_required:'Nu există niciun cont cu acest număr.',birth_date_required:'Nu există niciun cont cu acest număr.',email_required:'Nu există niciun cont cu acest număr.',account_blocked:'Contul nu mai poate fi folosit. Sună la salon.',captcha_required:'Așteaptă bifa verde de la „nu sunt robot”, apoi apasă din nou.',captcha_failed:'Verificarea „nu sunt robot” a expirat. Încearcă din nou.'};
const call=async(m,p,b,t)=>{const r=await fetch('/v1'+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error((j&&j.error)||'server_error');return j};
let phone='';
$('f1').onsubmit=async(e)=>{e.preventDefault();msg('');try{const email=$('email').value.trim();const r=await call('POST','/auth/otp',{phone:$('phone').value,captcha:cfTok||undefined,...(email?{email,channel:'email'}:{channel:'sms'})}).finally(()=>{if(window.turnstile&&$('cf')){try{turnstile.reset('#cf')}catch(_){}}${captcha ? ';cfTok=null' : ''}});
if(r.newAccount){msg('Nu există niciun cont cu acest număr.');return}phone=r.phone;$('f1').hidden=true;$('f2').hidden=false;msg('Ți-am trimis codul la '+r.sentTo+'.',true);if(r.devCode)$('dev').textContent='Server de test, codul este '+r.devCode;}catch(x){msg(E[x.message]||'A apărut o problemă. Încearcă din nou.')}};
$('f2').onsubmit=async(e)=>{e.preventDefault();msg('');if(!confirm('Sigur ștergi contul? Nu se mai poate recupera.'))return;try{const v=await call('POST','/auth/verify',{phone,code:$('code').value.trim()});await call('DELETE','/me',null,v.token);
$('f2').hidden=true;msg('Contul a fost șters. Îți mulțumim că ai fost clientul nostru.',true)}catch(x){msg(E[x.message]||'A apărut o problemă. Încearcă din nou.')}};
</script></body></html>`);
});

// Paginile la care revine clientul de pe Stripe. Starea reală vine prin webhook; aici doar îl trimitem înapoi în aplicație.
// `/plata/deschide` e linkul din cererea de plată (SMS, e-mail): deschide aplicația la Programări, unde e butonul „Plătește acum”.
const PAY_PAGE = {
  ro: {
    okTitle: 'Plata a reușit',
    failTitle: 'Plata a fost anulată',
    gift: 'Mulțumim! Cardul cadou se activează imediat, iar cel care îl primește are codul prin SMS și în aplicație.',
    booking: 'Mulțumim! Programarea e plătită. Dacă o anulezi la timp, banii se întorc singuri pe card.',
    order: 'Mulțumim! Comanda e plătită; o ridici de la salon când îți scriem că e gata.',
    sub: 'Mulțumim! Abonamentul se activează imediat și îl vezi în aplicație, la Abonamente.',
    fail: 'Nu s-a luat niciun ban. Poți încerca din nou din aplicație sau poți plăti la salon.',
    back: 'Înapoi în aplicație',
  },
  en: {
    okTitle: 'Payment successful',
    failTitle: 'Payment cancelled',
    gift: 'Thank you! The gift card is activated right away and the recipient gets the code by SMS and in the app.',
    booking: 'Thank you! Your booking is paid. If you cancel in time, the money goes back to your card automatically.',
    order: 'Thank you! Your order is paid; pick it up at the shop once we tell you it is ready.',
    sub: 'Thank you! Your membership is activated right away; you will find it in the app, under Memberships.',
    fail: 'You were not charged. You can try again from the app or pay at the shop.',
    back: 'Back to the app',
  },
  fr: {
    okTitle: 'Paiement réussi',
    failTitle: 'Paiement annulé',
    gift: 'Merci ! La carte cadeau est activée tout de suite et le bénéficiaire reçoit le code par SMS et dans l’app.',
    booking: 'Merci ! Votre rendez-vous est payé. Si vous l’annulez à temps, l’argent revient automatiquement sur votre carte.',
    order: 'Merci ! Votre commande est payée ; retirez-la au salon quand nous vous prévenons qu’elle est prête.',
    sub: 'Merci ! Votre abonnement est activé tout de suite ; vous le trouvez dans l’app, rubrique Abonnements.',
    fail: 'Aucun montant n’a été débité. Vous pouvez réessayer depuis l’app ou payer au salon.',
    back: 'Retour à l’app',
  },
  ar: {
    okTitle: 'تم الدفع بنجاح',
    failTitle: 'أُلغي الدفع',
    gift: 'شكراً! تُفعَّل بطاقة الهدية فوراً، ويصل الرمز إلى المستلم عبر SMS وفي التطبيق.',
    booking: 'شكراً! موعدك مدفوع. إذا ألغيته في الوقت المناسب، يعود المبلغ إلى بطاقتك تلقائياً.',
    order: 'شكراً! طلبك مدفوع؛ استلمه من الصالون عندما نخبرك أنه جاهز.',
    sub: 'شكراً! يُفعَّل اشتراكك فوراً وتجده في التطبيق، في قسم الاشتراكات.',
    fail: 'لم يُخصم أي مبلغ. يمكنك المحاولة مجدداً من التطبيق أو الدفع في الصالون.',
    back: 'العودة إلى التطبيق',
  },
};
app.get('/plata/:rez', async (c) => {
  const rez = c.req.param('rez');
  // Linkurile din mesaje (cererea de plată, plata abonamentului căzută) și întoarcerea din pagina Stripe „Schimbă cardul”.
  if (rez === 'deschide') return c.html(await openAppPage(c.env, c.req.query('tip') === 'sub' ? 'tafbarbers://subscriptions' : 'tafbarbers://bookings', requestLang(c)));
  const ok = rez === 'gata';
  const tip = c.req.query('tip');
  const lang = requestLang(c);
  const L = PAY_PAGE[lang];
  const biz = await getBusiness(c.env);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const deep = tip === 'gift' ? 'tafbarbers://gift-cards' : tip === 'booking' ? 'tafbarbers://bookings' : tip === 'sub' ? 'tafbarbers://subscriptions' : 'tafbarbers://shop/orders';
  const title = ok ? L.okTitle : L.failTitle;
  const text = ok ? (tip === 'gift' ? L.gift : tip === 'booking' ? L.booking : tip === 'sub' ? L.sub : L.order) : L.fail;
  return c.html(`<!doctype html><html lang="${lang}" dir="${dirOf(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${esc(biz.name)}</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:56px 20px;text-align:center}h1{font-size:26px;color:${ok ? '#8FC79A' : '#F9A11B'}}a.b{display:inline-block;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-top:14px}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><a class="b" href="${deep}">${L.back}</a></main></body></html>`);
});

const BOOKING_PAGE = {
  ro: { title: 'Programarea ta', hi: (n: string) => `Salut, ${n}!`, confirmed: 'Programare confirmată', requested: 'Cerere în așteptare: salonul o confirmă în curând', completed: 'Programare încheiată. Mulțumim!', noShow: 'Programarea a trecut', cancelled: 'Programare anulată', service: 'Serviciu', when: 'Când', barber: 'Frizer', where: 'Unde', price: 'Preț', lei: 'lei', open: 'Deschide în aplicație', map: 'Vezi pe hartă', move: 'Vrei s-o muți sau s-o anulezi? Din aplicație sau la' },
  en: { title: 'Your booking', hi: (n: string) => `Hi, ${n}!`, confirmed: 'Booking confirmed', requested: 'Request pending: the shop will confirm it soon', completed: 'Booking completed. Thank you!', noShow: 'The booking has passed', cancelled: 'Booking cancelled', service: 'Service', when: 'When', barber: 'Barber', where: 'Where', price: 'Price', lei: 'lei', open: 'Open in the app', map: 'Open map', move: 'Want to move or cancel it? In the app or at' },
  fr: { title: 'Votre rendez-vous', hi: (n: string) => `Bonjour, ${n} !`, confirmed: 'Rendez-vous confirmé', requested: 'Demande en attente : le salon la confirmera bientôt', completed: 'Rendez-vous terminé. Merci !', noShow: 'Le rendez-vous est passé', cancelled: 'Rendez-vous annulé', service: 'Service', when: 'Quand', barber: 'Barbier', where: 'Où', price: 'Prix', lei: 'lei', open: 'Ouvrir dans l’app', map: 'Voir la carte', move: 'Le déplacer ou l’annuler ? Dans l’app ou au' },
  ar: { title: 'موعدك', hi: (n: string) => `مرحباً، ${n}!`, confirmed: 'تم تأكيد الموعد', requested: 'الطلب بالانتظار: سيؤكده الصالون قريباً', completed: 'انتهى الموعد. شكراً لك!', noShow: 'مضى وقت الموعد', cancelled: 'أُلغي الموعد', service: 'الخدمة', when: 'الموعد', barber: 'الحلاق', where: 'المكان', price: 'السعر', lei: 'لي', open: 'افتح في التطبيق', map: 'عرض على الخريطة', move: 'تريد نقله أو إلغاءه؟ من التطبيق أو على الرقم' },
};

// Linkul programării pentru client („Copiază linkul clientului” din panou): ce, când, cu cine și unde, plus butonul spre aplicație.
// Id-ul programării e lung și aleatoriu; pagina nu arată telefonul sau numele întreg al clientului.
app.get('/b/:id', async (c) => {
  const id = c.req.param('id').slice(0, 40);
  const b = await c.env.DB.prepare(
    `SELECT b.starts_at, b.ends_at, b.status, b.price_bani, c.name AS client_name, c.lang AS client_lang, s.name AS service_name, br.name AS barber_name, l.name AS loc_name, l.address AS loc_address
     FROM bookings b JOIN clients c ON c.id = b.client_id JOIN services s ON s.id = b.service_id JOIN barbers br ON br.id = b.barber_id
     LEFT JOIN locations l ON l.id = b.location_id WHERE b.id = ?`,
  )
    .bind(id)
    .first<{ starts_at: string; ends_at: string; status: string; price_bani: number; client_name: string; client_lang: string | null; service_name: string; barber_name: string; loc_name: string | null; loc_address: string | null }>();
  if (!b) return c.html(await openAppPage(c.env, 'tafbarbers://bookings', requestLang(c)), 404);
  // În limba clientului (cea din aplicație), cu numele serviciului tradus.
  const lang = isLang(c.req.query('lang')) ? (c.req.query('lang') as Lang) : langOf(b.client_lang);
  const T = BOOKING_PAGE[lang];
  const serviceName = await localizeText(c.env, lang, b.service_name);
  const biz = await getBusiness(c.env);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const first = (b.client_name || '').trim().split(/\s+/)[0];
  const address = b.loc_address || biz.address || '';
  const place = [b.loc_name || biz.name, address].filter(Boolean).join(', ');
  const maps = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : '';
  const end = new Intl.DateTimeFormat(localeOf(lang), { timeZone: c.env.TIMEZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(b.ends_at));
  const state: Record<string, [string, string]> = {
    confirmed: [T.confirmed, '#8FC79A'],
    requested: [T.requested, '#F9A11B'],
    completed: [T.completed, '#8FC79A'],
    no_show: [T.noShow, '#999'],
    cancelled: [T.cancelled, '#E5484D'],
  };
  const [label, color] = state[b.status] ?? state.confirmed;
  const price = b.price_bani % 100 ? (b.price_bani / 100).toFixed(2) : String(b.price_bani / 100);
  const phone = biz.phone ? `<p class="m">${T.move} <a href="tel:${esc(biz.phone.replace(/\s+/g, ''))}">${esc(biz.phone)}</a>.</p>` : '';
  return c.html(`<!doctype html><html lang="${lang}" dir="${dirOf(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${T.title} · ${esc(biz.name)}</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:44px 20px}h1{font-size:26px;margin:0 0 4px}.st{color:${color};font-weight:700}.card{border:1px solid #333;border-radius:16px;padding:16px 18px;margin:20px 0}.r{display:flex;justify-content:space-between;gap:12px;padding:6px 0}.r span:first-child{color:#999}a.b{display:block;text-align:center;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:15px;border-radius:999px;margin-top:10px}a.s{display:block;text-align:center;border:1px solid #333;color:#eee;text-decoration:none;padding:13px;border-radius:999px;margin-top:10px}.m{color:#999;font-size:14px}a{color:#F9A11B}</style></head>
<body><main><h1>${first ? esc(T.hi(first)) : esc(biz.name)}</h1><div class="st">${label}</div>
<div class="card"><div class="r"><span>${T.service}</span><b>${esc(serviceName)}</b></div><div class="r"><span>${T.when}</span><b>${esc(formatLocal(c.env.TIMEZONE, b.starts_at, lang))}–${end}</b></div>
<div class="r"><span>${T.barber}</span><b>${esc(b.barber_name)}</b></div>${place ? `<div class="r"><span>${T.where}</span><b>${esc(place)}</b></div>` : ''}<div class="r"><span>${T.price}</span><b>${price} ${T.lei}</b></div></div>
<a class="b" href="tafbarbers://bookings">${T.open}</a>${maps ? `<a class="s" href="${esc(maps)}">${T.map}</a>` : ''}${phone}</main></body></html>`);
});

// Butonul „Programează” din Google Maps, Instagram, Facebook sau site: deschide aplicația direct la programare
// și numără de unde vin clienții (?src=google | instagram | facebook | site | qr).
const LINK_SOURCES = new Set(['google', 'instagram', 'facebook', 'tiktok', 'site', 'qr', 'altul']);
app.get('/programare', async (c) => {
  const raw = (c.req.query('src') ?? '').toLowerCase();
  const src = LINK_SOURCES.has(raw) ? raw : 'altul';
  const day = new Date().toISOString().slice(0, 10);
  c.executionCtx.waitUntil(
    c.env.DB.prepare('INSERT INTO link_clicks (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1').bind(day, src).run(),
  );
  return c.html(await openAppPage(c.env, `tafbarbers://book?src=${src}`, requestLang(c)));
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
  // Se păstrează în panou (Setări → Erori din aplicație) și ajunge în anunțul orar către proprietar.
  c.executionCtx.waitUntil(recordServerError(c.env, `${c.req.method} ${c.req.path}`, err));
  return c.json({ error: 'server_error' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: async (_e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;
