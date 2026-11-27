// Pachetul de sezon cu preț de ofertă (ex. Experiența TAF, valoare 180 lei, la ofertă 149,99, cu cod 129,99): site, aplicație, voucher, registru.
// Rulează după test-api.mjs, pe `wrangler dev` local cu .dev.vars ca la test-stripe.mjs:
//   STRIPE_SECRET_KEY=sk_test_local  STRIPE_WEBHOOK_SECRET=whsec_local_test  STRIPE_MOCK_BASE=http://127.0.0.1:8798
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const H = 'http://127.0.0.1:8787';
const B = H + '/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, extra = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...extra, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const calls = [];
let n = 0;
const RUN = Date.now().toString(36);
const mock = createServer((rq, rs) => {
  let data = '';
  rq.on('data', (d) => (data += d));
  rq.on('end', () => {
    calls.push({ path: rq.url, form: Object.fromEntries(new URLSearchParams(data)) });
    n++;
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify(rq.url === '/v1/checkout/sessions' ? { id: `cs_${RUN}_${n}`, url: `https://checkout.stripe.test/${n}` } : { id: `x_${n}`, status: 'succeeded' }));
  });
});
await new Promise((res) => mock.listen(8798, '127.0.0.1', res));
const meta = (form) => Object.fromEntries(Object.entries(form).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
async function webhook(ev) {
  const body = JSON.stringify(ev);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_local_test').update(`${t}.${body}`).digest('hex');
  return fetch(`${B}/payments/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body });
}
const day = (k) => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);
const ip = { 'CF-Connecting-IP': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };


let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token;
r = await req('GET', '/admin/automations', null, at);
await req('PUT', '/admin/automations', { ...r.body, giftCard: { ...r.body.giftCard, enabled: true } }, at);
const camp = { enabled: true, theme: 'christmas', target: 'gift_card', amount: 180, packageName: 'Experiența TAF', packageItems: 'Tuns, Aranjarea bărbii, 2 spălări, Prosop cald, Masaj capilar', startsAt: day(-1), endsAt: day(10) };
r = await req('PUT', '/admin/season-campaign', { ...camp, packagePrice: 190 }, at); ok(r.status === 400 && r.body.error === 'package_price_too_high', 'offer price above value refused');
r = await req('PUT', '/admin/season-campaign', { ...camp, packagePrice: '149,99' }, at); ok(r.status === 200 && r.body.packagePrice === 149.99, 'package saved: 180 → 149,99');

let page = await (await fetch(H + '/cadou')).text();
ok(page.includes('Experiența TAF') && page.includes('149,99 lei') && page.includes('180 lei') && page.includes('Masaj capilar') && !page.includes('data-a="100"'), 'page: only the package, 180 struck, 149,99');

const pcode = `CRACIUN20${RUN.slice(-3).toUpperCase()}`;
await req('POST', '/admin/gift-promos', { kind: 'fixed', value: 20, code: pcode, batch: `Pachet ${RUN}` }, at);
r = await req('POST', '/gift-promo/quote', { code: pcode, amount: 180 }, null, ip); ok(r.body.price === 129.99 && r.body.discount === 20, `quote with code: ${r.body.price}`);
r = await req('POST', '/admin/gift-promos/quote', { code: pcode, amount: 180 }, at); ok(r.body.price === 129.99, 'salon quote: 129,99');

const good = { amount: 180, recipientName: 'Andrei', message: 'Crăciun fericit!', buyerName: 'Ioana Pop', buyerPhone: '0744123456', buyerEmail: 'ioana@test.ro', terms: true };
r = await req('POST', '/gift-web', { ...good, amount: 100 }, null, ip); ok(r.status === 400, 'other amounts refused in package mode');
r = await req('POST', '/gift-web', good, null, ip);
let s = calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
ok(r.status === 200 && s.form['line_items[0][price_data][unit_amount]'] === '14999', `no code: Stripe charges 149,99 (${s.form['line_items[0][price_data][unit_amount]']})`);
r = await req('POST', '/gift-web', { ...good, promoCode: pcode }, null, ip);
s = calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
const m = meta(s.form);
ok(r.status === 200 && s.form['line_items[0][price_data][unit_amount]'] === '12999' && /Experiența TAF/.test(s.form['line_items[0][price_data][product_data][name]'] ?? ''), 'with code: Stripe charges 129,99, title names the package');
const w = await webhook({ type: 'checkout.session.completed', data: { object: { id: `cs_${RUN}_pk`, mode: 'payment', payment_status: 'paid', currency: 'ron', amount_total: 12999, payment_intent: `pi_${RUN}_pk`, metadata: m } } });
const wb = await w.json().catch(() => null);
ok(wb?.result === 'gift_paid', `webhook accepts 129,99 (${wb?.result})`);
page = await (await fetch(s.form.success_url.replace(/^https?:\/\/[^/]+/, H))).text();
ok(page.includes('Experiența TAF') && page.includes('valoare 180 lei') && page.includes('masaj capilar') && !page.includes('129'), 'voucher: package, value 180, no paid price');

r = await req('GET', '/admin/gift-cards?status=paid', null, at);
const row = r.body.find((g) => g.id === m.ref);
ok(row && row.amount === 180 && row.balance === 180 && row.price === 129.99 && row.promoCode === pcode && row.packageName === 'Experiența TAF' && row.buyerPhone && row.buyerEmail === 'ioana@test.ro', 'register: value 180, paid 129,99, code, package, buyer contact');
ok(r.body.every((g) => g.status === 'active' || g.status === 'used'), 'register shows only sold vouchers');

// Aplicația: același pachet, același preț.
const phone = '0744' + Math.floor(100000 + Math.random() * 899999);
const cip = { 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
let x = await req('POST', '/auth/otp', { phone, email: `pk${RUN}@test.ro`, channel: 'email' }, null, cip);
x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name: 'Client Pachet', email: `pk${RUN}@test.ro`, acceptTerms: true }, null, cip);
const tok = x.body.token;
r = await req('GET', '/me/gift-cards?lang=ro', null, tok);
ok(r.body.season?.packagePrice === 149.99 && r.body.season.amount === 180 && r.body.season.packageName === 'Experiența TAF', 'app gets the package and prices');
r = await req('POST', '/me/gift-cards', { amount: 180, recipientName: 'Mihai' }, tok);
const aid = r.body.id;
r = await req('POST', `/me/gift-cards/${aid}/pay`, null, tok);
s = calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
ok(s.form['line_items[0][price_data][unit_amount]'] === '14999', 'app: pays 149,99');
r = await req('GET', '/me/gift-cards', null, tok);
const mine = r.body.bought.find((g) => g.id === aid);
ok(mine?.packageName === 'Experiența TAF' && mine.price === 149.99 && mine.buyerPhone === undefined, 'app: list shows the package, no buyer contact fields');

// Oprit: pagina revine la sumele obișnuite.
await req('PUT', '/admin/season-campaign', { enabled: false, packagePrice: null, amount: 120, startsAt: '', endsAt: '' }, at);
page = await (await fetch(H + '/cadou')).text(); ok(page.includes('data-a="100"') && !page.includes('149,99'), 'campaign off: normal amounts back');
mock.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
