// Registrul de încasări: două solduri, doar programările închise și cu tot cu cele trecute rămase neînchise.
// Rulează după test-api.mjs (folosește contul de proprietar creat acolo), pe `wrangler dev` local.
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;
// O zi din trecut fără alte programări: acum 40-60 de zile, ca să nu se amestece cu alte teste.
const day = new Date(Date.now() - (40 + Math.floor(Math.random() * 20)) * 86_400_000).toISOString().slice(0, 10);
const at10 = `${day}T08:00:00.000Z`, at11 = `${day}T09:00:00.000Z`, at12 = `${day}T10:00:00.000Z`;
const before = (await req('GET', `/admin/reports/register?from=${day}&to=${day}`, null, at)).body;

const mk = async (start, serviceId, extra = []) => {
  const x = await req('POST', '/admin/bookings', { phone: '0738' + rnd(), name: 'Sold Test', serviceId, extraServiceIds: extra, barberId: 'barber-andrei', start, force: true, notify: false }, at);
  ok(x.status === 201, `booking created (${x.status} ${JSON.stringify(x.body).slice(0, 80)})`);
  return x.body;
};
const closed = await mk(at10, 'svc-classic');
const closedCard = await mk(at11, 'svc-beard');
const open = await mk(at12, 'svc-classic', ['svc-beard']);
r = await req('POST', `/admin/bookings/${closed.id}/complete`, { payment: 'paid', payMethod: 'cash', amount: 50, tip: 5 }, at);
ok(r.status === 200, `closed with cash (${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
r = await req('POST', `/admin/bookings/${closedCard.id}/complete`, { payment: 'paid', payMethod: 'card', amount: 30 }, at);
ok(r.status === 200, `closed with card (${r.status})`);

r = await req('GET', `/admin/reports/register?from=${day}&to=${day}`, null, at);
ok(r.status === 200 && r.body.balance, 'register has balances');
const b = r.body.balance, b0 = before.balance;
const d = (k) => Math.round((b[k] - b0[k]) * 100) / 100;
ok(d('cash') === 50 && d('card') === 30, `cash/card split (${d('cash')}, ${d('card')})`);
ok(d('closed') === 80, `closed balance without tip (${d('closed')})`);
ok(b.openCount - b0.openCount === 1, 'one not closed');
ok(d('openAmount') === open.price, `not closed counted at booking price incl. extras & barber price (${d('openAmount')} vs ${open.price})`);
ok(b.all === Math.round((b.closed + b.openAmount) * 100) / 100, 'second balance = closed + not closed');
const row = r.body.rows.find((x) => x.state === 'NEÎNCHISĂ' && x.open === open.price);
ok(!!row, 'not closed row shows amount to collect');
r = await req('GET', `/admin/reports/register?from=${day}&to=${day}&lang=en`, null, at);
ok(r.body.columns.some((c) => c.label === 'Not closed · to collect (lei)'), 'column translated');

// Închisă și ea: soldurile devin egale.
r = await req('POST', `/admin/bookings/${open.id}/complete`, { payment: 'paid', payMethod: 'cash', amount: open.price }, at);
ok(r.status === 200, 'last one closed');
r = await req('GET', `/admin/reports/register?from=${day}&to=${day}`, null, at);
ok(r.body.balance.openCount === b0.openCount && r.body.balance.all === r.body.balance.closed + b0.openAmount, 'balances equal after closing');
r = await fetch(`${B}/admin/reports/register?from=${day}&to=${day}&format=xlsx`, { headers: { Authorization: `Bearer ${at}` } });
ok(r.status === 200, 'excel still downloads');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
