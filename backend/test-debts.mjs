// Servicii gratuite și rest de plată: închidere „Gratuit”, închidere cu rest, încasarea restului la vizita următoare
// sau din fișă, iertare, anulare a închiderii, fișa clientului, rezumatul din calendar și rapoartele.
// Rulează după test-api.mjs (contul de proprietar), pe `wrangler dev` local.
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, extra = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...extra, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;

const phone = '0755' + rnd();
const email = `rest${rnd()}@test.ro`;
const ip = { 'CF-Connecting-IP': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone, code: r.body?.devCode, name: 'Client Rest', email, acceptTerms: true }, null, ip);
const tok = r.body.token;
r = await req('GET', '/me', null, tok);
const clientId = r.body.id;

// O zi trecută la întâmplare, ca rulările repetate să nu se suprapună.
const dayBase = Date.now() - (5 + Math.floor(Math.random() * 300)) * 86400000;
let n = 0;
const book = async (serviceId = 'svc-classic') => {
  n++;
  const start = new Date(dayBase + n * 3600000).toISOString();
  const b = await req('POST', '/admin/bookings', { clientId, serviceId, barberId: 'barber-andrei', start, force: true, notify: false }, at);
  if (b.status !== 201) console.log('book', b.status, JSON.stringify(b.body));
  return b.body;
};
const day = new Date(dayBase).toISOString().slice(0, 10);

// --- Gratuit ---
const b1 = await book();
r = await req('POST', `/admin/bookings/${b1.id}/complete`, { payment: 'paid', free: true, amount: 50 }, at);
ok(r.status === 200 && r.body.free === true && r.body.paidAmount === 0, 'închisă „Gratuit”: nu se încasează nimic');
r = await req('POST', `/admin/bookings/${(await book()).id}/complete`, { payment: 'paid', free: true, giftCode: 'TAF-XXXX-XXXX' }, at);
ok(r.status === 400, 'gratuit cu card cadou: refuzat');

// --- Rest de plată ---
const b2 = await book();
r = await req('POST', `/admin/bookings/${b2.id}/complete`, { payment: 'paid', amount: b2.price - 20, debt: 20, payMethod: 'cash' }, at);
ok(r.status === 200 && r.body.debtLeft === 20 && r.body.paidAmount === b2.price - 20, `închisă cu rest de plată 20 lei (a plătit ${b2.price - 20})`);
r = await req('POST', `/admin/bookings/${(await book()).id}/complete`, { payment: 'paid', amount: 0, debt: 9999 }, at);
ok(r.status === 400 && r.body.error === 'invalid_debt', 'rest mai mare decât prețul: refuzat');
r = await req('POST', `/admin/bookings/${(await book()).id}/complete`, { payment: 'subscription', debt: 10 }, at);
ok(r.status === 400, 'rest pe abonament: refuzat');

// Fișa și rezumatul din calendar.
r = await req('GET', `/admin/clients/${clientId}`, null, at);
const open = (r.body.debts ?? []).filter((d) => d.state === 'open');
ok(open.length === 1 && open[0].amount === 20 && open[0].serviceName && open[0].bookingAt, 'fișa: rest de plată 20 lei, cu serviciul și data');
ok((r.body.freeServices ?? []).length === 1 && r.body.freeServices[0].bookingId === b1.id && r.body.freeServices[0].givenByName, 'fișa: serviciul gratuit, cu cine l-a dat');
r = await req('GET', `/admin/clients/${clientId}/wallet`, null, at);
ok(r.body.debts.length === 1 && r.body.debts[0].amount === 20, 'rezumat calendar: are rest de plată 20 lei');
const debtId = r.body.debts[0].id;

// Vizita următoare: încasează programarea și restul vechi odată.
const b3 = await book();
r = await req('POST', `/admin/bookings/${b3.id}/complete`, { payment: 'paid', amount: b3.price, payMethod: 'card', settleDebtIds: [debtId] }, at);
ok(r.status === 200, 'vizita următoare: plătește și restul vechi');
r = await req('GET', `/admin/clients/${clientId}/wallet`, null, at);
ok(r.body.debts.length === 0, 'restul nu mai apare de încasat');
r = await req('GET', `/admin/clients/${clientId}`, null, at);
let d = r.body.debts.find((x) => x.id === debtId);
ok(d.state === 'settled' && d.settledMethod === 'card', 'fișa: rest încasat, pe card');
r = await req('POST', `/admin/bookings/${(await book()).id}/complete`, { payment: 'paid', settleDebtIds: [debtId] }, at);
ok(r.status === 409 && r.body.error === 'debt_not_open', 'același rest nu se încasează de două ori');

// Anularea închiderii unde s-a încasat restul: restul redevine de încasat.
r = await req('DELETE', `/admin/bookings/${b3.id}/complete`, null, at);
ok(r.status === 200, 'anulez închiderea vizitei următoare');
r = await req('GET', `/admin/clients/${clientId}/wallet`, null, at);
ok(r.body.debts.length === 1 && r.body.debts[0].id === debtId, 'restul redevine de încasat');
r = await req('DELETE', `/admin/bookings/${b2.id}/complete`, null, at);
ok(r.status === 200, 'anulez închiderea cu rest');
r = await req('GET', `/admin/clients/${clientId}/wallet`, null, at);
ok(r.body.debts.length === 0, 'restul dispare odată cu închiderea anulată');

// Din fișă: rest nou, încasat fără programare; altul iertat.
r = await req('POST', `/admin/bookings/${b2.id}/complete`, { payment: 'paid', amount: b2.price - 15, debt: 15, payMethod: 'cash' }, at);
const b4 = await book();
await req('POST', `/admin/bookings/${b4.id}/complete`, { payment: 'paid', amount: 0, debt: 10 }, at);
r = await req('GET', `/admin/clients/${clientId}/wallet`, null, at);
ok(r.body.debts.length === 2, 'două resturi de încasat');
const [x1, x2] = r.body.debts;
r = await req('POST', `/admin/clients/${clientId}/debts/settle`, { ids: [x1.id], payMethod: 'transfer' }, at);
ok(r.status === 200 && r.body.amount === x1.amount, 'încasat din fișă, prin transfer');
r = await req('POST', `/admin/debts/${x2.id}/cancel`, null, at);
ok(r.status === 200, 'proprietarul iartă celălalt rest');
r = await req('GET', `/admin/clients/${clientId}/wallet`, null, at);
ok(r.body.debts.length === 0, 'nimic de încasat');
const b2debt = x1.bookingId === b2.id ? x1 : x2;
r = await req('DELETE', `/admin/bookings/${b2.id}/complete`, null, at);
ok(b2debt.id === x1.id ? r.status === 409 && r.body.error === 'debt_settled' : r.status === 200, 'închiderea cu rest deja încasat nu se poate anula direct');

// --- Rapoarte ---
const today = new Date().toISOString().slice(0, 10);
r = await req('GET', `/admin/reports/debts?from=${today}&to=${today}`, null, at);
ok(r.status === 200 && r.body.rows.length >= 2 && r.body.rows.some((x) => /Încasat/.test(x.state)) && r.body.rows.some((x) => x.state === 'Iertat'), `raport „Rest de plată”: rânduri, încasat și iertat (${r.status})`);
r = await req('GET', `/admin/reports/free-services?from=${day}&to=${day}`, null, at);
ok(r.status === 200 && r.body.rows.length >= 1, 'raport „Servicii oferite gratuit”');
r = await req('GET', `/admin/reports/payments?from=${today}&to=${today}`, null, at);
ok(r.body.rows.some((x) => x.method === 'Rest de plată încasat' && x.amount === x1.amount && /Transfer/.test(x.how)), 'raport „Plăți”: restul încasat azi');
r = await req('GET', `/admin/reports/register?from=${today}&to=${today}`, null, at);
ok(r.body.rows.some((x) => x.state === 'Rest de plată încasat' && x.other === x1.amount), 'registrul de încasări: restul, la transfer');
r = await req('GET', `/admin/reports/register?from=${day}&to=${day}`, null, at);
ok(r.body.rows.some((x) => /gratuit/.test(x.state)) && r.body.rows.some((x) => /rest/.test(x.state)), 'registrul zilei vizitei: gratuit și plătită parțial');
r = await req('GET', `/admin/reports/day?from=${today}&to=${today}`, null, at);
ok(r.body.rows.some((x) => /Rest de plată încasat/.test(x.name) && Number(x.value) >= x1.amount), 'raportul zilei: rest de plată încasat');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
