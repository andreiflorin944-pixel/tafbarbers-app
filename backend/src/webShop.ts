// „Contul meu” pe site, fără aplicație: tafbarbers.ro/cont (și app.tafbarbers.ro/cont).
// Clientul intră în cont cu codul primit prin SMS sau pe e-mail (același cont ca în aplicație; contul nou se face aici, cu termenii semnați)
// și cumpără cu cardul (Stripe) tot ce se cumpără și în aplicație: abonamentele, abonamentul personalizat (pe frizer), produsele
// din magazin și cardul cadou (pagina /cadou). Totul folosește aceleași rute și prețuri ca aplicația, deci ce se schimbă în panou
// apare singur și aici. După plată, clientul se întoarce pe site (/cont/gata), iar cumpărăturile apar în contul lui (și în aplicație).
import { Hono } from 'hono';
import { captchaSiteKey } from './captcha';
import { getBusiness } from './db';
import { onlinePaymentsOn, type AppEnv } from './env';
import { getAutomations } from './growth';
import { getCustomSubSettings } from './customSubs';

export const webShopPublic = new Hono<AppEnv>();

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const GOLD = '#F9A11B';
const LANGS = ['ro', 'en', 'fr', 'ar'];
const pickLang = (q: string | undefined) => (q && LANGS.includes(q) ? q : 'ro');

const CSS = `*{box-sizing:border-box}body{margin:0;background:#000;color:#eee;font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
main{max-width:620px;margin:0 auto;padding:0 16px 56px}header{display:flex;align-items:center;gap:12px;padding:16px 0 6px}header a{color:#eee;text-decoration:none;font-size:15px}
.brand{font-family:Georgia,serif;font-style:italic;color:${GOLD};font-size:22px;flex:1}h1{font-size:26px;line-height:1.2;margin:8px 0 4px}h2{font-size:20px;margin:22px 0 8px}
.m{color:#a6a6ad;font-size:14px}.card{background:#111;border:1px solid #2a2a2a;border-radius:18px;padding:16px;margin:12px 0}
label{display:block;font-size:14px;color:#cfcfd4;margin-top:10px}input,textarea{width:100%;background:#0b0b0b;border:1px solid #333;border-radius:12px;color:#eee;font-size:16px;padding:13px;margin-top:5px;font-family:inherit}
.btn{display:block;width:100%;background:${GOLD};color:#000;font-weight:800;border:0;border-radius:14px;padding:15px;font-size:16px;cursor:pointer;margin-top:14px;text-align:center;text-decoration:none}
.btn.ghost{background:transparent;color:#eee;border:1px solid #3a3a3a}.btn[disabled]{opacity:.5}.e{color:#ff6b6b}.ok{color:#8FC79A}a{color:${GOLD}}
.tabs{display:flex;gap:8px;overflow-x:auto;padding:8px 0;margin:0 -16px;padding-left:16px;padding-right:16px;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:none;background:transparent;border:1px solid #3a3a3a;color:#eee;border-radius:999px;padding:9px 16px;font-weight:700;font-size:14px;cursor:pointer}.tabs button.on{background:${GOLD};border-color:${GOLD};color:#000}
.row{display:flex;gap:12px;align-items:center}.grow{flex:1;min-width:0}.t{font-weight:800;font-size:17px}.price{color:${GOLD};font-weight:800;font-size:18px;white-space:nowrap}
.qty{display:flex;align-items:center;gap:10px}.qty button{width:36px;height:36px;border-radius:18px;border:1px solid #3a3a3a;background:#0b0b0b;color:#eee;font-size:20px;cursor:pointer}.qty b{min-width:18px;text-align:center}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.chips button{background:transparent;border:1px solid #3a3a3a;color:#eee;border-radius:999px;padding:9px 16px;font-weight:700;font-size:15px;cursor:pointer}.chips button.on{background:${GOLD};border-color:${GOLD};color:#000}
.img{width:72px;height:72px;border-radius:12px;background:#1a1a1a center/cover;flex:none}.chk{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#cfcfd4;margin-top:12px}.chk input{width:auto;margin-top:3px}
.legal{max-height:220px;overflow:auto;background:#0b0b0b;border:1px solid #333;border-radius:12px;padding:12px;font-size:13px;white-space:pre-wrap;margin-top:10px}
.pill{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;background:#1f1f1f;color:#cfcfd4}.pill.g{background:#173a20;color:#8FC79A}
.sum{display:flex;justify-content:space-between;margin-top:6px}.sp{text-align:center;padding:30px;color:#a6a6ad}hr{border:0;border-top:1px solid #2a2a2a;margin:14px 0}
.radio{display:flex;gap:10px;align-items:flex-start;cursor:pointer}.radio input{width:auto;margin-top:4px}`;

// Textele paginii: română și engleză (franceza și araba folosesc engleza, ca pagina Stripe).
const T = {
  ro: {
    title: 'Cumpără online',
    sub: 'Abonamente, produse și carduri cadou, plătite cu cardul. Nu ai nevoie de aplicație.',
    back: 'Înapoi la site',
    tabs: { subs: 'Abonamente', custom: 'Abonament personalizat', shop: 'Produse', gift: 'Card cadou', mine: 'Contul meu' },
    login: 'Intră în cont',
    loginWhy: 'Intră în cont cu numărul de telefon. Este același cont ca în aplicație: ce cumperi apare și acolo.',
    phone: 'Telefon',
    email: 'E-mail',
    sendCode: 'Trimite codul',
    code: 'Codul primit',
    codeSentTo: 'Ți-am trimis codul la ',
    newAcc: 'Cont nou: completează datele de mai jos.',
    name: 'Nume și prenume',
    scroll: 'Derulează termenii și politica până la capăt ca să poți bifa și semna.',
    terms: 'Am citit și accept Termenii și condițiile și Politica de confidențialitate.',
    sig: 'Semnătura: scrie numele și prenumele',
    sigNeeded: 'Bifează că ai citit documentele și scrie numele ca semnătură.',
    marketing: 'Vreau să primesc oferte (opțional).',
    enter: 'Intră în cont',
    signTitle: 'Un singur pas: semnează termenii',
    signText: 'Înainte de prima cumpărătură, citește și semnează termenii (o singură dată).',
    sign: 'Semnează și continuă',
    hello: 'Bună, {t}!',
    logout: 'Ieși din cont',
    buy: 'Cumpără',
    perDays: 'pentru {t} zile',
    cuts: '{t} vizite incluse',
    unlimited: 'vizite nelimitate',
    noPlans: 'Momentan nu sunt abonamente de cumpărat.',
    customOff: 'Abonamentul personalizat nu e pornit momentan.',
    customIntro: 'Alegi singur serviciile pe o lună. Cu cât vii mai des, cu atât e mai mare reducerea.',
    barber: 'Alege frizerul',
    barberInfo: 'Abonamentul e valabil la frizerul ales, cu prețurile lui.',
    visits: 'Vizite: {t}',
    vis: 'vizite',
    minVisits: 'Alege cel puțin {t} vizite.',
    full: 'Preț întreg',
    discount: 'Reducere',
    total: 'Plătești',
    autoRenew: 'Retragere automată lunară',
    autoRenewText: 'Cardul se taxează singur la fiecare 30 de zile. O oprești oricând.',
    manual: 'Plătesc eu în fiecare lună',
    manualText: 'O plată acum. Luna viitoare plătești din nou, dacă vrei.',
    noProducts: 'Momentan nu sunt produse de cumpărat online.',
    stockOut: 'Stoc epuizat',
    cart: 'Coșul tău',
    note: 'Mesaj pentru salon (opțional)',
    payCard: 'Plătește cu cardul',
    payLater: 'Comand și plătesc la ridicare',
    pickup: 'Ridici comanda de la salon. Îți scriem când e gata.',
    ordered: 'Comanda {t} a fost trimisă. Plătești la ridicare.',
    giftText: 'Un card cadou pentru orice serviciu din salon, cu urarea ta. Îl primești pe loc, gata de printat sau de trimis.',
    giftCta: 'Cumpără un card cadou',
    mySubs: 'Abonamentele mele',
    myOrders: 'Comenzile mele',
    myGifts: 'Cardurile cadou cumpărate',
    none: 'Nimic încă.',
    left: 'rămase {t}',
    until: 'valabil până pe {t}',
    st: { active: 'Activ', upcoming: 'Începe curând', expired: 'Expirat', used: 'Folosit', cancelled: 'Anulat', pending: 'Neplătit', new: 'Primită', ready: 'Gata de ridicat', picked_up: 'Ridicată' },
    paid: 'Plătită',
    payNow: 'Plătește acum',
    cancelled: 'Plata a fost anulată și nu s-a luat niciun ban. Poți încerca din nou.',
    loginFirst: 'Intră în cont ca să continui. Durează un minut.',
    err: 'A apărut o problemă. Încearcă din nou.',
    E: {
      wrong_code: 'Codul nu e corect.',
      code_expired: 'Codul a expirat. Cere altul.',
      invalid_phone: 'Numărul de telefon nu pare corect.',
      invalid_email: 'E-mailul nu pare corect.',
      email_mismatch: 'E-mailul nu e cel din cont.',
      email_not_on_account: 'Contul nu are e-mail. Alege codul prin SMS sau sună la salon.',
      email_in_use: 'E-mailul e deja folosit de alt cont.',
      email_required: 'Scrie adresa de e-mail.',
      too_many_requests: 'Prea multe încercări. Mai încearcă peste un minut.',
      account_blocked: 'Contul nu mai poate cumpăra online. Sună la salon.',
      captcha_required: 'Confirmă că nu ești robot.',
      captcha_failed: 'Confirmă din nou că nu ești robot.',
      terms_required: 'Bifează că ai citit documentele.',
      signature_required: 'Scrie numele ca semnătură.',
      legal_changed: 'Documentele tocmai s-au actualizat. Reîncarcă pagina.',
      payments_off: 'Momentan plata cu cardul nu e disponibilă. Poți plăti la salon.',
      already_recurring: 'Ai deja acest abonament cu plată automată. Îl vezi la „Contul meu”.',
      custom_sub_off: 'Abonamentul personalizat nu e pornit momentan.',
      too_few_visits: 'Alege mai multe vizite.',
      too_many_visits: 'Ai ales prea multe vizite.',
      service_not_offered: 'Frizerul ales nu face unul dintre servicii.',
      too_many_open_orders: 'Ai deja 3 comenzi neridicate. Ridică-le sau anulează una.',
      out_of_stock: 'Un produs nu mai are stoc suficient.',
      product_unavailable: 'Un produs nu mai e de vânzare. Reîncarcă pagina.',
      amount_too_small: 'Suma e prea mică pentru plata cu cardul. Plătești la salon.',
      plan_not_found: 'Abonamentul nu mai există. Reîncarcă pagina.',
      name_required: 'Scrie numele și prenumele.',
    } as Record<string, string>,
  },
  en: {
    title: 'Buy online',
    sub: 'Memberships, products and gift cards, paid by card. No app needed.',
    back: 'Back to the site',
    tabs: { subs: 'Memberships', custom: 'Custom membership', shop: 'Products', gift: 'Gift card', mine: 'My account' },
    login: 'Sign in',
    loginWhy: 'Sign in with your phone number. It is the same account as in the app: what you buy shows up there too.',
    phone: 'Phone',
    email: 'Email',
    sendCode: 'Send the code',
    code: 'Code received',
    codeSentTo: 'We sent the code to ',
    newAcc: 'New account: fill in your details below.',
    name: 'Full name',
    scroll: 'Scroll the terms and policy to the end to tick and sign.',
    terms: 'I have read and accept the Terms and conditions and the Privacy policy.',
    sig: 'Signature: type your full name',
    sigNeeded: 'Tick that you read the documents and type your name as signature.',
    marketing: 'I want to receive offers (optional).',
    enter: 'Sign in',
    signTitle: 'One step: sign the terms',
    signText: 'Before your first purchase, read and sign the terms (only once).',
    sign: 'Sign and continue',
    hello: 'Hi, {t}!',
    logout: 'Sign out',
    buy: 'Buy',
    perDays: 'for {t} days',
    cuts: '{t} visits included',
    unlimited: 'unlimited visits',
    noPlans: 'No memberships for sale right now.',
    customOff: 'The custom membership is not available right now.',
    customIntro: 'Pick your own services for a month. The more often you come, the bigger the discount.',
    barber: 'Choose your barber',
    barberInfo: 'The membership is valid with the chosen barber, at their prices.',
    visits: 'Visits: {t}',
    vis: 'visits',
    minVisits: 'Choose at least {t} visits.',
    full: 'Full price',
    discount: 'Discount',
    total: 'You pay',
    autoRenew: 'Automatic monthly payment',
    autoRenewText: 'Your card is charged every 30 days. Stop it anytime.',
    manual: 'I pay each month myself',
    manualText: 'One payment now. Next month you pay again if you want.',
    noProducts: 'No products for sale online right now.',
    stockOut: 'Out of stock',
    cart: 'Your cart',
    note: 'Message for the shop (optional)',
    payCard: 'Pay by card',
    payLater: 'Order and pay at pickup',
    pickup: 'Pick up your order at the shop. We will tell you when it is ready.',
    ordered: 'Order {t} was sent. You pay at pickup.',
    giftText: 'A gift card for any service at the shop, with your wishes. You get it right away, ready to print or send.',
    giftCta: 'Buy a gift card',
    mySubs: 'My memberships',
    myOrders: 'My orders',
    myGifts: 'Gift cards I bought',
    none: 'Nothing yet.',
    left: '{t} left',
    until: 'valid until {t}',
    st: { active: 'Active', upcoming: 'Starts soon', expired: 'Expired', used: 'Used', cancelled: 'Cancelled', pending: 'Unpaid', new: 'Received', ready: 'Ready for pickup', picked_up: 'Picked up' },
    paid: 'Paid',
    payNow: 'Pay now',
    cancelled: 'The payment was cancelled and you were not charged. You can try again.',
    loginFirst: 'Sign in to continue. It takes a minute.',
    err: 'Something went wrong. Please try again.',
    E: {
      wrong_code: 'The code is not correct.',
      code_expired: 'The code expired. Ask for a new one.',
      invalid_phone: 'The phone number does not look right.',
      invalid_email: 'The email does not look right.',
      email_mismatch: 'This is not the email on the account.',
      email_not_on_account: 'The account has no email. Use the SMS code or call the shop.',
      email_in_use: 'This email is already used by another account.',
      email_required: 'Type your email address.',
      too_many_requests: 'Too many tries. Try again in a minute.',
      account_blocked: 'This account can no longer buy online. Please call the shop.',
      captcha_required: 'Confirm you are not a robot.',
      captcha_failed: 'Confirm again you are not a robot.',
      terms_required: 'Tick that you read the documents.',
      signature_required: 'Type your name as signature.',
      legal_changed: 'The documents were just updated. Reload the page.',
      payments_off: 'Card payment is not available right now. You can pay at the shop.',
      already_recurring: 'You already have this membership with automatic payment. See "My account".',
      custom_sub_off: 'The custom membership is not available right now.',
      too_few_visits: 'Choose more visits.',
      too_many_visits: 'Too many visits chosen.',
      service_not_offered: 'The chosen barber does not do one of these services.',
      too_many_open_orders: 'You already have 3 open orders. Pick them up or cancel one.',
      out_of_stock: 'A product is out of stock.',
      product_unavailable: 'A product is no longer for sale. Reload the page.',
      amount_too_small: 'The amount is too small for card payment. Pay at the shop.',
      plan_not_found: 'This membership no longer exists. Reload the page.',
      name_required: 'Type your full name.',
    } as Record<string, string>,
  },
};
type Texts = (typeof T)['ro'];
const texts = (lang: string): Texts => (lang === 'ro' ? T.ro : T.en);

webShopPublic.get('/cont', async (c) => {
  const lang = pickLang(c.req.query('lang'));
  const L = texts(lang);
  const [biz, auto, captcha, custom] = await Promise.all([getBusiness(c.env), getAutomations(c.env), captchaSiteKey(c.env), getCustomSubSettings(c.env)]);
  const cfg = {
    lang,
    L,
    otpSms: auto.otpSms,
    captcha,
    pay: onlinePaymentsOn(c.env),
    gift: auto.giftCard.enabled,
    custom: custom.enabled,
    cancelled: c.req.query('anulat') === '1',
  };
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return c.html(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.title)} · ${esc(biz.name)}</title><meta name="description" content="${esc(L.sub)}"><meta name="robots" content="noindex"><meta name="theme-color" content="#000000">
<link rel="icon" href="/favicon.png"><style>${CSS}</style></head><body><main>
<header><span class="brand">${esc(biz.name)}</span><a href="/">‹ ${esc(L.back)}</a></header>
<h1>${esc(L.title)}</h1><p class="m" style="margin-top:0">${esc(L.sub)}</p>
<div id="app"><div class="sp">…</div></div></main>
<script>window.CFG=${json};</script>
${captcha ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>' : ''}
<script>${JS}</script></body></html>`);
});

// Întoarcerea de pe pagina Stripe: plata e confirmată de Stripe în câteva secunde, apoi apare în „Contul meu”.
webShopPublic.get('/cont/gata', async (c) => {
  const lang = pickLang(c.req.query('lang'));
  const biz = await getBusiness(c.env);
  const ro = lang === 'ro';
  const tip = c.req.query('tip');
  const text = ro
    ? tip === 'order'
      ? 'Mulțumim! Comanda e plătită. O ridici de la salon când îți scriem că e gata.'
      : 'Mulțumim! Abonamentul se activează în câteva secunde. Îl vezi la „Contul meu”, pe site și în aplicație.'
    : tip === 'order'
      ? 'Thank you! Your order is paid. Pick it up at the shop once we tell you it is ready.'
      : 'Thank you! Your membership is activated in a few seconds. You will find it under "My account", on the site and in the app.';
  return c.html(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ro ? 'Plata a reușit' : 'Payment successful'} · ${esc(biz.name)}</title><meta name="robots" content="noindex">
<style>${CSS}</style></head><body><main style="padding-top:56px;text-align:center"><h1 class="ok">${ro ? 'Plata a reușit' : 'Payment successful'}</h1><p>${esc(text)}</p>
<a class="btn" href="/cont#mine">${ro ? 'Vezi contul meu' : 'See my account'}</a><a class="btn ghost" href="/">${ro ? 'Programează-te' : 'Book a visit'}</a></main></body></html>`);
});

// Scriptul paginii (fără bibliotecă). Tot ce se cumpără trece prin rutele aplicației, cu `?web=1` ca întoarcerea să fie pe site.
const JS = `(function(){
var C=window.CFG,L=C.L,app=document.getElementById('app');
var tok=null;try{tok=localStorage.getItem('taf-token')}catch(x){}
var me=null,tab=(location.hash||'').slice(1)||'subs',data={},cart={},qty={},barberId=null,autoRenew=true,after=null,cfTok=null,login={step:1,phone:'',isNew:false,legal:null};
if(['subs','custom','shop','gift','mine'].indexOf(tab)<0)tab='subs';
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function t(k,v){var s=L[k];return v!=null?String(s).replace('{t}',v):s}
function lei(n){return(Math.round(n*100)/100).toString().replace('.',',')+' lei'}
function day(iso){try{return new Date(iso).toLocaleDateString(C.lang==='ro'?'ro-RO':'en-GB',{day:'numeric',month:'long',year:'numeric'})}catch(x){return iso.slice(0,10)}}
function $(i){return document.getElementById(i)}
function api(m,p,b){var h={'content-type':'application/json'};if(tok)h.authorization='Bearer '+tok;return fetch('/v1'+p+(p.indexOf('?')>=0?'&':'?')+'lang='+C.lang,{method:m,headers:h,body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().catch(function(){return null}).then(function(j){if(r.status===401&&tok){logout(true)}if(!r.ok)throw new Error((j&&j.error)||'server_error');return j})})}
function msg(id,x){var el=$(id);if(el)el.textContent=x?(L.E[x.message||x]||L.err):''}
function setTok(v){tok=v;try{v?localStorage.setItem('taf-token',v):localStorage.removeItem('taf-token')}catch(x){}}
function logout(silent){setTok(null);me=null;data.mine=null;if(!silent)render()}
function loadMe(){if(!tok)return Promise.resolve(null);return api('GET','/me').then(function(m){me=m;return m},function(){me=null;return null})}
function go(url){location.href=url}
// Cumpărarea cere cont (și termenii semnați); după intrare, cumpărarea pornește singură.
function need(fn){if(me&&!me.legalPending)return fn();after=fn;render();setTimeout(function(){var b=$('loginbox');if(b)b.scrollIntoView({behavior:'smooth',block:'center'})},50)}
function busy(b,on){if(b)b.disabled=on}

// --- Intrarea în cont (cod prin SMS sau pe e-mail), contul nou cu termenii semnați ---
function legalBox(){return'<div class="legal" id="legal">…</div><p class="m" id="lhint">'+e(t('scroll'))+'</p><label class="chk"><input type="checkbox" id="terms" disabled><span>'+e(t('terms'))+'</span></label><label>'+e(t('sig'))+'<input id="sig" maxlength="120" autocomplete="off"></label>'}
function loadLegal(){login.legal=null;Promise.all([api('GET','/legal/terms'),api('GET','/legal/privacy')]).then(function(r){login.legal=r;var box=$('legal');if(!box)return;box.innerHTML='<b>'+e(r[0].title)+'</b>\\n'+e(r[0].body)+'\\n\\n<b>'+e(r[1].title)+'</b>\\n'+e(r[1].body);box.onscroll=function(){if(box.scrollTop+box.clientHeight>=box.scrollHeight-30){$('terms').disabled=false;$('lhint').hidden=true}}},function(){var box=$('legal');if(box)box.textContent=L.err})}
function sigOk(){var s=$('sig').value.replace(/\\s+/g,' ').trim();return login.legal&&$('terms').checked&&(s.match(/[A-Za-z\\u00C0-\\u024F]/g)||[]).length>=3?s:null}
function loginHtml(){
if(me&&me.legalPending)return'<div class="card" id="loginbox"><div class="t">'+e(t('signTitle'))+'</div><p class="m">'+e(t('signText'))+'</p>'+legalBox()+'<button class="btn" id="dosign">'+e(t('sign'))+'</button><p class="e" id="lmsg"></p></div>';
var h='<div class="card" id="loginbox"><div class="t">'+e(t('login'))+'</div><p class="m">'+e(after?t('loginFirst'):t('loginWhy'))+'</p>';
if(login.step===1){h+='<label>'+e(t('phone'))+'<input id="phone" type="tel" autocomplete="tel" placeholder="07xx xxx xxx" value="'+e(login.phone)+'"></label>'+(C.otpSms?'':'<label>'+e(t('email'))+'<input id="email" type="email" autocomplete="email"></label>')+(C.captcha?'<div id="cf" style="margin:10px 0;min-height:65px"></div>':'')+'<button class="btn" id="send">'+e(t('sendCode'))+'</button>'}
else{h+='<p class="ok m" id="sent">'+e(login.sent||'')+'</p><label>'+e(t('code'))+'<input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>';
if(login.isNew)h+='<p class="m">'+e(t('newAcc'))+'</p><label>'+e(t('name'))+'<input id="name" autocomplete="name" maxlength="80"></label>'+(C.otpSms?'<label>'+e(t('email'))+'<input id="email2" type="email" autocomplete="email"></label>':'')+legalBox()+'<label class="chk"><input type="checkbox" id="mk"><span>'+e(t('marketing'))+'</span></label>';
h+='<button class="btn" id="verify">'+e(t('enter'))+'</button>'}
return h+'<p class="e" id="lmsg"></p></div>'}
function cfRender(n){var el=$('cf');if(!el)return;cfTok=null;if(!window.turnstile){if((n||0)<50)setTimeout(function(){cfRender((n||0)+1)},200);return}el.innerHTML='';turnstile.render(el,{sitekey:C.captcha,language:C.lang==='ar'?'ar-eg':C.lang,theme:'dark',callback:function(x){cfTok=x},'expired-callback':function(){cfTok=null},'error-callback':function(){cfTok=null}})}
function bindLogin(){
if($('cf'))cfRender();
if($('send'))$('send').onclick=function(){var b=this;msg('lmsg');if(C.captcha&&!cfTok)return msg('lmsg','captcha_required');busy(b,true);var body={phone:$('phone').value,channel:C.otpSms?'sms':'email'};if(!C.otpSms)body.email=$('email').value.trim();if(C.captcha)body.captcha=cfTok;login.phone=$('phone').value;
api('POST','/auth/otp',body).then(function(r){login.step=2;login.phone=r.phone;login.isNew=r.newAccount;login.sent=t('codeSentTo')+r.sentTo+(r.devCode?' ('+r.devCode+')':'');render();if(r.newAccount)loadLegal()},function(x){busy(b,false);msg('lmsg',x);if(C.captcha)cfRender()})};
if($('verify'))$('verify').onclick=function(){var b=this;msg('lmsg');var body={phone:login.phone,code:$('code').value.trim(),lang:C.lang};
if(login.isNew){body.name=$('name').value.trim();if(!body.name)return msg('lmsg','name_required');var s=sigOk();if(!s){$('lmsg').textContent=t('sigNeeded');return}body.acceptTerms=true;body.signature=s;body.termsVersion=login.legal[0].version;body.privacyVersion=login.legal[1].version;body.marketing=$('mk').checked;if(C.otpSms)body.email=$('email2').value.trim()}
busy(b,true);api('POST','/auth/verify',body).then(function(v){setTok(v.token);login={step:1,phone:'',isNew:false,legal:null};return loadMe()}).then(function(){if(me&&me.legalPending){render();loadLegal();return}var f=after;after=null;render();if(f)f()},function(x){busy(b,false);msg('lmsg',x)})};
if($('dosign')){if(!login.legal)loadLegal();$('dosign').onclick=function(){var b=this;var s=sigOk();if(!s){$('lmsg').textContent=t('sigNeeded');return}busy(b,true);api('POST','/me/legal-sign',{signature:s,termsVersion:login.legal[0].version,privacyVersion:login.legal[1].version,lang:C.lang}).then(function(){me.legalPending=false;var f=after;after=null;render();if(f)f()},function(x){busy(b,false);msg('lmsg',x)})}}}

// --- Abonamentele din panou (Abonamente) ---
function subs(){return(data.plans?Promise.resolve(data.plans):api('GET','/plans').then(function(p){data.plans=p;return p})).then(function(list){if(!list.length)return'<p class="m">'+e(t('noPlans'))+'</p>';
return list.map(function(p){return'<div class="card">'+(p.photoUrl?'<div style="margin:-16px -16px 12px;aspect-ratio:2/1;border-radius:18px 18px 0 0;background:#1a1a1a url(&quot;'+e(p.photoUrl)+'&quot;) center/cover"></div>':'')+'<div class="row"><div class="grow"><div class="t">'+e(p.name)+'</div><div class="m">'+e(t('perDays',p.periodDays))+' · '+e(p.cuts==null?t('unlimited'):t('cuts',p.cuts))+'</div></div><div class="price">'+lei(p.price)+'</div></div>'+(p.description?'<p class="m" style="white-space:pre-line">'+e(p.description)+'</p>':'')+'<button class="btn" data-plan="'+e(p.id)+'">'+e(t('buy'))+' · '+lei(p.price)+'</button><p class="e" id="pm-'+e(p.id)+'"></p></div>'}).join('')})}
function buyPlan(id,b){need(function(){busy(b,true);api('POST','/me/subscriptions/'+encodeURIComponent(id)+'/pay?web=1').then(function(r){go(r.url)},function(x){busy(b,false);msg('pm-'+id,x)})})}

// --- Abonamentul personalizat (pe frizer, cu reducerea pe număr de vizite) ---
function customView(){if(!C.custom)return Promise.resolve('<p class="m">'+e(t('customOff'))+'</p>');
return Promise.all([data.cs||api('GET','/custom-sub'),data.svcs||api('GET','/services'),data.barbers||api('GET','/barbers')]).then(function(r){data.cs=r[0];data.svcs=r[1];data.barbers=r[2];var cs=r[0];if(!cs.enabled)return'<p class="m">'+e(t('customOff'))+'</p>';
var bs=data.barbers;if(bs.length===1)barberId=bs[0].id;var br=bs.filter(function(b){return b.id===barberId})[0]||null;
var h='<p class="m">'+e(t('customIntro'))+'</p>';var tiers=Object.keys(cs.discounts).sort(function(a,b){return a-b}).map(function(k){return k+' '+L.vis+': −'+cs.discounts[k]+'%'}).join(' · ');if(tiers)h+='<p class="m"><b>'+e(tiers)+'</b></p>';
if(bs.length>1)h+='<div class="card"><div class="t">'+e(t('barber'))+'</div><div class="chips">'+bs.map(function(b){return'<button data-br="'+e(b.id)+'" class="'+(b.id===barberId?'on':'')+'">'+e(b.name)+'</button>'}).join('')+'</div><p class="m">'+e(t('barberInfo'))+'</p></div>';
if(bs.length>1&&!br)return h;
var list=data.svcs.filter(function(s){return(!cs.serviceIds.length||cs.serviceIds.indexOf(s.id)>=0)&&(!br||!br.serviceIds||!br.serviceIds.length||br.serviceIds.indexOf(s.id)>=0)});
var visits=Object.keys(qty).reduce(function(a,k){return a+(list.some(function(s){return s.id===k})?qty[k]:0)},0);
h+='<div class="card">'+list.map(function(s){var q=qty[s.id]||0,price=br&&br.prices&&br.prices[s.id]!=null?br.prices[s.id]:s.price;return'<div class="row" style="padding:8px 0"><div class="grow"><div class="t" style="font-size:16px">'+e(s.name)+'</div><div class="m">'+lei(price)+'</div></div><div class="qty"><button data-dec="'+e(s.id)+'">−</button><b>'+q+'</b><button data-inc="'+e(s.id)+'"'+(visits>=cs.maxVisits?' disabled':'')+'>+</button></div></div>'}).join('')+'<hr><div class="m">'+e(t('visits',visits+' / '+cs.maxVisits))+'</div><div id="quote"></div></div>';
h+='<div class="card"><label class="radio"><input type="radio" name="ar" value="1"'+(autoRenew?' checked':'')+'><span><b>'+e(t('autoRenew'))+'</b><br><span class="m">'+e(t('autoRenewText'))+'</span></span></label><hr><label class="radio"><input type="radio" name="ar" value="0"'+(autoRenew?'':' checked')+'><span><b>'+e(t('manual'))+'</b><br><span class="m">'+e(t('manualText'))+'</span></span></label></div>';
h+='<button class="btn" id="buycustom" disabled>'+e(t('buy'))+'</button><p class="e" id="cmsg"></p>';return h})}
function customItems(){return Object.keys(qty).filter(function(k){return qty[k]>0}).map(function(k){return{serviceId:k,qty:qty[k]}})}
var qseq=0;
function quote(){var cs=data.cs,items=customItems(),v=items.reduce(function(a,i){return a+i.qty},0),box=$('quote'),b=$('buycustom');if(!box)return;
if(v<cs.minVisits){box.innerHTML='<p class="m">'+e(t('minVisits',cs.minVisits))+'</p>';if(b)b.disabled=true;return}
var my=++qseq;api('POST','/custom-sub/quote',{items:items,barberId:barberId}).then(function(q){if(my!==qseq)return;box.innerHTML='<div class="sum m"><span>'+e(t('full'))+'</span><s>'+lei(q.fullPrice)+'</s></div><div class="sum m"><span>'+e(t('discount'))+'</span><span>'+q.discount+'%</span></div><div class="sum"><b>'+e(t('total'))+'</b><b class="price">'+lei(q.price)+'</b></div>';if(b){b.disabled=false;b.textContent=t('buy')+' · '+lei(q.price)}},function(x){if(my!==qseq)return;box.innerHTML='<p class="e">'+e(L.E[x.message]||L.err)+'</p>';if(b)b.disabled=true})}
function buyCustom(b){need(function(){busy(b,true);msg('cmsg');api('POST','/me/custom-sub/pay?web=1',{items:customItems(),autoRenew:autoRenew,barberId:barberId}).then(function(r){go(r.url)},function(x){busy(b,false);msg('cmsg',x)})})}

// --- Magazinul (produsele din panou) ---
function shop(){return(data.products?Promise.resolve(data.products):api('GET','/products').then(function(p){data.products=p;return p})).then(function(list){if(!list.length)return'<p class="m">'+e(t('noProducts'))+'</p>';
var h=list.map(function(p){var out=p.stock!=null&&p.stock<=0,q=cart[p.id]||0;return'<div class="card"><div class="row">'+(p.imageUrl?'<div class="img" style="background-image:url(&quot;'+e(p.imageUrl)+'&quot;)"></div>':'')+'<div class="grow"><div class="t" style="font-size:16px">'+e(p.name)+'</div>'+(p.description?'<div class="m">'+e(p.description)+'</div>':'')+'<div class="price" style="font-size:16px;margin-top:4px">'+lei(p.price)+'</div></div>'+(out?'<span class="pill">'+e(t('stockOut'))+'</span>':'<div class="qty"><button data-pdec="'+e(p.id)+'">−</button><b>'+q+'</b><button data-pinc="'+e(p.id)+'"'+(q>=10||(p.stock!=null&&q>=p.stock)?' disabled':'')+'>+</button></div>')+'</div></div>'}).join('');
var items=list.filter(function(p){return cart[p.id]>0}),total=items.reduce(function(a,p){return a+p.price*cart[p.id]},0);
if(items.length)h+='<div class="card"><div class="t">'+e(t('cart'))+'</div>'+items.map(function(p){return'<div class="sum m"><span>'+cart[p.id]+' × '+e(p.name)+'</span><span>'+lei(p.price*cart[p.id])+'</span></div>'}).join('')+'<hr><div class="sum"><b>'+e(t('total'))+'</b><b class="price">'+lei(total)+'</b></div><label>'+e(t('note'))+'<textarea id="onote" maxlength="300"></textarea></label><p class="m">'+e(t('pickup'))+'</p>'+(C.pay&&total>=2?'<button class="btn" id="paycard">'+e(t('payCard'))+' · '+lei(total)+'</button>':'')+'<button class="btn ghost" id="paylater">'+e(t('payLater'))+'</button><p class="e" id="omsg"></p><p class="ok" id="ook"></p></div>';
return h})}
function order(card,b){need(function(){var items=Object.keys(cart).filter(function(k){return cart[k]>0}).map(function(k){return{productId:k,qty:cart[k]}});var n=$('onote');busy(b,true);msg('omsg');
api('POST','/orders',{items:items,note:n?n.value:''}).then(function(o){cart={};data.products=null;data.mine=null;if(!card){render();setTimeout(function(){var ok=$('ook');if(ok)ok.textContent=t('ordered',o.code)},50);alert(t('ordered',o.code));return}
return api('POST','/orders/'+encodeURIComponent(o.id)+'/pay?web=1').then(function(r){go(r.url)})},function(x){busy(b,false);msg('omsg',x)})})}

// --- Cardul cadou: pagina lui (/cadou), care îl pune și în cont dacă ești intrat ---
function gift(){return'<div class="card" style="text-align:center"><div class="t">'+e(t('tabs').gift)+'</div><p class="m">'+e(t('giftText'))+'</p><a class="btn" href="/cadou">'+e(t('giftCta'))+'</a></div>'}

// --- Contul meu: ce am cumpărat ---
function mine(){if(!me)return Promise.resolve('');return Promise.all([api('GET','/me/subscriptions'),api('GET','/me/orders'),api('GET','/me/gift-cards').then(null,function(){return{bought:[]}})]).then(function(r){
var subsL=r[0].subscriptions||[],orders=(r[1]&&r[1].orders)||r[1]||[],gifts=r[2].bought||[];
var h='<h2>'+e(t('mySubs'))+'</h2>'+(subsL.length?subsL.map(function(s){return'<div class="card"><div class="row"><div class="grow"><div class="t" style="font-size:16px">'+e(s.name)+'</div><div class="m">'+e(t('until',day(s.endsAt)))+(s.cutsLeft!=null?' · '+e(t('left',s.cutsLeft)):'')+'</div></div><span class="pill'+(s.state==='active'?' g':'')+'">'+e(L.st[s.state]||s.state)+'</span></div></div>'}).join(''):'<p class="m">'+e(t('none'))+'</p>');
h+='<h2>'+e(t('myOrders'))+'</h2>'+(orders.length?orders.map(function(o){var payable=!o.paidAt&&(o.status==='new'||o.status==='ready')&&C.pay&&o.total>=2;return'<div class="card"><div class="row"><div class="grow"><div class="t" style="font-size:16px">#'+e(o.code)+' · '+lei(o.total)+'</div><div class="m">'+o.items.map(function(i){return i.qty+' × '+e(i.name)}).join(', ')+'</div></div><span class="pill'+(o.paidAt?' g':'')+'">'+e(o.paidAt?t('paid'):(L.st[o.status]||o.status))+'</span></div>'+(payable?'<button class="btn" data-opay="'+e(o.id)+'">'+e(t('payNow'))+' · '+lei(o.total)+'</button><p class="e" id="op-'+e(o.id)+'"></p>':'')+'</div>'}).join(''):'<p class="m">'+e(t('none'))+'</p>');
h+='<h2>'+e(t('myGifts'))+'</h2>'+(gifts.length?gifts.map(function(g){return'<div class="card"><div class="row"><div class="grow"><div class="t" style="font-size:16px">'+lei(g.amount)+(g.recipientName?' · '+e(g.recipientName):'')+'</div><div class="m">'+(g.code?'<b style="color:#F9A11B;letter-spacing:1px">'+e(g.code)+'</b>':'')+(g.expiresAt?' · '+e(t('until',day(g.expiresAt))):'')+'</div></div><span class="pill'+(g.status==='active'?' g':'')+'">'+e(L.st[g.status]||g.status)+'</span></div></div>'}).join(''):'<p class="m">'+e(t('none'))+'</p>');
return h+'<button class="btn ghost" id="logout">'+e(t('logout'))+'</button>'})}

// --- Pagina ---
var seq=0;
function render(){var my=++seq;var tabs=['subs'].concat(C.custom?['custom']:[]).concat(['shop']).concat(C.gift&&C.pay?['gift']:[]).concat(['mine']);if(tabs.indexOf(tab)<0)tab='subs';
var top=(C.cancelled?'<p class="e">'+e(t('cancelled'))+'</p>':'')+(!C.pay?'<p class="e">'+e(L.E.payments_off)+'</p>':'')+(me&&!me.legalPending?'<div class="row" style="margin:6px 0"><div class="grow m">'+e(t('hello',(me.name||'').split(' ')[0]||me.phone))+'</div></div>':'');
var lg=(!me||me.legalPending)&&(after||tab==='mine')?loginHtml():'';
var nav='<div class="tabs">'+tabs.map(function(k){return'<button data-tab="'+k+'" class="'+(k===tab?'on':'')+'">'+e(L.tabs[k])+'</button>'}).join('')+'</div>';
var body=tab==='subs'?subs():tab==='custom'?customView():tab==='shop'?shop():tab==='gift'?gift():mine();
var shell=function(h){return top+nav+lg+h};
app.innerHTML=shell('<div class="sp">…</div>');
Promise.resolve(body).then(function(h){if(my!==seq)return;app.innerHTML=shell(h);wire();if(tab==='custom')quote()},function(){if(my!==seq)return;app.innerHTML=shell('<p class="e">'+e(L.err)+'</p>');wire()})}
function wire(){var q=function(s){return Array.prototype.slice.call(app.querySelectorAll(s))};bindLogin();
var ont=app.querySelector('.tabs .on'),bar=app.querySelector('.tabs');if(ont&&bar)bar.scrollLeft=ont.offsetLeft-bar.offsetLeft-16;
q('[data-tab]').forEach(function(x){x.onclick=function(){tab=x.dataset.tab;after=null;history.replaceState(null,'','#'+tab);render()}});
q('[data-plan]').forEach(function(x){x.onclick=function(){buyPlan(x.dataset.plan,x)}});
q('[data-br]').forEach(function(x){x.onclick=function(){barberId=x.dataset.br;qty={};render()}});
q('[data-inc]').forEach(function(x){x.onclick=function(){qty[x.dataset.inc]=(qty[x.dataset.inc]||0)+1;render()}});
q('[data-dec]').forEach(function(x){x.onclick=function(){qty[x.dataset.dec]=Math.max(0,(qty[x.dataset.dec]||0)-1);render()}});
q('input[name=ar]').forEach(function(x){x.onchange=function(){autoRenew=x.value==='1'}});
var bc=$('buycustom');if(bc)bc.onclick=function(){buyCustom(bc)};
q('[data-pinc]').forEach(function(x){x.onclick=function(){cart[x.dataset.pinc]=(cart[x.dataset.pinc]||0)+1;render()}});
q('[data-pdec]').forEach(function(x){x.onclick=function(){cart[x.dataset.pdec]=Math.max(0,(cart[x.dataset.pdec]||0)-1);render()}});
var pc=$('paycard');if(pc)pc.onclick=function(){order(true,pc)};var pl=$('paylater');if(pl)pl.onclick=function(){order(false,pl)};
q('[data-opay]').forEach(function(x){x.onclick=function(){var id=x.dataset.opay;busy(x,true);api('POST','/orders/'+encodeURIComponent(id)+'/pay?web=1').then(function(r){go(r.url)},function(err){busy(x,false);msg('op-'+id,err)})}});
var lo=$('logout');if(lo)lo.onclick=function(){logout()}}
loadMe().then(function(){render();if(me&&me.legalPending)loadLegal()});
})();`;
