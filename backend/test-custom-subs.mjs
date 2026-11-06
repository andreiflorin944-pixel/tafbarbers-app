// Abonamentul personalizat: setări, calculul prețului, activare la salon, scăderea vizitelor pe fiecare serviciu, anulare.
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

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;

// Oprit implicit.
r = await req('GET', '/custom-sub'); ok(r.status === 200 && r.body.enabled === false && r.body.maxVisits === 4 && r.body.discounts['4'] === 15, 'off by default, 2/3/4 → 5/10/15, max 4');
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-classic', qty: 2 }] }); ok(r.status === 409 && r.body.error === 'custom_sub_off', 'quote refused while off');

r = await req('PUT', '/admin/custom-sub', { enabled: true }, at); ok(r.status === 200 && r.body.enabled, 'owner turns it on');
r = await req('PUT', '/admin/custom-sub', { maxVisits: 1 }, at); ok(r.status === 400, 'max below min refused');

// Calculul: suma prețurilor minus reducerea, rotunjit în jos la leu.
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-skin-fade', qty: 2 }] });
ok(r.status === 200 && r.body.visits === 2 && r.body.discount === 5 && r.body.fullPrice === 140 && r.body.price === 133, `2 × Skin Fade = 133 lei (${JSON.stringify(r.body)})`);
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-haircut-beard-classic', qty: 2 }] });
ok(r.body.visits === 2 && r.body.discount === 5 && r.body.price === 171, '2 × tuns + barbă clasic = 2 vizite, 5%, 171 lei');
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-classic', qty: 3 }] });
ok(r.body.discount === 10 && r.body.price === 162, '3 × Tuns Clasic = 162 lei');
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-haircut-beard-skin-fade', qty: 2 }, { serviceId: 'svc-skin-fade', qty: 2 }] });
ok(r.body.visits === 4 && r.body.discount === 15 && r.body.fullPrice === 340 && r.body.price === 289, '2 × H&B Skin Fade + 2 × Skin Fade = 289 lei');
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-classic', qty: 2 }, { serviceId: 'svc-beard', qty: 1 }] });
ok(r.body.discount === 10 && r.body.price === 139, '2 × Clasic + 1 × Barbă = 155 → 139 lei (rotunjit în jos)');
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-classic', qty: 5 }] }); ok(r.status === 400 && r.body.error === 'too_many_visits', '5 visits refused');
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'svc-classic', qty: 1 }] }); ok(r.status === 400 && r.body.error === 'too_few_visits', '1 visit refused');
r = await req('POST', '/custom-sub/quote', { items: [{ serviceId: 'nope', qty: 2 }] }); ok(r.status === 400 && r.body.error === 'service_not_allowed', 'unknown service refused');

// Client nou.
const phone = '0733' + rnd();
const email = `abonat${rnd()}@test.ro`;
const ip = { 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone, code: r.body?.devCode, name: 'Abonat Personalizat', email, acceptTerms: true }, null, ip); ok(r.status === 200, `client registered ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
const tok = r.body.token;
r = await req('GET', '/me', null, tok); const clientId = r.body.id;
// Fără Stripe local: plata cu cardul e oprită.
r = await req('POST', '/me/custom-sub/pay', { items: [{ serviceId: 'svc-classic', qty: 2 }], autoRenew: true }, tok); ok(r.status === 409 && r.body.error === 'payments_off', 'card pay needs Stripe');

// Plătit la salon: 2 × Tuns Clasic + 1 × Barbă.
r = await req('POST', `/admin/clients/${clientId}/custom-sub`, { items: [{ serviceId: 'svc-classic', qty: 2 }, { serviceId: 'svc-beard', qty: 1 }], payMethod: 'card' }, at);
ok(r.status === 201 && r.body.price === 139, 'activated at salon, 139 lei');
const subId = r.body.id;
r = await req('GET', '/admin/plans', null, at); ok(!r.body.some((p) => p.name.startsWith('Abonament personalizat')), 'hidden plan not in plans list');
r = await req('GET', '/me/subscriptions', null, tok);
let s = r.body.subscriptions.find((x) => x.id === subId);
ok(s && s.state === 'active' && s.cutsTotal === 3 && s.items.length === 2 && s.items.every((i) => i.used === 0), 'client sees items, nothing used');
ok(!r.body.plans.some((p) => p.id === s.planId), 'hidden plan not offered to clients');
const days = (new Date(s.endsAt) - new Date(s.startsAt)) / 86400000; ok(days === 30, '30 de zile');

// Programări la salon și confirmare „pe abonament”.
// O zi trecută la întâmplare, ca rulările repetate să nu se suprapună în calendar.
const base = Date.now() - (2 + Math.floor(Math.random() * 300)) * 86400000;
let n = 0;
const book = async (serviceId) => {
  n++;
  const start = new Date(base - n * 3600000).toISOString();
  const b = await req('POST', '/admin/bookings', { clientId, serviceId, barberId: 'barber-andrei', start, force: true, notify: false }, at);
  if (b.status !== 201) console.log('book', b.status, JSON.stringify(b.body));
  return b.body.id;
};
const done = (id) => req('POST', `/admin/bookings/${id}/complete`, { payment: 'subscription' }, at);
let b1 = await book('svc-beard'); r = await done(b1); ok(r.status === 200, 'beard on subscription');
let b2 = await book('svc-beard'); r = await done(b2); ok(r.status === 409 && r.body.error === 'no_active_subscription', 'second beard refused (only 1 in package)');
let b3 = await book('svc-skin-fade'); r = await done(b3); ok(r.status === 409, 'skin fade not in package');
let b4 = await book('svc-classic'); r = await done(b4); ok(r.status === 200, 'classic 1/2');
r = await req('GET', '/me/subscriptions', null, tok); s = r.body.subscriptions.find((x) => x.id === subId);
ok(s.cutsUsed === 2 && s.items.find((i) => i.serviceId === 'svc-beard').used === 1 && s.items.find((i) => i.serviceId === 'svc-classic').used === 1, 'used per service tracked');
// Greșeală: confirmarea anulată → vizita revine în abonament.
r = await req('DELETE', `/admin/bookings/${b1}/complete`, null, at); ok(r.status === 200, 'undo completion');
r = await req('GET', '/me/subscriptions', null, tok); s = r.body.subscriptions.find((x) => x.id === subId);
ok(s.items.find((i) => i.serviceId === 'svc-beard').used === 0 && s.cutsUsed === 1, 'undo gives the beard back');
r = await done(b2); ok(r.status === 200, 'beard usable again after undo');
let b5 = await book('svc-classic'); r = await done(b5); ok(r.status === 200, 'classic 2/2');
r = await req('GET', '/me/subscriptions', null, tok); s = r.body.subscriptions.find((x) => x.id === subId);
ok(s.state === 'used_up' && s.cutsLeft === 0, 'package used up');

// Anulare (fără plată online: nimic de returnat pe card).
r = await req('PATCH', `/admin/subscriptions/${subId}`, { status: 'cancelled' }, at); ok(r.status === 200, 'owner cancels');

// Sugestia de pe Acasă: client nou cu 3 vizite plătite la salon în ultimele 30 de zile.
const phone2 = '0733' + rnd();
const email2 = `fidel${rnd()}@test.ro`;
r = await req('POST', '/auth/otp', { phone: phone2, email: email2, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone: phone2, code: r.body?.devCode, name: 'Client Fidel', email: email2, acceptTerms: true }, null, ip);
const tok2 = r.body.token;
r = await req('GET', '/me', null, tok2); const client2 = r.body.id;
r = await req('GET', '/me/custom-sub/hint', null, tok2); ok(r.status === 200 && r.body === null, 'no hint without visits');
for (const [i, svc] of [['svc-skin-fade', 0], ['svc-skin-fade', 1], ['svc-beard', 2]].map(([v, k]) => [k, v])) {
  const start = new Date(Date.now() - (3 + i * 5) * 86400000 - 7 * 3600000).toISOString();
  const bk = await req('POST', '/admin/bookings', { clientId: client2, serviceId: svc, barberId: 'barber-florin', start, force: true, notify: false }, at);
  r = await req('POST', `/admin/bookings/${bk.body.id}/complete`, { payment: 'paid' }, at);
}
r = await req('GET', '/me/custom-sub/hint', null, tok2);
ok(r.body && r.body.visits === 3 && r.body.discount === 10 && r.body.fullPrice === 175 && r.body.price === 157 && r.body.save === 18, `hint: 3 visits, would save 18 lei (${JSON.stringify(r.body)})`);

// Banner „abonament personalizat”: apare doar cât funcția e pornită.
r = await req('POST', '/admin/promos', { kicker: 'NOU', title: 'Abonamentul tău', cta: 'Creează-l', action: { type: 'custom_sub' } }, at); ok(r.status === 201, 'custom_sub banner created');
const promoId = r.body.id;
r = await req('GET', '/promos'); ok(r.body.some((p) => p.id === promoId && p.action.type === 'custom_sub'), 'banner visible while on');

r = await req('PUT', '/admin/custom-sub', { enabled: false }, at); ok(r.status === 200 && !r.body.enabled, 'turned off again');
r = await req('GET', '/promos'); ok(!r.body.some((p) => p.id === promoId), 'banner hidden while off');
r = await req('GET', '/me/custom-sub/hint', null, tok2); ok(r.body === null, 'no hint while off');
await req('DELETE', `/admin/promos/${promoId}`, null, at);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
