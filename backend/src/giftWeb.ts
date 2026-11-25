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
import { iso } from './time';

export const giftWebPublic = new Hono<AppEnv>();

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const GOLD = '#F9A11B';


/** Ce se vinde pe pagină: campania de sezon (dacă duce la cardul cadou) sau cardul cadou obișnuit. */
async function offer(env: Env) {
  const [g, season, biz] = await Promise.all([getAutomations(env), activeSeason(env), getBusiness(env)]);
  const s = season?.target === 'gift_card' ? season : null;
  const amounts = s?.amount && !g.giftCard.amounts.includes(s.amount) ? [...g.giftCard.amounts, s.amount].sort((a, b) => a - b) : g.giftCard.amounts;
  return {
    on: g.giftCard.enabled,
    pay: onlinePaymentsOn(env),
    biz,
    amounts,
    preset: s?.amount ?? null,
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
.e{color:#ff6b6b}.ok{color:#8FC79A}a{color:${GOLD}}.chk{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#a6a6ad}.chk input{width:auto;margin-top:3px}`;

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
  return c.html(`${top}
<div class="k">${esc(o.kicker)}</div><h1>${esc(o.title)}</h1><p>${esc(o.text)}</p>
${cancelled ? '<p class="e">Plata a fost anulată și nu s-a luat niciun ban. Poți încerca din nou.</p>' : ''}
<div class="card"><ol class="steps"><li><span class="n">1</span><span>Alegi suma și scrii cui îi faci cadou.</span></li><li><span class="n">2</span><span>Plătești cu cardul, în siguranță, prin Stripe.</span></li><li><span class="n">3</span><span>Primești pe loc voucherul cu codul, de printat sau de trimis. Dacă scrii telefonul celui care îl primește, îi trimitem codul și prin SMS.</span></li></ol></div>
<form id="f" class="card" novalidate>
<b>Suma</b><div class="chips" id="am">${amounts}</div>
<label>Pentru cine este (numele)<input id="rn" maxlength="80" placeholder="ex. Andrei" required></label>
<label>Telefonul lui (opțional, ca să primească codul prin SMS)<input id="rp" type="tel" placeholder="07xx xxx xxx" autocomplete="off"></label>
<label>Urarea ta (apare pe voucher)<textarea id="msg" maxlength="200">${esc(o.wish)}</textarea></label>
<hr style="border:0;border-top:1px solid #2a2a2a;margin:18px 0 6px">
<label>Numele tău<input id="bn" maxlength="80" autocomplete="name" required></label>
<label>Telefonul tău<input id="bp" type="tel" placeholder="07xx xxx xxx" autocomplete="tel" required></label>
<label>E-mailul tău (opțional, primești voucherul și pe e-mail)<input id="be" type="email" placeholder="nume@exemplu.ro" autocomplete="email"></label>
<p class="chk" style="margin-top:14px"><input type="checkbox" id="t"><span>Am citit <a href="/legal/terms" target="_blank">Termenii</a> și <a href="/legal/privacy" target="_blank">Politica de confidențialitate</a>. Folosim datele doar pentru acest card cadou.</span></p>
${captcha ? '<div id="cf" style="margin:10px 0;min-height:65px"></div>' : ''}
<button class="pay" id="go">${esc(o.cta)}</button>
<p class="m" style="text-align:center;margin:10px 0 0">Valabil ${o.validMonths} luni, pentru orice serviciu la ${esc(o.biz.name)}${o.biz.address ? `, ${esc(o.biz.address)}` : ''}.</p>
<p id="err" class="e"></p></form></main>
${captcha ? `<script>let cfTok=null;window.cfGo=()=>turnstile.render('#cf',{sitekey:${JSON.stringify(captcha)},language:'ro',theme:'dark',callback:(x)=>{cfTok=x},'expired-callback':()=>{cfTok=null},'error-callback':()=>{cfTok=null}});</script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=cfGo&render=explicit" async defer></script>` : '<script>const cfTok=null;</script>'}
<script>
const $=(i)=>document.getElementById(i);
// Intrat în cont pe site (pagina „Contul meu”): cardul intră în contul lui, iar numele și telefonul se completează singure.
let tok=null;try{tok=localStorage.getItem('taf-token')}catch(_){}
if(tok)fetch('/v1/me',{headers:{authorization:'Bearer '+tok}}).then(r=>r.ok?r.json():null).then(m=>{if(!m)return;if(!$('bn').value)$('bn').value=m.name||'';if(!$('bp').value)$('bp').value=m.phone||'';if(!$('be').value)$('be').value=m.email||''}).catch(()=>{});
let amount=${o.preset ?? 'null'};
const E={invalid_amount:'Alege o sumă.',recipient_required:'Scrie pentru cine este cardul.',name_required:'Scrie numele tău.',invalid_phone:'Numărul de telefon nu pare corect.',invalid_email:'E-mailul nu pare corect.',terms_required:'Bifează că ai citit Termenii.',captcha_required:'Confirmă că nu ești robot.',captcha_failed:'Confirmă din nou că nu ești robot.',too_many_requests:'Prea multe încercări. Mai încearcă peste câteva minute.',gift_cards_off:'Momentan cardurile cadou nu se vând online.',payments_off:'Momentan plata cu cardul nu e disponibilă.'};
const label=()=>{$('go').textContent=amount?${JSON.stringify(o.cta)}+' · '+amount+' lei':'Alege suma'};label();
$('am').onclick=(e)=>{const b=e.target.closest('button');if(!b)return;amount=Number(b.dataset.a);[...$('am').children].forEach(x=>x.className=x===b?'on':'');label()};
$('f').onsubmit=async(e)=>{e.preventDefault();$('err').textContent='';$('go').disabled=true;
try{const r=await fetch('/v1/gift-web',{method:'POST',headers:Object.assign({'content-type':'application/json'},tok?{authorization:'Bearer '+tok}:{}),body:JSON.stringify({amount,recipientName:$('rn').value,recipientPhone:$('rp').value,message:$('msg').value,buyerName:$('bn').value,buyerPhone:$('bp').value,buyerEmail:$('be').value,terms:$('t').checked,captcha:cfTok||undefined})});
const j=await r.json().catch(()=>null);if(!r.ok)throw new Error((j&&j.error)||'server_error');location.href=j.url}
catch(x){$('err').textContent=E[x.message]||'A apărut o problemă. Încearcă din nou sau sună-ne la salon.';$('go').disabled=false;if(window.turnstile&&$('cf')){try{turnstile.reset('#cf')}catch(_){}cfTok=null}}};
</script></body></html>`);
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
  const id = await createGiftCard(c.env, buyerId, { amount, recipientName, recipientPhone, message: str(b.message, 200) });
  await c.env.DB.prepare('UPDATE gift_cards SET web_buyer_name = ?, web_buyer_phone = ?, web_buyer_email = ? WHERE id = ?').bind(buyerName, buyerPhone, buyerEmail, id).run();
  const base = publicBase(c.env, c.req.url);
  const url = await createCheckout(c.env, {
    kind: 'gift',
    ref: id,
    amountBani: amount * 100,
    title: `Card cadou ${o.biz.name} · ${amount} lei`,
    email: buyerEmail,
    base,
    clientId: buyerId ?? '',
    lang: 'ro',
    successUrl: await voucherUrl(c.env, base, id),
    cancelUrl: `${base}/cadou?anulat=1`,
  });
  return c.json({ url });
});

type VoucherRow = { id: string; code: string; amount_bani: number; status: string; recipient_name: string; message: string; expires_at: string | null; web_buyer_name: string | null };

/** Voucherul de după plată: codul, suma, pentru cine, de la cine și urarea, gata de printat (sau salvat ca PDF) ori trimis. */
giftWebPublic.get('/cadou/gata', async (c) => {
  const id = (c.req.query('id') ?? '').slice(0, 40);
  const k = c.req.query('k') ?? '';
  const biz = await getBusiness(c.env);
  const base = publicBase(c.env, c.req.url);
  const g = id && k === (await voucherKey(c.env, id)) ? await c.env.DB.prepare('SELECT id, code, amount_bani, status, recipient_name, message, expires_at, web_buyer_name FROM gift_cards WHERE id = ?').bind(id).first<VoucherRow>() : null;
  const top = `${head(`Card cadou · ${biz.name}`, 'Voucherul tău cadou', `${base}/campanii/craciun.jpg`, `${base}/cadou`)}<meta name="robots" content="noindex">`;
  if (!g) return c.html(`${top}</head><body><main style="padding-top:48px;text-align:center"><h1>Linkul nu e corect</h1><p class="m">Deschide linkul din e-mail sau sună-ne la salon${biz.phone ? `: <a href="tel:${esc(biz.phone)}">${esc(biz.phone)}</a>` : ''}.</p></main></body></html>`, 404);
  if (g.status === 'pending') {
    // Plata se confirmă prin Stripe în câteva secunde: pagina se reîncarcă singură.
    return c.html(`${top}<meta http-equiv="refresh" content="3"></head><body><main style="padding-top:64px;text-align:center"><h1>Se confirmă plata…</h1><p class="m">Durează câteva secunde. Voucherul apare aici imediat.</p></main></body></html>`);
  }
  const until = g.expires_at ? new Date(g.expires_at).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: c.env.TIMEZONE || 'Europe/Bucharest' }) : '';
  const share = `Ți-am făcut cadou un card de ${g.amount_bani / 100} lei la ${biz.name}! Codul tău: ${g.code}${until ? `, valabil până pe ${until}` : ''}. Programare: ${base}`;
  return c.html(`${top}<style>
.v{position:relative;margin:22px 0;border-radius:22px;overflow:hidden;border:2px solid ${GOLD};background:radial-gradient(ellipse at 50% 0%,#2a1d0b 0%,#0a0a0a 60%,#000 100%);text-align:center;padding:26px 20px}
.v .shop{font-family:Georgia,serif;font-style:italic;color:${GOLD};font-size:24px}.v .amt{font-size:54px;font-weight:800;color:#fff;line-height:1.1;margin:10px 0 2px}.v .code{display:inline-block;margin:14px 0;padding:10px 18px;border:1.5px dashed ${GOLD};border-radius:12px;color:${GOLD};font-size:26px;font-weight:800;letter-spacing:2px}
.v .wish{font-style:italic;color:#e8e2d4;margin:6px 0}.row{display:flex;gap:10px}.row a,.row button{flex:1;text-align:center;text-decoration:none;border-radius:14px;padding:14px;font-weight:800;font-size:15px;border:0;cursor:pointer}
.p{background:${GOLD};color:#000}.s{background:#1c1c1c;color:#eee;border:1px solid #333 !important}
@media print{body{background:#fff}.np{display:none}main{padding:0}.v{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><main>
<h1 class="np" style="margin-top:28px">Mulțumim! Voucherul e gata 🎁</h1><p class="m np">Printează-l sau trimite-l${g.recipient_name ? ` lui ${esc(g.recipient_name)}` : ''}. Salvează pagina: linkul e și în e-mail, dacă ți l-ai pus.</p>
<div class="v"><div class="shop">${esc(biz.name)}</div><div class="m" style="letter-spacing:2px;font-weight:700;color:${GOLD};margin-top:6px">CARD CADOU</div>
<div class="amt">${g.amount_bani / 100} lei</div>${g.recipient_name ? `<div>Pentru <b>${esc(g.recipient_name)}</b>${g.web_buyer_name ? `, de la <b>${esc(g.web_buyer_name.split(' ')[0] ?? '')}</b>` : ''}</div>` : ''}
${g.message ? `<div class="wish">„${esc(g.message)}”</div>` : ''}<div class="code">${esc(g.code)}</div>
<div class="m">Se folosește la orice serviciu: spui codul la salon sau îl scrii în aplicație.${until ? `<br>Valabil până pe ${esc(until)}.` : ''}</div>
${biz.address || biz.phone ? `<div class="m" style="margin-top:8px">${esc(biz.address)}${biz.address && biz.phone ? ' · ' : ''}${esc(biz.phone)}</div>` : ''}</div>
<div class="row np"><button class="p" onclick="print()">Printează / PDF</button><a class="s" href="https://wa.me/?text=${encodeURIComponent(share)}" target="_blank" rel="noopener">Trimite pe WhatsApp</a></div>
<p class="m np" style="text-align:center;margin-top:16px"><a href="${base}">Programează-te la ${esc(biz.name)}</a></p></main></body></html>`);
});
