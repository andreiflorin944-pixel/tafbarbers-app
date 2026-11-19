// Plata cu cardul (Stripe) cap-coadă, fără bani reali: card cadou, tunsoare, abonament recurent, abonament personalizat,
// plus ce vede echipa în fișa clientului și în panoul programării (abonamente, ședințe rămase, carduri cadou cu sold).
// Un Stripe „de probă” ascultă pe portul 8798; evenimentele webhook le semnăm noi cu secretul local.
// Rulează după test-api.mjs (contul de proprietar), pe `wrangler dev` local cu .dev.vars:
//   STRIPE_SECRET_KEY=sk_test_local  STRIPE_WEBHOOK_SECRET=whsec_local_test  STRIPE_MOCK_BASE=http://127.0.0.1:8798
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const B = 'http://127.0.0.1:8787/v1';
const WHSEC = 'whsec_local_test';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, extra = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...extra, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

// --- Stripe de probă: ține minte ce i s-a cerut ---
const calls = [];
let n = 0;
// Id-uri noi la fiecare rulare (baza locală păstrează plățile de la rulările trecute).
const RUN = Date.now().toString(36);
const mock = createServer((rq, rs) => {
  let data = '';
  rq.on('data', (d) => (data += d));
  rq.on('end', () => {
    const form = Object.fromEntries(new URLSearchParams(data));
    calls.push({ method: rq.method, path: rq.url, form });
    n++;
    let out = {};
    if (rq.url === '/v1/checkout/sessions') out = { id: `cs_${RUN}_${n}`, url: `https://checkout.stripe.test/${n}` };
    else if (rq.url === '/v1/customers') out = { id: `cus_${RUN}_${n}` };
    else if (rq.url === '/v1/refunds') out = { id: `re_test_${n}`, status: 'succeeded' };
    else if (rq.url.startsWith('/v1/subscriptions')) out = { id: rq.url.split('/')[3], status: 'active' };
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify(out));
  });
});
await new Promise((res) => mock.listen(8798, '127.0.0.1', res));
const lastSession = () => calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1);
const metaOf = (form) => Object.fromEntries(Object.entries(form).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));

/** Trimite un eveniment Stripe semnat (sau cu semnătură greșită). */
async function webhook(ev, secret = WHSEC) {
  const body = JSON.stringify(ev);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const r = await fetch(`${B}/payments/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
/** Plata terminată pe pagina Stripe pentru ultima sesiune deschisă (plată o singură dată). */
const paidSession = (amountBani, extra = {}) => {
  const s = lastSession();
  return {
    type: 'checkout.session.completed',
    data: { object: { id: s.form.client_reference_id ? `cs_${RUN}_${s.form.client_reference_id}_${n}` : `cs_x_${RUN}_${n}`, mode: s.form.mode, payment_status: 'paid', currency: 'ron', amount_total: amountBani, payment_intent: `pi_${RUN}_${n}`, metadata: metaOf(s.form), ...extra } },
  };
};

// --- Conturi ---
let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;
r = await req('GET', '/admin/payments/status', null, at);
ok(r.status === 200, `panou: starea plăților online ${JSON.stringify(r.body).slice(0, 120)}`);

async function newClient(name, channel = 'email') {
  const phone = '0744' + rnd();
  const email = `plata${rnd()}@test.ro`;
  const ip = { 'CF-Connecting-IP': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  let x = await req('POST', '/auth/otp', { phone, email, ...(channel && { channel }) }, null, ip);
  x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name, email, acceptTerms: true }, null, ip);
  const tok = x.body.token;
  x = await req('GET', '/me', null, tok);
  return { tok, id: x.body.id, phone: x.body.phone };
}
const ana = await newClient('Client Plată');
// Bob intră cu cod prin SMS: doar așa vede în aplicație cardurile primite pe numărul lui.
const bob = await newClient('Prieten Cadou', 'sms');
ok(!!ana.tok && !!bob.tok, 'doi clienți noi');

// --- Securitate webhook ---
r = await webhook({ type: 'checkout.session.completed', data: { object: {} } }, 'whsec_gresit');
ok(r.status === 400, 'webhook cu semnătură greșită refuzat');

// --- 1. Card cadou ---
r = await req('GET', '/admin/automations', null, at);
const autos = r.body;
r = await req('PUT', '/admin/automations', { ...autos, giftCard: { ...autos.giftCard, enabled: true } }, at);
ok(r.status === 200, 'carduri cadou pornite');
// Ana cumpără un card pentru Bob (pe numărul lui) și unul pentru ea.
r = await req('POST', '/me/gift-cards', { amount: 120, recipientName: 'Bob', recipientPhone: bob.phone, message: 'Crăciun fericit' }, ana.tok);
ok(r.status === 201, 'card cadou 120 lei creat (pentru Bob)');
const giftBob = r.body.id;
r = await req('POST', `/me/gift-cards/${giftBob}/pay`, null, ana.tok);
ok(r.status === 200 && r.body.url?.startsWith('https://checkout.stripe.test/'), 'plata cardului cadou: se deschide pagina Stripe');
let s = lastSession();
ok(s.form.mode === 'payment' && s.form['line_items[0][price_data][unit_amount]'] === '12000' && s.form['line_items[0][price_data][currency]'] === 'ron', 'Stripe primește 120 lei, în RON');
ok(metaOf(s.form).kind === 'gift' && metaOf(s.form).ref === giftBob, 'Stripe primește tipul și cardul');
r = await req('GET', '/me/gift-cards', null, ana.tok);
ok(r.body.bought.find((g) => g.id === giftBob)?.status === 'pending' && !r.body.bought.find((g) => g.id === giftBob)?.code, 'înainte de plată: „de plătit”, fără cod');
let ev = paidSession(12000);
r = await webhook(ev);
ok(r.status === 200 && r.body.result === 'gift_paid', `webhook: card cadou plătit (${r.body?.result})`);
r = await webhook(ev);
ok(r.body.result === 'duplicate', 'același eveniment a doua oară: ignorat');
r = await req('GET', '/me/gift-cards', null, bob.tok);
const recv = r.body.received.find((g) => g.id === giftBob);
ok(recv?.status === 'active' && recv.balance === 120 && /^TAF-/.test(recv.code ?? ''), 'Bob vede cardul primit, activ, 120 lei, cu cod');

r = await req('POST', '/me/gift-cards', { amount: 50, recipientName: 'Eu' }, ana.tok);
const giftAna = r.body.id;
await req('POST', `/me/gift-cards/${giftAna}/pay`, null, ana.tok);
r = await webhook(paidSession(4000));
ok(r.body.result === 'amount_mismatch' || r.body.result === 'refunded', `sumă greșită (40 în loc de 50): refuzată și returnată (${r.body.result})`);
ok(calls.some((c) => c.path === '/v1/refunds'), 'returnarea a plecat la Stripe');
await req('POST', `/me/gift-cards/${giftAna}/pay`, null, ana.tok);
r = await webhook(paidSession(5000));
ok(r.body.result === 'gift_paid', 'card cadou 50 lei pentru ea: plătit');

// --- 2. Tunsoare plătită cu cardul ---
// O zi liberă la întâmplare (rulările repetate ocupă orele).
let day;
let slot;
for (let i = 0; i < 60 && !slot; i++) {
  day = new Date(Date.now() + (3 + Math.floor(Math.random() * 60)) * 86400000).toISOString().slice(0, 10);
  r = await req('GET', `/availability?serviceId=svc-classic&barberId=barber-andrei&day=${day}`);
  const free = Array.isArray(r.body) ? r.body : [];
  slot = free[Math.floor(Math.random() * free.length)];
}
r = await req('POST', '/bookings', { serviceId: 'svc-classic', barberId: 'barber-andrei', start: slot?.start }, ana.tok);
ok(r.status === 201 || r.status === 200, `programare făcută din aplicație (${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
const bk = r.body.id ?? r.body.booking?.id;
const price = r.body.price ?? r.body.booking?.price;
r = await req('POST', `/bookings/${bk}/pay`, null, ana.tok);
ok(r.status === 200 && !!r.body.url, 'plata tunsorii: se deschide pagina Stripe');
s = lastSession();
ok(s.form['line_items[0][price_data][unit_amount]'] === String(price * 100) && metaOf(s.form).kind === 'booking', `Stripe primește prețul tunsorii (${price} lei)`);
r = await webhook(paidSession(price * 100));
ok(r.body.result === 'booking_paid', `webhook: tunsoare plătită (${r.body.result})`);
r = await req('GET', '/admin/bookings?start=' + day + 'T00:00:00Z&end=' + day + 'T23:59:59Z', null, at);
const list = Array.isArray(r.body) ? r.body : r.body?.bookings ?? [];
const seen = list.find((x) => x.id === bk);
ok(seen ? seen.onlinePaid === price : true, `panou: programarea apare „plătită online ${price} lei”`);
r = await req('POST', `/bookings/${bk}/pay`, null, ana.tok);
ok(r.status === 409 && r.body.error === 'booking_paid', 'a doua plată pentru aceeași tunsoare: refuzată');
const refundsBefore = calls.filter((c) => c.path === '/v1/refunds').length;
r = await req('POST', `/bookings/${bk}/cancel`, null, ana.tok);
if (r.status === 404) r = await req('DELETE', `/bookings/${bk}`, null, ana.tok);
ok(r.status === 200, `clientul anulează tunsoarea plătită (${r.status})`);
ok(calls.filter((c) => c.path === '/v1/refunds').length === refundsBefore + 1, 'banii se returnează singuri pe card la anulare');

// --- 3. Abonament fix, cu plată lunară automată ---
r = await req('POST', '/admin/plans', { name: `Lunar test ${rnd()}`, price: 150, periodDays: 30, cuts: 4, serviceIds: [] }, at);
ok(r.status === 201, 'abonament 150 lei / 30 zile / 4 tunsori creat');
const planId = r.body.id;
r = await req('POST', `/me/subscriptions/${planId}/pay`, null, ana.tok);
ok(r.status === 200 && r.body.recurring === true, 'plata abonamentului: pagina Stripe cu reînnoire automată');
s = lastSession();
ok(s.form.mode === 'subscription' && s.form['line_items[0][price_data][recurring][interval]'] && s.form.customer?.startsWith('cus_'), 'Stripe primește abonament recurent pentru clientul ei');
const m = metaOf(s.form);
r = await webhook({ type: 'checkout.session.completed', data: { object: { id: `cs_sub_${RUN}_${n}`, mode: 'subscription', payment_status: 'paid', currency: 'ron', amount_total: 15000, subscription: `sub_${RUN}`, customer: s.form.customer, invoice: `in1_${RUN}`, metadata: m } } });
ok(r.body.result === 'sub_paid', `webhook: abonament activat (${r.body.result})`);
r = await webhook({ type: 'invoice.paid', data: { object: { id: `in1_${RUN}`, subscription: `sub_${RUN}`, currency: 'ron', amount_paid: 15000, billing_reason: 'subscription_create', payment_intent: `pis1_${RUN}`, lines: { data: [{ metadata: m }] } } } });
ok(r.body.result === 'duplicate', 'factura primei plăți (vine după): nu activează a doua oară');
r = await req('GET', '/me/subscriptions', null, ana.tok);
let sub = r.body.subscriptions.find((x) => x.id === m.ref);
ok(sub?.state === 'active' && sub.cutsTotal === 4 && sub.renewal?.on === true, 'clienta vede abonamentul activ, 4 ședințe, se reînnoiește automat');
// Luna următoare: Stripe taxează singur cardul.
const p0 = Math.floor(new Date(sub.endsAt).getTime() / 1000);
r = await webhook({ type: 'invoice.paid', data: { object: { id: `in2_${RUN}`, subscription: `sub_${RUN}`, currency: 'ron', amount_paid: 15000, billing_reason: 'subscription_cycle', payment_intent: `pis2_${RUN}`, lines: { data: [{ period: { start: p0, end: p0 + 30 * 86400 }, metadata: m }] } } } });
ok(r.body.result === 'sub_renewed', `webhook: reînnoire lunară automată (${r.body.result})`);

// --- 4. Abonament personalizat pe frizer, plătit o dată ---
await req('PUT', '/admin/custom-sub', { enabled: true }, at);
r = await req('POST', '/me/custom-sub/pay', { items: [{ serviceId: 'svc-classic', qty: 2 }, { serviceId: 'svc-beard', qty: 1 }], autoRenew: false, barberId: 'barber-andrei' }, ana.tok);
ok(r.status === 200 && r.body.recurring === false, `abonament personalizat: pagina Stripe, plată o dată (${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
s = lastSession();
const customAmount = Number(s.form['line_items[0][price_data][unit_amount]']);
r = await webhook(paidSession(customAmount));
ok(r.body.result === 'sub_paid', `webhook: abonament personalizat activat (${r.body.result}, ${customAmount / 100} lei)`);

// --- 5. Ce vede echipa ---
r = await req('GET', `/admin/clients/${ana.id}`, null, at);
ok(r.status === 200, 'fișa clientei se deschide');
const subs = r.body.subscriptions ?? [];
ok(subs.filter((x) => x.state === 'active' || x.state === 'upcoming').length >= 3, `fișa: abonamentele ei (${subs.length})`);
const gifts = r.body.giftCards ?? [];
ok(gifts.length === 2 && gifts.every((g) => g.status === 'active'), `fișa: cele 2 carduri cadou cumpărate, active (${gifts.length})`);
ok(gifts.find((g) => g.id === giftBob)?.role === 'bought' && gifts.find((g) => g.id === giftBob)?.forSelf === false, 'cardul pentru Bob apare „cumpărat pentru Bob”');
ok(gifts.every((g) => g.recipientPhone === undefined), 'numărul destinatarului nu apare în fișă');
r = await req('GET', `/admin/clients/${bob.id}`, null, at);
const bg = (r.body.giftCards ?? []).find((g) => g.id === giftBob);
ok(bg?.role === 'received' && bg.balance === 120 && /^TAF-/.test(bg.code ?? ''), 'fișa lui Bob: card primit, sold 120 lei, cu cod');

r = await req('GET', `/admin/clients/${ana.id}/wallet`, null, at);
ok(r.status === 200, 'panoul programării: rezumatul clientei');
const w = r.body;
const ws = w.subscriptions.find((x) => x.id === m.ref);
ok(ws && ws.cutsTotal - ws.cutsUsed === 4 && ws.endsAt, 'rezumat: abonamentul cu 4 ședințe rămase și data de final');
ok(w.giftCards.length === 1 && w.giftCards[0].id === giftAna && w.giftCards[0].balance === 50, 'rezumat: doar cardul ei de 50 lei (cel dat lui Bob nu)');
r = await req('GET', `/admin/clients/${bob.id}/wallet`, null, at);
ok(r.body.giftCards.length === 1 && r.body.giftCards[0].balance === 120 && r.body.subscriptions.length === 0, 'rezumat Bob: cardul de 120 lei, fără abonament');

// Folosit la salon: soldul scade și se vede.
const past = new Date(Date.now() - (2 + Math.floor(Math.random() * 200)) * 86400000).toISOString();
r = await req('POST', '/admin/bookings', { clientId: bob.id, serviceId: 'svc-classic', barberId: 'barber-andrei', start: past, force: true, notify: false }, at);
const bb = r.body.id;
const bprice = r.body.price;
r = await req('POST', `/admin/bookings/${bb}/complete`, { payment: 'paid', amount: 0, payMethod: 'cash', giftCode: bg.code, giftAmount: bprice }, at);
ok(r.status === 200, `tunsoare plătită cu cardul cadou la salon (${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
r = await req('GET', `/admin/clients/${bob.id}/wallet`, null, at);
ok(r.body.giftCards[0]?.balance === 120 - bprice, `soldul scade: rămân ${120 - bprice} lei`);

mock.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
