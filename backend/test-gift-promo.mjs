// Codurile de reducere pentru cardul cadou: generate din panou, folosite pe site (/cadou), în aplicație și la salon.
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
await req('PUT', '/admin/season-campaign', { enabled: true, theme: 'christmas', target: 'gift_card', amount: 120, startsAt: day(-1), endsAt: day(10) }, at);

// --- Generare din panou ---
r = await req('POST', '/admin/gift-promos', { kind: 'percent', value: 95, count: 3, prefix: 'X' }, at); ok(r.status === 400 && r.body.error === 'invalid_value', 'over 90% refused');
r = await req('POST', '/admin/gift-promos', { kind: 'percent', value: 10, count: 3, prefix: 'Craciun', maxUses: 1, expiresDay: day(30), batch: `Test ${RUN}` }, at);
ok(r.status === 201 && r.body.created === 3 && r.body.codes.every((c) => /^CRACIUN-[A-Z0-9]{5}$/.test(c)), `3 unique codes ${r.body.codes?.join(', ')}`);
const [c1, c2, c3] = r.body.codes;
const single = `TAF20${RUN.slice(-4).toUpperCase()}`;
r = await req('POST', '/admin/gift-promos', { kind: 'fixed', value: 20, code: single, maxUses: null, batch: `Unul ${RUN}` }, at); ok(r.status === 201 && r.body.codes[0] === single, 'single shared code, unlimited');
r = await req('POST', '/admin/gift-promos', { kind: 'fixed', value: 20, code: single }, at); ok(r.status === 409 && r.body.error === 'code_taken', 'same code twice refused');
const old = `VECHI${RUN.slice(-4).toUpperCase()}`;
await req('POST', '/admin/gift-promos', { kind: 'percent', value: 50, code: old, expiresDay: day(-2) }, at);

// --- Calcul preț ---
r = await req('POST', '/gift-promo/quote', { code: c1.toLowerCase(), amount: 120 }, null, ip); ok(r.status === 200 && r.body.price === 108 && r.body.discount === 12, `10% of 120 = pay 108 (${r.body.price})`);
r = await req('POST', '/gift-promo/quote', { code: single, amount: 120 }, null, ip); ok(r.body.price === 100, '20 lei off: pay 100');
r = await req('POST', '/gift-promo/quote', { code: 'NUEXISTA', amount: 120 }, null, ip); ok(r.status === 404 && r.body.error === 'promo_invalid', 'unknown code');
r = await req('POST', '/gift-promo/quote', { code: old, amount: 120 }, null, ip); ok(r.status === 409 && r.body.error === 'promo_expired', 'expired code');

// --- Pe site, fără cont ---
let page = await (await fetch(H + '/cadou?cod=' + c1)).text(); ok(page.includes('id="pc"') && page.includes("get('cod')"), 'page has promo field and ?cod= link');
const good = { amount: 120, recipientName: 'Andrei', recipientPhone: '0745 111 222', message: 'Crăciun fericit!', buyerName: 'Maria Pop', buyerPhone: '0744123456', buyerEmail: 'maria@test.ro', terms: true };
r = await req('POST', '/gift-web', { ...good, promoCode: 'NUEXISTA' }, null, ip); ok(r.status === 404 && r.body.error === 'promo_invalid', 'bad code: order refused');
r = await req('POST', '/gift-web', { ...good, promoCode: c1 }, null, ip); ok(r.status === 200, 'order with code');
let s = calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
let m = meta(s.form);
ok(s.form['line_items[0][price_data][unit_amount]'] === '10800', `Stripe charges 108 lei (${s.form['line_items[0][price_data][unit_amount]']})`);
// Codul e rezervat cât timp plata e în curs: nu se poate folosi de două ori.
r = await req('POST', '/gift-promo/quote', { code: c1, amount: 120 }, null, ip); ok(r.status === 409 && r.body.error === 'promo_used_up', 'code with 1 use is held while payment is pending');
let w = await webhook({ type: 'checkout.session.completed', data: { object: { id: `cs_${RUN}_p1`, mode: 'payment', payment_status: 'paid', currency: 'ron', amount_total: 10800, payment_intent: `pi_${RUN}_p1`, metadata: m } } });
let wb = await w.json().catch(() => null);
ok(w.status === 200 && wb?.result === 'gift_paid', `webhook accepts 108 lei (${wb?.result})`);
const voucher = s.form.success_url.replace(/^https?:\/\/[^/]+/, H);
page = await (await fetch(voucher)).text(); ok(page.includes('120 lei') && /TAF-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(page), 'voucher shows full value 120 lei');
r = await req('GET', '/admin/gift-cards', null, at);
let row = r.body.find((g) => g.id === m.ref);
ok(row && row.amount === 120 && row.balance === 120 && row.price === 108 && row.promoCode === c1 && row.status === 'active', `panel: worth 120, paid 108 with ${row?.promoCode}`);
r = await req('GET', '/admin/gift-promos', null, at);
let pc = r.body.find((p) => p.code === c1);
ok(pc?.used === 1 && pc.state === 'used_up', `list: ${c1} used 1/1`);
ok(r.body.find((p) => p.code === c2)?.used === 0, 'other codes untouched');

// --- În aplicație ---
const phone = '0744' + Math.floor(100000 + Math.random() * 899999);
const cip = { 'CF-Connecting-IP': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
let x = await req('POST', '/auth/otp', { phone, email: `promo${RUN}@test.ro`, channel: 'email' }, null, cip);
x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name: 'Client Cod', email: `promo${RUN}@test.ro`, acceptTerms: true }, null, cip);
const tok = x.body.token;
r = await req('POST', '/me/gift-cards', { amount: 120, recipientName: 'Ion', promoCode: old }, tok); ok(r.status === 409 && r.body.error === 'promo_expired', 'app: expired code refused');
r = await req('POST', '/me/gift-cards', { amount: 120, recipientName: 'Ion', promoCode: single }, tok); ok(r.status === 201, 'app: order with shared code');
const appId = r.body.id;
r = await req('POST', `/me/gift-cards/${appId}/pay`, null, tok);
s = calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
ok(r.status === 200 && s.form['line_items[0][price_data][unit_amount]'] === '10000', 'app: Stripe charges 100 lei');
r = await req('GET', '/me/gift-cards', null, tok);
const mine = r.body.bought.find((g) => g.id === appId);
ok(mine?.amount === 120 && mine.price === 100 && mine.promoCode === single, 'app: list shows paid 100 with code');
m = meta(s.form);
w = await webhook({ type: 'checkout.session.completed', data: { object: { id: `cs_${RUN}_p2`, mode: 'payment', payment_status: 'paid', currency: 'ron', amount_total: 10000, payment_intent: `pi_${RUN}_p2`, metadata: m } } });
wb = await w.json().catch(() => null);
ok(wb?.result === 'gift_paid', 'app: webhook accepts 100 lei');

// --- La salon ---
r = await req('POST', '/admin/gift-promos/quote', { code: c2, amount: 200 }, at); ok(r.body.price === 180, 'salon: quote 200 → 180');
r = await req('POST', '/admin/gift-cards', { amount: 200, recipientName: 'Vasile', payMethod: 'cash', promoCode: c2 }, at);
ok(r.status === 201 && r.body.amount === 200 && r.body.price === 180 && r.body.promoCode === c2 && r.body.status === 'active', 'salon: card 200 sold for 180');
r = await req('POST', '/admin/gift-cards', { amount: 200, recipientName: 'Vasile', payMethod: 'cash', promoCode: c2 }, at); ok(r.status === 409 && r.body.error === 'promo_used_up', 'salon: code used, second sale refused');
r = await req('GET', '/admin/gift-promos', null, at);
ok(r.body.find((p) => p.code === single)?.used === 1 && r.body.find((p) => p.code === single)?.maxUses === null, 'shared code counted once, still unlimited');

// --- Oprire serie ---
r = await req('PATCH', '/admin/gift-promos', { batch: `Test ${RUN}`, active: false }, at); ok(r.body.changed === 3, 'series stopped');
r = await req('POST', '/gift-promo/quote', { code: c3, amount: 120 }, null, ip); ok(r.status === 404 && r.body.error === 'promo_invalid', 'stopped code no longer works');
r = await req('PATCH', '/admin/gift-promos', { batch: `Test ${RUN}`, active: true }, at);
r = await req('POST', '/gift-promo/quote', { code: c3, amount: 120 }, null, ip); ok(r.status === 200, 'restarted code works again');

await req('PUT', '/admin/season-campaign', { enabled: false, amount: 120, startsAt: '', endsAt: '' }, at);
mock.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
