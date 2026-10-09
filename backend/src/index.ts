import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HttpError, type AppEnv, type Env } from './env';
import { adminRoutes } from './routes/admin';
import { clientRoutes } from './routes/client';
import { publicRoutes } from './routes/public';
import { scheduled } from './cron';
import { socialPublic } from './social';
import { assistantRoutes } from './assistant';
import { openAppPage, qrPublic } from './qr';
import { waitlistPublic } from './waitlist';
import { DOCS, legalDoc, type Doc } from './legal';
import { getBusiness } from './db';

const app = new Hono<AppEnv>();

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
app.route('/v1', publicRoutes);
app.route('/v1', socialPublic);
app.route('/v1', assistantRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/v1', clientRoutes);
app.route('/', qrPublic);
app.route('/', waitlistPublic);

// Pagini publice pentru regulamente (link pentru App Store / Google Play și site).
app.get('/legal/:doc', async (c) => {
  const doc = c.req.param('doc') as Doc;
  if (!DOCS.includes(doc)) return c.text('Not found', 404);
  const lang = ['ro', 'en', 'fr'].includes(c.req.query('lang') ?? '') ? c.req.query('lang')! : 'ro';
  const d = await legalDoc(c.env, doc, lang);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const updated = d.updatedAt ? `<p class="m">Actualizat: ${d.updatedAt.slice(0, 10)}</p>` : '';
  return c.html(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title>
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px}h1{color:#F9A11B;font-size:26px}.m{color:#999;font-size:14px}p{white-space:pre-wrap}</style></head>
<body><main><h1>${esc(d.title)}</h1>${updated}<p>${esc(d.body)}</p></main></body></html>`);
});

// Linkul de recomandare: pagină simplă care deschide aplicația cu codul completat.
app.get('/r/:code', async (c) => {
  const code = c.req.param('code').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const biz = await getBusiness(c.env);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const deep = `tafbarbers://login?ref=${code}`;
  return c.html(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(biz.name)}</title>
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:48px 20px;text-align:center}h1{font-size:26px}.code{font-size:34px;font-weight:800;letter-spacing:6px;color:#F9A11B;margin:18px 0}a.b{display:inline-block;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-top:10px}.m{color:#999;font-size:14px}</style></head>
<body><main><h1>Ai fost invitat la ${esc(biz.name)}</h1><p>Fă-ți cont în aplicație cu codul de mai jos:</p><div class="code">${esc(code)}</div>
<a class="b" href="${deep}">Deschide aplicația</a><p class="m">Dacă nu ai încă aplicația, instaleaz-o, apoi scrie codul la crearea contului.</p></main></body></html>`);
});

// Ștergerea contului de pe web, fără aplicație (cerută de Google Play): codul vine pe SMS sau pe e-mailul din cont,
// apoi contul se șterge la fel ca din aplicație (Cont → Șterge contul).
app.get('/sterge-cont', async (c) => {
  const biz = await getBusiness(c.env);
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
<button>Trimite codul</button></form>
<form id="f2" hidden><label>Codul primit<input id="code" inputmode="numeric" maxlength="6" placeholder="123456" required></label>
<p id="dev" class="m"></p><button class="d">Șterge definitiv contul</button></form>
<p id="msg"></p></main>
<script>
const $=(i)=>document.getElementById(i),msg=(t,ok)=>{$('msg').textContent=t;$('msg').className=ok?'ok':'e'};
const E={invalid_phone:'Numărul de telefon nu pare corect.',email_mismatch:'E-mailul nu e cel din cont.',email_not_on_account:'Contul nu are e-mail; lasă câmpul gol și primești codul prin SMS.',too_many_requests:'Ai cerut un cod de curând. Mai încearcă peste un minut.',wrong_code:'Codul nu e corect.',too_many_attempts:'Prea multe încercări greșite. Încearcă din nou peste o oră.',code_expired:'Codul a expirat. Cere altul.',terms_required:'Nu există niciun cont cu acest număr.',birth_date_required:'Nu există niciun cont cu acest număr.',email_required:'Nu există niciun cont cu acest număr.'};
const call=async(m,p,b,t)=>{const r=await fetch('/v1'+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error((j&&j.error)||'server_error');return j};
let phone='';
$('f1').onsubmit=async(e)=>{e.preventDefault();msg('');try{const email=$('email').value.trim();const r=await call('POST','/auth/otp',{phone:$('phone').value,...(email?{email,channel:'email'}:{channel:'sms'})});
if(r.newAccount){msg('Nu există niciun cont cu acest număr.');return}phone=r.phone;$('f1').hidden=true;$('f2').hidden=false;msg('Ți-am trimis codul la '+r.sentTo+'.',true);if(r.devCode)$('dev').textContent='Server de test, codul este '+r.devCode;}catch(x){msg(E[x.message]||'A apărut o problemă. Încearcă din nou.')}};
$('f2').onsubmit=async(e)=>{e.preventDefault();msg('');if(!confirm('Sigur ștergi contul? Nu se mai poate recupera.'))return;try{const v=await call('POST','/auth/verify',{phone,code:$('code').value.trim()});await call('DELETE','/me',null,v.token);
$('f2').hidden=true;msg('Contul a fost șters. Îți mulțumim că ai fost clientul nostru.',true)}catch(x){msg(E[x.message]||'A apărut o problemă. Încearcă din nou.')}};
</script></body></html>`);
});

// Paginile la care revine clientul de pe Stripe. Starea reală vine prin webhook; aici doar îl trimitem înapoi în aplicație.
app.get('/plata/:rez', async (c) => {
  const ok = c.req.param('rez') === 'gata';
  const tip = c.req.query('tip');
  const biz = await getBusiness(c.env);
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const deep = tip === 'gift' ? 'tafbarbers://gift-cards' : tip === 'booking' ? 'tafbarbers://bookings' : 'tafbarbers://shop/orders';
  const title = ok ? 'Plata a reușit' : 'Plata a fost anulată';
  const text = ok
    ? tip === 'gift'
      ? 'Mulțumim! Cardul cadou se activează imediat, iar cel care îl primește are codul prin SMS și în aplicație.'
      : tip === 'booking'
        ? `Mulțumim! Programarea e plătită. Dacă o anulezi la timp, banii se întorc singuri pe card.`
        : 'Mulțumim! Comanda e plătită; o ridici de la salon când îți scriem că e gata.'
    : 'Nu s-a luat niciun ban. Poți încerca din nou din aplicație sau poți plăti la salon.';
  return c.html(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${esc(biz.name)}</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}main{max-width:480px;margin:0 auto;padding:56px 20px;text-align:center}h1{font-size:26px;color:${ok ? '#8FC79A' : '#F9A11B'}}a.b{display:inline-block;background:#F9A11B;color:#000;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-top:14px}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><a class="b" href="${deep}">Înapoi în aplicație</a></main></body></html>`);
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
  return c.html(await openAppPage(c.env, `tafbarbers://book?src=${src}`));
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: async (_e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;
