// Cardul cadou cumpărat direct de pe site, fără aplicație și fără cont: app.tafbarbers.ro/cadou.
// Pagina arată pachetul (campania de sezon din panou, ex. „Experiența TAF · 120 lei”, sau cardul cadou obișnuit),
// cumpărătorul scrie cui îl dă și plătește cu cardul (Stripe). După plată vede voucherul cu codul, gata de printat sau
// de trimis, îl primește și pe e-mail, iar cel care îl primește are codul prin SMS (dacă mesajul e pornit în panou).
import { Hono } from 'hono';
import { normalizePhone, optionalSession } from './auth';
import { requireCaptcha, captchaSiteKey } from './captcha';
import { getBusiness } from './db';
import { HttpError, onlinePaymentsOn, type AppEnv, type Env } from './env';
import { createGiftCard, getAutomations, voucherKey, voucherUrl } from './growth';
import { createCheckout, publicBase } from './payments';
import { ipHash } from './qr';
import { activeSeason } from './seasonCampaign';
import { giftBase, quotePromo } from './giftPromo';
import { iso } from './time';

export const giftWebPublic = new Hono<AppEnv>();

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const GOLD = '#F9A11B';


/** Ce se vinde pe pagină: campania de sezon (dacă duce la cardul cadou) sau cardul cadou obișnuit. */
async function offer(env: Env) {
  const [g, season, biz] = await Promise.all([getAutomations(env), activeSeason(env), getBusiness(env)]);
  const s = season?.target === 'gift_card' ? season : null;
  // Pachetul de sezon cu preț de ofertă (ex. Experiența TAF, 180 lei → 149,99): pagina vinde doar pachetul.
  const pkg = s && s.packagePrice && s.amount ? { name: s.packageName, items: s.packageItems.split(',').map((x) => x.trim()).filter(Boolean), value: s.amount, price: s.packagePrice } : null;
  const amounts = pkg ? [pkg.value] : s?.amount && !g.giftCard.amounts.includes(s.amount) ? [...g.giftCard.amounts, s.amount].sort((a, b) => a - b) : g.giftCard.amounts;
  return {
    on: g.giftCard.enabled,
    pay: onlinePaymentsOn(env),
    biz,
    amounts,
    preset: s?.amount ?? null,
    pkg,
    validMonths: g.giftCard.validMonths,
    kicker: s?.kicker.ro || 'CARD CADOU',
    title: s?.title.ro || `Fă cadou o vizită la ${biz.name}`,
    text: s?.text.ro || 'Un card cadou cu urarea ta, pentru orice serviciu din salon. Ajunge pe loc prin SMS.',
    cta: s?.cta.ro || 'Cumpără cardul cadou',
    wish: s?.wish.ro || '',
    imageUrl: s?.imageUrl ?? '/campanii/craciun.jpg',
  };
}

const PAGE_CSS = `*{box-sizing:border-box}body{margin:0;background:#000;color:#eee;font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
main{max-width:560px;margin:0 auto;padding:0 18px 48px}.hero{margin:0 -18px;aspect-ratio:2/1;background:#111 center/cover}
.k{color:${GOLD};font-weight:800;letter-spacing:1.6px;font-size:12px;margin-top:20px}h1{font-size:27px;line-height:1.2;margin:6px 0 8px}.m{color:#a6a6ad;font-size:14px}
.card{background:#111;border:1px solid #2a2a2a;border-radius:18px;padding:16px;margin:16px 0}label{display:block;font-size:14px;color:#cfcfd4;margin-top:10px}
input,textarea{width:100%;background:#0b0b0b;border:1px solid #333;border-radius:12px;color:#eee;font-size:16px;padding:13px;margin-top:5px;font-family:inherit}textarea{min-height:70px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.chips button{background:transparent;border:1px solid #3a3a3a;color:#eee;border-radius:999px;padding:10px 18px;font-weight:700;font-size:15px;cursor:pointer}
.chips button.on{background:${GOLD};border-color:${GOLD};color:#000}.pay{width:100%;background:${GOLD};color:#000;font-weight:800;border:0;border-radius:14px;padding:16px;font-size:17px;cursor:pointer;margin-top:16px}
.pay[disabled]{opacity:.5}.steps{display:grid;gap:8px;margin:0;padding:0;list-style:none}.steps li{display:flex;gap:10px;align-items:flex-start}.n{flex:none;width:24px;height:24px;border-radius:12px;background:${GOLD};color:#000;font-weight:800;font-size:13px;display:grid;place-items:center}
.e{color:#ff6b6b}.ok{color:#8FC79A}a{color:${GOLD}}.chk{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#a6a6ad}.chk input{width:auto;margin-top:3px}
.pkg{border:2px solid ${GOLD};border-radius:20px;background:radial-gradient(ellipse at 50% 0%,#2a1d0b 0%,#111 70%);padding:18px;margin:16px 0;position:relative}
.badge{position:absolute;top:-12px;right:16px;background:#c0392b;color:#fff;font-weight:800;font-size:13px;padding:4px 12px;border-radius:999px}
.pkg h2{margin:0;font-size:22px}.inc{list-style:none;padding:0;margin:10px 0;display:grid;gap:4px;font-size:15px}.inc li:before{content:"✓ ";color:${GOLD};font-weight:800}
.prices{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:6px}.old{color:#8a8a90;text-decoration:line-through;font-size:20px;font-weight:700}.now{font-size:38px;font-weight:800;color:#fff}.now.x{font-size:22px;color:#8a8a90;text-decoration:line-through}
.final{font-size:40px;font-weight:800;color:${GOLD}}.save{color:#8FC79A;font-weight:700;font-size:14px}`;
/** Preț în lei, cu virgulă la bani: 149,99 / 180. */
const fmtLei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

const head = (title: string, desc: string, image: string, url: string) => `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary_large_image">
<style>${PAGE_CSS}</style>`;

giftWebPublic.get('/cadou', async (c) => {
  const o = await offer(c.env);
  const base = publicBase(c.env, c.req.url);
  const img = o.imageUrl ? (o.imageUrl.startsWith('/') ? base + o.imageUrl : o.imageUrl) : '';
  const captcha = await captchaSiteKey(c.env);
  const cancelled = c.req.query('anulat') === '1';
  const top = `${head(`${o.title} · ${o.biz.name}`, o.text, img, `${base}/cadou`)}</head><body>${img ? `<div class="hero" style="background-image:url('${esc(img)}')"></div>` : ''}<main>`;
  if (!o.on || !o.pay) {
    return c.html(`${top}<div class="k">${esc(o.kicker)}</div><h1>${esc(o.title)}</h1><p class="m">Momentan cardurile cadou nu se vând online. Le găsești la salon${o.biz.phone ? ` sau ne suni la <a href="tel:${esc(o.biz.phone)}">${esc(o.biz.phone)}</a>` : ''}.</p></main></body></html>`);
  }
  const amounts = o.amounts.map((a) => `<button type="button" data-a="${a}" class="${a === o.preset ? 'on' : ''}">${a} lei</button>`).join('');
  const pk = o.pkg;
  const pct = pk ? Math.round((1 - pk.price / pk.value) * 100) : 0;
  const choose = pk
    ? `<div class="pkg" id="pk"><div class="badge" id="pkb">−${pct}%</div><h2>${esc(pk.name)}</h2>${pk.items.length ? `<ul class="inc">${pk.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<div id="pkp"><div class="prices"><span class="old">${fmtLei(pk.value)} lei</span><span class="now">${fmtLei(pk.price)} lei</span></div><div class="save">Ofertă · economisești ${fmtLei(Math.round((pk.value - pk.price) * 100) / 100)} lei</div></div></div>`
    : '';
  return c.html(`${top}
<div class="k">${esc(o.kicker)}</div><h1>${esc(o.title)}</h1><p>${esc(o.text)}</p>
${cancelled ? '<p class="e">Plata a fost anulată și nu s-a luat niciun ban. Poți încerca din nou.</p>' : ''}
${choose}<div class="card"><ol class="steps"><li><span class="n">1</span><span>${pk ? 'Scrii cui îi faci cadou.' : 'Alegi suma și scrii cui îi faci cadou.'}</span></li><li><span class="n">2</span><span>Plătești cu cardul, în siguranță, prin Stripe.</span></li><li><span class="n">3</span><span>Primești pe loc voucherul cu codul, de printat sau de trimis. Dacă scrii telefonul celui care îl primește, îi trimitem codul și prin SMS.</span></li></ol></div>
<form id="f" class="card" novalidate>
${pk ? '' : `<b>Suma</b><div class="chips" id="am">${amounts}</div>`}
<label${pk ? ' style="margin-top:0"' : ''}>Pentru cine este (numele)<input id="rn" maxlength="80" placeholder="ex. Andrei" required></label>
<label>Telefonul lui (opțional, ca să primească codul prin SMS)<input id="rp" type="tel" placeholder="07xx xxx xxx" autocomplete="off"></label>
<label>Urarea ta (apare pe voucher)<textarea id="msg" maxlength="200">${esc(o.wish)}</textarea></label>
<hr style="border:0;border-top:1px solid #2a2a2a;margin:18px 0 6px">
<label>Numele tău<input id="bn" maxlength="80" autocomplete="name" required></label>
<label>Telefonul tău<input id="bp" type="tel" placeholder="07xx xxx xxx" autocomplete="tel" required></label>
<label>E-mailul tău (opțional, primești voucherul și pe e-mail)<input id="be" type="email" placeholder="nume@exemplu.ro" autocomplete="email"></label>
<label>Ai un cod de reducere?</label><div style="display:flex;gap:8px;margin-top:5px"><input id="pc" maxlength="30" placeholder="ex. CRACIUN-AB3CD" autocomplete="off" style="margin:0;text-transform:uppercase"><button type="button" id="pcb" style="flex:none;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:12px;padding:0 16px;font-weight:700;cursor:pointer">Aplică</button></div><p id="pcm" class="m" style="margin:6px 0 0"></p>
<p class="chk" style="margin-top:14px"><input type="checkbox" id="t"><span>Am citit <a href="/legal/terms" target="_blank">Termenii</a> și <a href="/legal/privacy" target="_blank">Politica de confidențialitate</a>. Folosim datele doar pentru acest card cadou.</span></p>
${captcha ? '<div id="cf" style="margin:10px 0;min-height:65px"></div>' : ''}
<button class="pay" id="go">${esc(o.cta)}</button>
<p class="m" style="text-align:center;margin:10px 0 0">Valabil ${o.validMonths} luni, ${pk ? `pentru ${esc(pk.name)}` : 'pentru orice serviciu'} la ${esc(o.biz.name)}${o.biz.address ? `, ${esc(o.biz.address)}` : ''}.</p>
<p id="err" class="e"></p></form></main>
${captcha ? `<script>let cfTok=null;window.cfGo=()=>turnstile.render('#cf',{sitekey:${JSON.stringify(captcha)},language:'ro',theme:'dark',callback:(x)=>{cfTok=x},'expired-callback':()=>{cfTok=null},'error-callback':()=>{cfTok=null}});</script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=cfGo&render=explicit" async defer></script>` : '<script>const cfTok=null;</script>'}
<script>
const $=(i)=>document.getElementById(i);
// Intrat în cont pe site (pagina „Contul meu”): cardul intră în contul lui, iar numele și telefonul se completează singure.
let tok=null;try{tok=localStorage.getItem('taf-token')}catch(_){}
if(tok)fetch('/v1/me',{headers:{authorization:'Bearer '+tok}}).then(r=>r.ok?r.json():null).then(m=>{if(!m)return;if(!$('bn').value)$('bn').value=m.name||'';if(!$('bp').value)$('bp').value=m.phone||'';if(!$('be').value)$('be').value=m.email||''}).catch(()=>{});
let amount=${pk ? pk.value : (o.preset ?? 'null')};const PK=${pk ? JSON.stringify({ value: pk.value, price: pk.price }) : 'null'};
const fmt=(n)=>Number(n).toLocaleString('ro-RO',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});
const E={invalid_amount:'Alege o sumă.',recipient_required:'Scrie pentru cine este cardul.',name_required:'Scrie numele tău.',invalid_phone:'Numărul de telefon nu pare corect.',invalid_email:'E-mailul nu pare corect.',terms_required:'Bifează că ai citit Termenii.',captcha_required:'Confirmă că nu ești robot.',captcha_failed:'Confirmă din nou că nu ești robot.',too_many_requests:'Prea multe încercări. Mai încearcă peste câteva minute.',gift_cards_off:'Momentan cardurile cadou nu se vând online.',payments_off:'Momentan plata cu cardul nu e disponibilă.',promo_invalid:'Codul de reducere nu mai e valabil.',promo_expired:'Codul de reducere a expirat.',promo_used_up:'Codul de reducere a fost deja folosit.'};
const P={promo_invalid:'Codul nu există sau nu mai e activ.',promo_expired:'Codul a expirat.',promo_used_up:'Codul a fost deja folosit.',too_many_requests:'Prea multe încercări. Mai încearcă peste câteva minute.'};
let promo=null;
const label=()=>{$('go').textContent=!amount?'Alege suma':promo?${JSON.stringify(o.cta)}+' · '+fmt(promo.price)+' lei':${JSON.stringify(o.cta)}+' · '+fmt(PK?PK.price:amount)+' lei';
if(PK){const save=Math.round((PK.value-(promo?promo.price:PK.price))*100)/100;$('pkb').textContent='−'+Math.round(save/PK.value*100)+'%';
$('pkp').innerHTML=promo?'<div class="prices"><span class="old">'+fmt(PK.value)+' lei</span><span class="now x">'+fmt(PK.price)+' lei</span></div><div class="prices"><span class="final">'+fmt(promo.price)+' lei</span><span class="save">economisești '+fmt(save)+' lei</span></div>'
:'<div class="prices"><span class="old">'+fmt(PK.value)+' lei</span><span class="now">'+fmt(PK.price)+' lei</span></div><div class="save">Ofertă · economisești '+fmt(save)+' lei</div>'}};label();
// Codul de reducere: se verifică la „Aplică” și din nou când schimbi suma. Linkul /cadou?cod=XYZ îl completează singur.
const applyPromo=async()=>{const code=$('pc').value.trim();promo=null;$('pcm').className='m';$('pcm').textContent='';label();if(!code)return;if(!amount){$('pcm').textContent='Alege întâi suma.';return}
try{const r=await fetch('/v1/gift-promo/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,amount})});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error((j&&j.error)||'x');promo=j;$('pcm').className='ok';$('pcm').textContent=PK?'✓ Cod aplicat: −'+fmt(j.discount)+' lei. Plătești '+fmt(j.price)+' lei.':'Cod aplicat: cardul are '+j.amount+' lei, tu plătești '+fmt(j.price)+' lei (−'+fmt(j.discount)+' lei).'}
catch(x){$('pcm').className='e';$('pcm').textContent=P[x.message]||'Codul nu a putut fi verificat.'}label()};
$('pcb').onclick=applyPromo;$('pc').onkeydown=(e)=>{if(e.key==='Enter'){e.preventDefault();applyPromo()}};
try{const q=new URLSearchParams(location.search).get('cod');if(q){$('pc').value=q;applyPromo()}}catch(_){}
if($('am'))$('am').onclick=(e)=>{const b=e.target.closest('button');if(!b)return;amount=Number(b.dataset.a);[...$('am').children].forEach(x=>x.className=x===b?'on':'');label();if($('pc').value.trim())applyPromo()};
$('f').onsubmit=async(e)=>{e.preventDefault();$('err').textContent='';$('go').disabled=true;
try{const r=await fetch('/v1/gift-web',{method:'POST',headers:Object.assign({'content-type':'application/json'},tok?{authorization:'Bearer '+tok}:{}),body:JSON.stringify({amount,recipientName:$('rn').value,recipientPhone:$('rp').value,message:$('msg').value,buyerName:$('bn').value,buyerPhone:$('bp').value,buyerEmail:$('be').value,promoCode:promo?promo.code:undefined,terms:$('t').checked,captcha:cfTok||undefined})});
const j=await r.json().catch(()=>null);if(!r.ok)throw new Error((j&&j.error)||'server_error');location.href=j.url}
catch(x){$('err').textContent=E[x.message]||'A apărut o problemă. Încearcă din nou sau sună-ne la salon.';$('go').disabled=false;if(window.turnstile&&$('cf')){try{turnstile.reset('#cf')}catch(_){}cfTok=null}}};
</script></body></html>`);
});

/** Prețul cu un cod de reducere (site și aplicație). Cel mult 30 de încercări pe oră de pe același IP. */
giftWebPublic.post('/v1/gift-promo/quote', async (c) => {
  const b = await c.req.json<{ code?: unknown; amount?: unknown }>().catch(() => ({}) as { code?: unknown; amount?: unknown });
  const ip = await ipHash(c.env, c);
  if (ip) {
    const now = iso(new Date());
    const n = await c.env.DB.prepare(`INSERT INTO assistant_usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1 RETURNING n`)
      .bind(now.slice(0, 10), `gift-promo:${ip}:${now.slice(11, 13)}`)
      .first<{ n: number }>();
    if ((n?.n ?? 0) > 30) throw new HttpError(429, 'too_many_requests');
  }
  const amount = Math.round(Number(b.amount));
  if (!(amount >= 10 && amount <= 5000)) throw new HttpError(400, 'invalid_amount');
  const q = await quotePromo(c.env, b.code, amount, (await giftBase(c.env, amount)).priceBani);
  return c.json({ code: q.code, amount: q.amount, discount: q.discount, price: q.price, kind: q.kind, value: q.value });
});

giftWebPublic.post('/v1/gift-web', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const o = await offer(c.env);
  if (!o.on) throw new HttpError(409, 'gift_cards_off');
  if (!o.pay) throw new HttpError(409, 'payments_off');
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const amount = Math.round(Number(b.amount));
  if (!o.amounts.includes(amount)) throw new HttpError(400, 'invalid_amount');
  const recipientName = str(b.recipientName, 80);
  if (!recipientName) throw new HttpError(400, 'recipient_required');
  const buyerName = str(b.buyerName, 80);
  if (!buyerName) throw new HttpError(400, 'name_required');
  const buyerPhone = normalizePhone(str(b.buyerPhone, 30));
  const recipientPhone = str(b.recipientPhone, 30) ? normalizePhone(str(b.recipientPhone, 30)) : null;
  const buyerEmail = str(b.buyerEmail, 120).toLowerCase() || null;
  if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new HttpError(400, 'invalid_email');
  if (b.terms !== true) throw new HttpError(400, 'terms_required');
  await requireCaptcha(c, b.captcha);
  // De pe același IP: cel mult 8 încercări pe oră (un card neplătit rămâne „de plătit” și nu costă nimic, dar nu umplem lista).
  const ip = await ipHash(c.env, c);
  if (ip) {
    const now = iso(new Date());
    const n = await c.env.DB.prepare(`INSERT INTO assistant_usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1 RETURNING n`)
      .bind(now.slice(0, 10), `gift-web:${ip}:${now.slice(11, 13)}`)
      .first<{ n: number }>();
    if ((n?.n ?? 0) > 8) throw new HttpError(429, 'too_many_requests');
  }
  // Intrat în cont pe site (/cont): cardul apare și la „Carduri cadou → Cumpărate” în contul lui (în aplicație și pe site).
  const who = await optionalSession(c);
  const buyerId = who?.kind === 'client' ? who.id : null;
  const id = await createGiftCard(c.env, buyerId, { amount, recipientName, recipientPhone, message: str(b.message, 200), promoCode: str(b.promoCode, 30) || undefined });
  const priced = await c.env.DB.prepare('SELECT coalesce(price_bani, amount_bani) AS p FROM gift_cards WHERE id = ?').bind(id).first<{ p: number }>();
  const payBani = priced?.p ?? amount * 100;
  await c.env.DB.prepare('UPDATE gift_cards SET web_buyer_name = ?, web_buyer_phone = ?, web_buyer_email = ? WHERE id = ?').bind(buyerName, buyerPhone, buyerEmail, id).run();
  const base = publicBase(c.env, c.req.url);
  const url = await createCheckout(c.env, {
    kind: 'gift',
    ref: id,
    amountBani: payBani,
    title: o.pkg ? `${o.pkg.name} · voucher cadou ${o.biz.name} (valoare ${amount} lei)` : `Card cadou ${o.biz.name} · ${amount} lei${payBani < amount * 100 ? ' (cu cod de reducere)' : ''}`,
    email: buyerEmail,
    base,
    clientId: buyerId ?? '',
    lang: 'ro',
    successUrl: await voucherUrl(c.env, base, id),
    cancelUrl: `${base}/cadou?anulat=1`,
  });
  return c.json({ url });
});

type VoucherRow = { id: string; code: string; amount_bani: number; status: string; recipient_name: string; message: string; expires_at: string | null; web_buyer_name: string | null; package_name: string | null; package_items: string | null };

/** Voucherul de după plată: codul, suma, pentru cine, de la cine și urarea, gata de printat (sau salvat ca PDF) ori trimis. */
giftWebPublic.get('/cadou/gata', async (c) => {
  const id = (c.req.query('id') ?? '').slice(0, 40);
  const k = c.req.query('k') ?? '';
  const biz = await getBusiness(c.env);
  const base = publicBase(c.env, c.req.url);
  const g = id && k === (await voucherKey(c.env, id)) ? await c.env.DB.prepare('SELECT id, code, amount_bani, status, recipient_name, message, expires_at, web_buyer_name, package_name, package_items FROM gift_cards WHERE id = ?').bind(id).first<VoucherRow>() : null;
  const top = `${head(`Card cadou · ${biz.name}`, 'Voucherul tău cadou', `${base}/campanii/craciun.jpg`, `${base}/cadou`)}<meta name="robots" content="noindex">`;
  if (!g) return c.html(`${top}</head><body><main style="padding-top:48px;text-align:center"><h1>Linkul nu e corect</h1><p class="m">Deschide linkul din e-mail sau sună-ne la salon${biz.phone ? `: <a href="tel:${esc(biz.phone)}">${esc(biz.phone)}</a>` : ''}.</p></main></body></html>`, 404);
  if (g.status === 'pending') {
    // Plata se confirmă prin Stripe în câteva secunde: pagina se reîncarcă singură.
    return c.html(`${top}<meta http-equiv="refresh" content="3"></head><body><main style="padding-top:64px;text-align:center"><h1>Se confirmă plata…</h1><p class="m">Durează câteva secunde. Voucherul apare aici imediat.</p></main></body></html>`);
  }
  const until = g.expires_at ? new Date(g.expires_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: c.env.TIMEZONE || 'Europe/Bucharest' }) : '';
  const items = (g.package_items ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const simg = g.package_name ? (await activeSeason(c.env))?.imageUrl : null;
  const pimg = simg ? (simg.startsWith('/') ? base + simg : simg) : `${base}/campanii/craciun.jpg`;
  const share = g.package_name ? `Ți-am făcut cadou ${g.package_name} (${items.join(', ')}) la ${biz.name}! Codul tău: ${g.code}${until ? `, valabil până pe ${until}` : ''}. Programare: ${base}` : `Ți-am făcut cadou un card de ${g.amount_bani / 100} lei la ${biz.name}! Codul tău: ${g.code}${until ? `, valabil până pe ${until}` : ''}. Programare: ${base}`;
  return c.html(`${top}<style>
.v{position:relative;margin:22px 0;border-radius:22px;overflow:hidden;border:2px solid ${GOLD};background:radial-gradient(ellipse at 50% 0%,#2a1d0b 0%,#0a0a0a 60%,#000 100%);text-align:center;padding:26px 20px}
.v .shop{font-family:Georgia,serif;font-style:italic;color:${GOLD};font-size:24px}.v .amt{font-size:54px;font-weight:800;color:#fff;line-height:1.1;margin:10px 0 2px}.v .code{display:inline-block;margin:14px 0;padding:10px 18px;border:1.5px dashed ${GOLD};border-radius:12px;color:${GOLD};font-size:26px;font-weight:800;letter-spacing:2px}
.v .wish{font-style:italic;color:#e8e2d4;margin:6px 0}.v.pk{padding:0 0 26px}.v .img{height:170px;background:#111 center/cover;margin-bottom:18px}.v .pn{font-size:38px;font-weight:800;color:#fff;line-height:1.15;margin:8px 0 4px}.v .inc{color:#cfcfd4;font-size:15px;padding:0 14px}.row{display:flex;gap:10px}.row a,.row button{flex:1;text-align:center;text-decoration:none;border-radius:14px;padding:14px;font-weight:800;font-size:15px;border:0;cursor:pointer}
.p{background:${GOLD};color:#000}.s{background:#1c1c1c;color:#eee;border:1px solid #333 !important}
@media print{body{background:#fff}.np{display:none}main{padding:0}.v{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><main>
<h1 class="np" style="margin-top:28px">Mulțumim! Voucherul e gata 🎁</h1><p class="m np">Printează-l sau trimite-l${g.recipient_name ? ` lui ${esc(g.recipient_name)}` : ''}. Salvează pagina: linkul e și în e-mail, dacă ți l-ai pus.</p>
${g.package_name
    ? `<div class="v pk"><div class="img" style="background-image:url('${esc(pimg)}')"></div><div class="shop">${esc(biz.name)}</div><div class="m" style="letter-spacing:2px;font-weight:700;color:${GOLD};margin-top:6px">VOUCHER CADOU</div>
<div class="pn">${esc(g.package_name)}</div>${items.length ? `<div class="inc">${esc(items.join(' · '))}</div>` : ''}<div class="m" style="margin-bottom:8px">valoare ${g.amount_bani / 100} lei</div>`
    : `<div class="v"><div class="shop">${esc(biz.name)}</div><div class="m" style="letter-spacing:2px;font-weight:700;color:${GOLD};margin-top:6px">CARD CADOU</div>
<div class="amt">${g.amount_bani / 100} lei</div>`}${g.recipient_name ? `<div>Pentru <b>${esc(g.recipient_name)}</b>${g.web_buyer_name ? `, de la <b>${esc(g.web_buyer_name.split(' ')[0] ?? '')}</b>` : ''}</div>` : ''}
${g.message ? `<div class="wish">„${esc(g.message)}”</div>` : ''}<div class="code">${esc(g.code)}</div>
<div class="m" style="padding:0 14px">${g.package_name ? `Programează-te în aplicația ${esc(biz.name)} sau sună la salon și spune codul.` : 'Se folosește la orice serviciu: spui codul la salon sau îl scrii în aplicație.'}${until ? `<br>Valabil până pe ${esc(until)}.` : ''}</div>
${biz.address || biz.phone ? `<div class="m" style="margin-top:8px">${esc(biz.address)}${biz.address && biz.phone ? ' · ' : ''}${esc(biz.phone)}</div>` : ''}</div>
<div class="row np"><button class="p" onclick="print()">Printează / PDF</button><a class="s" href="https://wa.me/?text=${encodeURIComponent(share)}" target="_blank" rel="noopener">Trimite pe WhatsApp</a></div>
<p class="m np" style="text-align:center;margin-top:16px"><a href="${base}">Programează-te la ${esc(biz.name)}</a></p></main></body></html>`);
});
