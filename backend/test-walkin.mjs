// „Client fără programare” (walk-in): programare din panou fără cont, fără mesaje; ora ocupată, încasare doar pe loc.
// Rulează după test-api.mjs (folosește contul de proprietar creat acolo), pe `wrangler dev` local.
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;
r = await req('GET', '/barbers');
const barberId = r.body[0].id;
const MAIN = 'svc-classic';

let day = null, slots = [];
for (let i = 2; i < 30 && slots.length < 4; i++) {
  const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
  r = await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${d}`);
  if (r.status === 200 && r.body.length >= 4) { day = d; slots = r.body; }
}
ok(!!day, `found a day with free time (${day})`);
const clientsBefore = (await req('GET', '/admin/clients?q=', null, at)).body?.length;

// Cu nume.
const s1 = slots[0];
r = await req('POST', '/admin/bookings', { walkIn: true, name: '  Mihai  ', serviceId: MAIN, barberId, start: s1.start, notify: true }, at);
ok(r.status === 201, `walk-in with name created ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
const w1 = r.body;
ok(w1.walkIn === true && w1.clientName === 'Mihai' && w1.clientPhone === '', 'shows name, no phone, walkIn flag');
// Fără nume.
const s2 = slots[slots.length - 1];
r = await req('POST', '/admin/bookings', { walkIn: true, serviceId: MAIN, barberId, start: s2.start }, at);
ok(r.status === 201 && r.body.clientName === 'Client fără programare', 'walk-in without name gets default label');
const w2 = r.body;

// Ora e ocupată pentru ceilalți.
r = await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${day}`);
ok(!r.body.some((x) => x.start === s1.start) && !r.body.some((x) => x.start === s2.start), 'walk-in times are no longer free');

// Calendarul îi arată.
r = await req('GET', `/admin/bookings?from=${day}T00:00:00Z&to=${day}T23:59:59Z`, null, at);
const inCal = r.body.find((b) => b.id === w1.id);
ok(inCal?.walkIn && inCal.clientName === 'Mihai', 'calendar lists walk-in with name');

// Nu apare în lista de clienți și nu se face niciun cont nou.
r = await req('GET', '/admin/clients?q=', null, at);
ok(!r.body.some((c) => c.id === 'cl_walkin'), 'walk-in client hidden from client list');
ok(r.body.length === clientsBefore, 'no new client account created');
r = await req('GET', `/admin/clients?q=${encodeURIComponent('fără programare')}`, null, at);
ok(!r.body.some((c) => c.id === 'cl_walkin'), 'walk-in client not found by search');

// Niciun mesaj trimis.
r = await req('GET', `/admin/bookings/${w1.id}/activity`, null, at);
ok(r.status === 200 && !(r.body.notifications ?? r.body.messages ?? []).length, `no messages logged ${JSON.stringify(r.body.notifications ?? r.body.messages ?? []).slice(0, 80)}`);

// Numele se poate schimba după.
r = await req('PATCH', `/admin/bookings/${w2.id}`, { walkinName: 'Andrei de pe stradă' }, at);
ok(r.status === 200 && r.body.clientName === 'Andrei de pe stradă', 'walk-in name can be edited');

// Încasare: rest de plată sau abonament refuzate; numerar merge.
r = await req('POST', `/admin/bookings/${w1.id}/complete`, { payment: 'paid', amount: 10, payMethod: 'cash', debt: 5 }, at);
ok(r.status === 400 && r.body.error === 'walkin_pay_now', 'debt refused for walk-in');
r = await req('POST', `/admin/bookings/${w1.id}/complete`, { payment: 'subscription' }, at);
ok(r.status === 400 && r.body.error === 'walkin_pay_now', 'subscription refused for walk-in');
r = await req('POST', `/admin/bookings/${w1.id}/complete`, { payment: 'paid', amount: 50, payMethod: 'cash', tip: 5 }, at);
ok(r.status === 200 && r.body.status === 'completed' && r.body.paidAmount === 50, `walk-in paid cash ${r.status}`);

// Un client normal tot primește numele lui (nu „Client fără programare”) și cererea cu walkIn nu atinge alți clienți.
r = await req('POST', '/admin/bookings', { phone: '0739' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'), name: 'Client Normal', serviceId: MAIN, barberId, start: slots[1].start, notify: false }, at);
ok(r.status === 201 && r.body.walkIn === false && r.body.clientName === 'Client Normal', 'normal booking unaffected');
const normal = r.body;

// Statistici: walk-in-ul nu e în topul clienților.
r = await req('GET', '/admin/dashboard', null, at);
if (r.status === 200) ok(!(r.body.topClients ?? []).some((c) => !c.clientId || c.clientId.startsWith('walkin:') || c.clientId === 'cl_walkin'), 'walk-in not in top clients');

await req('PATCH', `/admin/bookings/${w2.id}`, { status: 'cancelled' }, at);
await req('PATCH', `/admin/bookings/${normal.id}`, { status: 'cancelled' }, at);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
