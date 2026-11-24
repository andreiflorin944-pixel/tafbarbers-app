// Cardul cadou cumpărat de pe site, fără cont: pagina /cadou, comanda, plata Stripe (de probă), voucherul cu cheie.
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
// Campania de Crăciun cu voucherul de 120 lei.
await req('PUT', '/admin/season-campaign', { enabled: true, theme: 'christmas', target: 'gift_card', amount: 120, startsAt: day(-1), endsAt: day(10) }, at);

let page = await (await fetch(H + '/cadou')).text();
ok(page.includes('De Crăciun, oferă-i un moment TAF unui prieten.') && page.includes('data-a="120" class="on"') && page.includes('og:image'), 'page shows the Christmas package, 120 lei preselected, share preview');

const good = { amount: 120, recipientName: 'Andrei', recipientPhone: '0745 111 222', message: 'Crăciun fericit!', buyerName: 'Maria Pop', buyerPhone: '0744123456', buyerEmail: 'maria@test.ro', terms: true };
r = await req('POST', '/gift-web', { ...good, amount: 77 }, null, ip); ok(r.status === 400 && r.body.error === 'invalid_amount', 'amount not offered refused');
r = await req('POST', '/gift-web', { ...good, terms: false }, null, ip); ok(r.status === 400 && r.body.error === 'terms_required', 'terms required');
r = await req('POST', '/gift-web', { ...good, buyerPhone: '12' }, null, ip); ok(r.status === 400 && r.body.error === 'invalid_phone', 'bad phone refused');
r = await req('POST', '/gift-web', { ...good, recipientName: ' ' }, null, ip); ok(r.status === 400 && r.body.error === 'recipient_required', 'recipient required');

r = await req('POST', '/gift-web', good, null, ip);
ok(r.status === 200 && r.body.url?.startsWith('https://checkout.stripe.test/'), 'checkout opened');
const s = calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
const m = meta(s.form);
ok(s.form['line_items[0][price_data][unit_amount]'] === '12000' && s.form.customer_email === 'maria@test.ro' && m.kind === 'gift', 'Stripe: 120 lei, buyer email for receipt');
ok(s.form.success_url.includes('/cadou/gata?id=') && s.form.success_url.includes('&k=') && s.form.cancel_url.endsWith('/cadou?anulat=1'), 'returns to the voucher page, not the app');
const voucher = s.form.success_url.replace(/^https?:\/\/[^/]+/, H);

page = await (await fetch(voucher)).text(); ok(page.includes('Se confirmă plata'), 'before payment: waiting page');
page = await (await fetch(voucher.replace(/k=[^&]+/, 'k=gresit'))).text(); ok(page.includes('Linkul nu e corect'), 'wrong key: no code shown');

const w = await webhook({ type: 'checkout.session.completed', data: { object: { id: `cs_${RUN}_web`, mode: 'payment', payment_status: 'paid', currency: 'ron', amount_total: 12000, payment_intent: `pi_${RUN}_web`, metadata: m } } });
ok(w.status === 200, 'webhook accepted');
page = await (await fetch(voucher)).text();
const code = (page.match(/TAF-[A-Z0-9]{4}-[A-Z0-9]{4}/) || [])[0];
ok(!!code && page.includes('120 lei') && page.includes('Andrei') && page.includes('Maria') && page.includes('Crăciun fericit!') && page.includes('print()'), `voucher with code ${code}, for Andrei from Maria, printable`);

r = await req('GET', '/admin/gift-cards', null, at);
const list = Array.isArray(r.body) ? r.body : r.body?.cards ?? r.body?.items ?? [];
const row = list.find((g) => g.code === code);
ok(row && row.status === 'active' && /Maria Pop/.test(row.buyerName ?? ''), `panel shows it as paid, bought by Maria (${row?.buyerName})`);

// Oprit din panou: pagina spune că nu se vinde online.
await req('PUT', '/admin/automations', { giftCard: { enabled: false } }, at);
page = await (await fetch(H + '/cadou')).text(); ok(page.includes('nu se vând online'), 'gift cards off: page says so');
r = await req('POST', '/gift-web', good, null, ip); ok(r.status === 409, 'gift cards off: order refused');
await req('PUT', '/admin/automations', { giftCard: { enabled: true } }, at);
await req('PUT', '/admin/season-campaign', { enabled: false, amount: 120, startsAt: '', endsAt: '' }, at);

mock.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
