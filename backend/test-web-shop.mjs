// Cumpărături de pe site, fără aplicație (/cont): abonament, abonament personalizat pe frizer, comandă din magazin, card cadou în cont.
// După plată clientul se întoarce pe site (/cont/gata), nu în aplicație; cumpărăturile apar în contul lui.
// (Adresa de întoarcere e cea pe care s-a deschis pagina, ex. https://tafbarbers.ro/cont/gata; local, wrangler dev o arată ca app.tafbarbers.ro.)
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
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const RUN = Date.now().toString(36);
const calls = [];
let n = 0;
const mock = createServer((rq, rs) => {
  let data = '';
  rq.on('data', (d) => (data += d));
  rq.on('end', () => {
    calls.push({ method: rq.method, path: rq.url, form: Object.fromEntries(new URLSearchParams(data)) });
    n++;
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify(rq.url === '/v1/checkout/sessions' ? { id: `cs_${RUN}_${n}`, url: `https://checkout.stripe.test/${n}` } : rq.url === '/v1/customers' ? { id: `cus_${RUN}_${n}` } : { id: `x_${n}`, status: 'succeeded' }));
  });
});
await new Promise((res) => mock.listen(8798, '127.0.0.1', res));
const meta = (form) => Object.fromEntries(Object.entries(form).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
const last = () => calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
async function webhook(ev) {
  const body = JSON.stringify(ev);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_local_test').update(`${t}.${body}`).digest('hex');
  return fetch(`${B}/payments/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body });
}
const ip = () => ({ 'CF-Connecting-IP': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token;
await req('PUT', '/admin/custom-sub', { enabled: true }, at);
const autos = (await req('GET', '/admin/automations', null, at)).body;
await req('PUT', '/admin/automations', { ...autos, giftCard: { ...autos.giftCard, enabled: true } }, at);
r = await req('POST', '/admin/plans', { name: `Web lunar ${rnd()}`, price: 150, periodDays: 30, cuts: 4, serviceIds: [] }, at); const plan = r.body;
r = await req('POST', '/admin/plans', { name: `Web 2 ani ${rnd()}`, price: 900, periodDays: 730, cuts: 20, serviceIds: [] }, at); const longPlan = r.body;
r = await req('POST', '/admin/products', { name: `Ceară web ${rnd()}`, price: 45, stock: 5 }, at); const prod = r.body;

// Pagina /cont: se deschide fără aplicație, cu abonamentele, personalizatul, produsele, cardul cadou.
let page = await (await fetch(H + '/cont')).text();
ok(page.includes('Cumpără online') && page.includes('"custom":true') && page.includes('"pay":true') && page.includes('noindex'), 'page /cont opens (custom sub on, card pay on, not indexed)');
page = await (await fetch(H + '/cont?lang=en')).text(); ok(page.includes('Buy online'), 'English page');
page = await (await fetch(H + '/cont/gata?tip=sub')).text(); ok(page.includes('Plata a reușit') && page.includes('/cont#mine'), 'return page after payment points to my account');
page = await (await fetch(H + '/')).text(); ok(page.includes("'/cont#subs'") && page.includes("'/cont#shop'") && page.includes("'/cadou'"), 'site perks link to web purchase, not the app');

// Contul: cod pe e-mail, cont nou (același ca în aplicație).
const phone = '0745' + rnd();
const email = `web${rnd()}@test.ro`;
const h = ip();
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, h);
r = await req('POST', '/auth/verify', { phone, code: r.body.devCode, name: 'Client Web', email, acceptTerms: true }, null, h);
const tok = r.body.token; ok(!!tok, 'account created on the site');
const me = (await req('GET', '/me', null, tok)).body;

// 1. Abonament (recurent): întoarcerea pe site.
r = await req('POST', `/me/subscriptions/${plan.id}/pay?web=1`, null, tok);
let s = last();
ok(r.status === 200 && r.body.recurring === true && s.form.mode === 'subscription', 'plan: recurring checkout opened');
ok(s.form.success_url .endsWith('/cont/gata?tip=sub') && s.form.cancel_url .endsWith('/cont?anulat=1'), `plan: returns to the site (${s.form.success_url})`);
// Din aplicație (fără web=1): ca înainte, la /plata/gata.
r = await req('POST', `/me/subscriptions/${longPlan.id}/pay`, null, tok); s = last();
ok(s.form.success_url.includes('/plata/gata?tip=sub'), 'from the app: unchanged return page');
// Abonament de 2 ani (plată o dată) de pe site, plătit: apare în cont.
r = await req('POST', `/me/subscriptions/${longPlan.id}/pay?web=1`, null, tok); s = last();
ok(r.body.recurring === false && s.form.success_url .endsWith('/cont/gata?tip=sub'), 'one-time plan from the site returns to the site');
await webhook({ type: 'checkout.session.completed', data: { object: { id: `cs_${RUN}_sub`, mode: 'payment', payment_status: 'paid', currency: 'ron', amount_total: 90000, payment_intent: `pi_${RUN}_sub`, metadata: meta(s.form) } } });
r = await req('GET', '/me/subscriptions', null, tok);
ok(r.body.subscriptions.some((x) => x.planId === longPlan.id && x.state === 'active'), 'paid membership shows on the account');

// 2. Abonament personalizat pe frizer, plată o dată, de pe site.
r = await req('POST', '/me/custom-sub/pay?web=1', { items: [{ serviceId: 'svc-classic', qty: 2 }], autoRenew: false, barberId: 'barber-andrei' }, tok); s = last();
ok(r.status === 200 && s.form.success_url .endsWith('/cont/gata?tip=sub') && /cu Andrei/.test(s.form['line_items[0][price_data][product_data][name]']), `custom sub per barber from the site (${r.body.error ?? 'ok'})`);
r = await req('POST', '/me/custom-sub/pay?web=1', { items: [{ serviceId: 'svc-classic', qty: 2 }], autoRenew: true, barberId: 'barber-andrei' }, tok); s = last();
ok(r.status === 200 && s.form.mode === 'subscription' && s.form.success_url .endsWith('/cont/gata?tip=sub'), 'custom sub with monthly auto payment returns to the site');

// 3. Magazin: comandă + plată cu cardul.
r = await req('POST', '/orders', { items: [{ productId: prod.id, qty: 2 }] }, tok); const order = r.body;
ok(r.status === 201 && order.total === 90, 'order created from the site');
r = await req('POST', `/orders/${order.id}/pay?web=1`, null, tok); s = last();
ok(r.status === 200 && s.form.success_url .endsWith('/cont/gata?tip=order') && s.form['line_items[0][price_data][unit_amount]'] === '9000', 'order: card checkout returns to the site');
await webhook({ type: 'checkout.session.completed', data: { object: { id: s.form.client_reference_id ? `cs_${RUN}_ord` : `cs_${RUN}_ord`, mode: 'payment', payment_status: 'paid', currency: 'ron', amount_total: 9000, payment_intent: `pi_${RUN}_ord`, metadata: meta(s.form) } } });
r = await req('GET', '/me/orders', null, tok);
ok(r.body.some((o) => o.id === order.id && o.paidAt), 'paid order shows on the account');

// 4. Card cadou de pe /cadou, intrat în cont: apare la „Cumpărate”.
const good = { amount: autos.giftCard.amounts?.[0] ?? 100, recipientName: 'Andrei', recipientPhone: '', message: 'La mulți ani', buyerName: 'Client Web', buyerPhone: phone, buyerEmail: email, terms: true };
r = await req('POST', '/gift-web', good, tok, ip()); s = last();
ok(r.status === 200 && meta(s.form).client === me.id, `gift from the site bought while signed in is linked to the account (${r.body?.error ?? ''})`);
await webhook({ type: 'checkout.session.completed', data: { object: { id: `cs_${RUN}_gift`, mode: 'payment', payment_status: 'paid', currency: 'ron', amount_total: good.amount * 100, payment_intent: `pi_${RUN}_gift`, metadata: meta(s.form) } } });
r = await req('GET', '/me/gift-cards', null, tok);
ok(r.body.bought.some((g) => g.status === 'active' && g.code), 'gift card shows on the account with its code');
// Fără cont: merge ca înainte (fără legătură cu vreun cont).
r = await req('POST', '/gift-web', { ...good, buyerPhone: '0744' + rnd() }, null, ip()); s = last();
ok(r.status === 200 && meta(s.form).client === '', 'gift without account still works');

mock.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
