// „Extra fără timp” (ex. Spălat, Ceară pe față): preț fără durată, adăugate pe o programare din panou, din aplicația echipei și de client.
// Rulează după test-api.mjs (folosește contul de proprietar creat acolo), pe `wrangler dev` local.
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, extra = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...extra, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const mins = (b) => Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60_000);

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;
const ip = { 'CF-Connecting-IP': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
const register = async (name) => {
  const phone = '0737' + rnd();
  const email = `addon${rnd()}@test.ro`;
  let x = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
  x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name, email, acceptTerms: true }, null, ip);
  return x.body.token;
};

// Panoul: extra nou fără durată.
r = await req('POST', '/admin/services', { name: `Spălat ${rnd()}`, price: 10, addon: true }, at);
ok(r.status === 201 && r.body.addon === true && r.body.durationMin === 0, `addon created (${r.status} ${JSON.stringify(r.body).slice(0, 100)})`);
const WASH = r.body;
r = await req('POST', '/admin/services', { name: `Ceară față ${rnd()}`, price: 15, addon: true, durationMin: 30 }, at);
ok(r.status === 201 && r.body.durationMin === 0, 'addon ignores a duration');
const WAX = r.body;
r = await req('PATCH', `/admin/services/${WAX.id}`, { durationMin: 20, price: 16 }, at);
ok(r.status === 200 && r.body.durationMin === 0 && r.body.price === 16 && r.body.addon, 'addon edit keeps 0 minutes');
r = await req('POST', '/admin/services', { name: 'Fără durată', price: 10 }, at);
ok(r.status === 400, 'normal service still needs a duration');

// Listele: separat de servicii.
r = await req('GET', '/services');
ok(!r.body.some((s) => s.id === WASH.id), 'public services list has no addons');
r = await req('GET', '/services?addons=1&lang=en');
ok(r.body.some((s) => s.id === WASH.id) && r.body.every((s) => s.addon), 'public addons list');
r = await req('GET', '/admin/services', null, at);
ok(!r.body.some((s) => s.id === WASH.id), 'panel services list has no addons');
r = await req('GET', '/admin/services?addons=1', null, at);
ok(r.body.some((s) => s.id === WASH.id) && r.body.every((s) => s.addon), 'panel addons list');

r = await req('GET', '/barbers');
const barbers = r.body;
// Frizerul cu cele mai multe ore libere (testele de dinainte îi umplu programul primului).
let barberId = barbers[0].id, best = -1;
for (const b of barbers) {
  let n = 0;
  for (let i = 2; i < 12; i++) n += ((await req('GET', `/availability?serviceId=svc-classic&barberId=${b.id}&day=${new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10)}`)).body ?? []).length;
  if (n > best) (best = n), (barberId = b.id);
}
const MAIN = 'svc-classic', EXTRA = 'svc-beard-color';
const svc = Object.fromEntries((await req('GET', '/services')).body.map((s) => [s.id, s]));

// Preț propriu pe frizer pentru extra, fără să strice serviciile lui.
r = await req('GET', '/admin/barbers', null, at);
const b0 = r.body.find((b) => b.id === barberId);
r = await req('PATCH', `/admin/barbers/${barberId}`, { serviceIds: b0.serviceIds.filter((x) => x !== WASH.id && x !== WAX.id), prices: { [WASH.id]: 12 } }, at);
ok(r.status === 200, `barber own addon price saved (${r.status})`);
r = await req('GET', '/barbers');
const bb = r.body.find((b) => b.id === barberId);
ok(bb.prices?.[WASH.id] === 12, 'barber addon price visible to apps');
ok(bb.serviceIds.includes(MAIN), 'barber keeps his services');
// Lista de servicii trimisă fără extra-uri (ex. aplicația echipei) nu șterge prețul propriu.
r = await req('PATCH', `/admin/barbers/${barberId}`, { serviceIds: bb.serviceIds.filter((x) => x !== WASH.id) }, at);
r = await req('GET', '/barbers');
ok(r.body.find((b) => b.id === barberId).prices?.[WASH.id] === 12, 'addon own price kept when list omits it');

// Un extra nu se programează singur.
let day = null, slots = [];
for (let i = 2; i < 12 && !slots.length; i++) {
  const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
  r = await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${d}`);
  if (r.status === 200 && r.body.length > 4) { day = d; slots = r.body; }
}
ok(!!day, `found a day (${day})`);
r = await req('GET', `/availability?serviceId=${WASH.id}&barberId=${barberId}&day=${day}`);
ok(r.status === 200 && r.body.length === 0, 'addon alone has no free times');
r = await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${day}&extra=${WASH.id},${WAX.id}`);
ok(r.body.length === slots.length, 'addons do not change free times');

const tok = await register('Client Spălat');
ok(!!tok, 'client registered');
const pick = slots[Math.floor(slots.length / 2)];
r = await req('POST', '/bookings', { serviceId: WASH.id, barberId, start: pick.start }, tok);
ok(r.status === 400 && r.body.error === 'addon_not_bookable', 'cannot book addon alone');

// Clientul: Tuns + Vopsit (cu timp) + Spălat + Ceară (fără timp).
r = await req('POST', '/bookings', { serviceId: MAIN, extraServiceIds: [EXTRA, WASH.id, WAX.id], barberId, start: pick.start }, tok);
ok(r.status === 201, `client books with addons ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
const bk = r.body;
ok(bk.extras?.length === 3 && bk.extras.filter((e) => e.addon).length === 2, 'extras saved with addon flag');
ok(bk.price === svc[MAIN].price + svc[EXTRA].price + 12 + 16, `price adds barber addon price (${bk.price})`);
ok(mins(bk) === svc[MAIN].durationMin + svc[EXTRA].durationMin, `time adds only the timed extra (${mins(bk)} min)`);

// Clientul scoate Spălat: prețul scade, ora rămâne.
const wash = bk.extras.find((e) => e.serviceId === WASH.id);
r = await req('DELETE', `/bookings/${bk.id}/extras/${wash.id}`, null, tok);
ok(r.status === 200 && r.body.price === bk.price - 12 && r.body.end === bk.end, 'client removes addon: price back, end same');

// Panoul: altă programare imediat după; extra fără timp se poate pune oricum (nu cere timp).
r = await req('POST', '/admin/bookings', { clientId: (await req('GET', '/me', null, tok)).body.id, serviceId: 'svc-kids', barberId, start: bk.end, force: true, notify: false }, at);
const next = r.body;
ok(r.status === 201, `next booking right after (${r.status})`);
r = await req('POST', `/admin/bookings/${bk.id}/extras`, { serviceId: WASH.id }, at);
ok(r.status === 200 && r.body.end === bk.end && r.body.price === bk.price && r.body.extras.some((e) => e.serviceId === WASH.id && e.addon), 'panel adds addon even with a booking right after');
r = await req('POST', `/admin/bookings/${bk.id}/extras`, { serviceId: WASH.id }, at);
ok(r.status === 409 && r.body.error === 'service_already_added', 'same addon twice refused');
await req('PATCH', `/admin/bookings/${next.id}`, { status: 'cancelled' }, at);

// Mutarea la alt frizer păstrează extra-urile; prețul extra rămâne pe programare.
r = await req('GET', `/admin/bookings/${bk.id}`, null, at);
const before = r.body;

// Panoul: programare nouă cu extra (din calendar).
const slot2 = slots[slots.length - 1];
r = await req('POST', '/admin/bookings', { clientId: (await req('GET', '/me', null, tok)).body.id, serviceId: MAIN, extraServiceIds: [WAX.id], barberId, start: slot2.start, notify: false }, at);
ok(r.status === 201 && r.body.extras?.[0]?.addon && r.body.price === svc[MAIN].price + 16 && mins(r.body) === svc[MAIN].durationMin, `panel new booking with addon (${r.status})`);
const bk2 = r.body;

// Limite: 3 cu timp + până la 5 fără timp.
const many = [];
for (let i = 0; i < 6; i++) many.push((await req('POST', '/admin/services', { name: `Extra ${i} ${rnd()}`, price: 1, addon: true }, at)).body.id);
r = await req('POST', '/bookings', { serviceId: MAIN, extraServiceIds: many, barberId, start: slots[1].start }, tok);
ok(r.status === 400 && r.body.error === 'too_many_extras', 'more than 5 addons refused');
r = await req('POST', '/bookings', { serviceId: MAIN, extraServiceIds: [EXTRA, 'svc-beard', 'svc-kids', 'svc-skin-fade'], barberId, start: slots[1].start }, tok);
ok(r.status === 400 && r.body.error === 'too_many_extras', 'more than 3 timed extras still refused');
for (const id of many) await req('DELETE', `/admin/services/${id}`, null, at);

// Finalizare și rapoarte.
r = await req('POST', `/admin/bookings/${bk2.id}/complete`, { payment: 'paid', amount: bk2.price, payMethod: 'cash' }, at);
if (r.status !== 200) r = await req('PATCH', `/admin/bookings/${bk2.id}`, { status: 'completed', payment: 'paid', paidAmount: bk2.price, payMethod: 'cash' }, at);
ok(r.status === 200, `booking completed (${r.status} ${JSON.stringify(r.body).slice(0, 100)})`);
const d2 = new Date(Date.parse(slot2.start) + 3 * 3_600_000).toISOString().slice(0, 10);
r = await req('GET', `/admin/reports/sales-addons?from=${d2}&to=${d2}`, null, at);
ok(r.status === 200 && r.body.rows?.some((x) => x.service === WAX.name && x.count >= 1 && x.value >= 16), `addons report (${r.status} ${JSON.stringify(r.body?.rows ?? r.body).slice(0, 160)})`);
r = await req('GET', `/admin/reports/day?from=${d2}&to=${d2}`, null, at);
ok(r.status === 200 && r.body.rows?.some((x) => String(x[r.body.columns[0].key]).startsWith('Extra fără timp')), 'day report shows addons line');

// Asistentul/site-ul/next-free nu oferă extra-ul ca serviciu.
r = await req('GET', `/next-free?serviceId=${WASH.id}`);
ok(r.status === 200 && (r.body === null || r.body.serviceId !== WASH.id), 'next-free never picks an addon');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
