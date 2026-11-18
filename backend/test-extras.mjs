// Servicii adăugate la o programare (ex. Tuns + Vopsit barbă): la programare nouă (client și panou) și după, din aplicație și din panou.
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

const ip = { 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
const register = async (name) => {
  const phone = '0736' + rnd();
  const email = `extra${rnd()}@test.ro`;
  let x = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
  x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name, email, acceptTerms: true }, null, ip);
  return x.body.token;
};
const tok = await register('Client Cu Extra');
ok(!!tok, 'client registered');

r = await req('GET', '/barbers');
const barberId = r.body[0].id;
const MAIN = 'svc-classic', EXTRA = 'svc-beard-color', EXTRA2 = 'svc-beard';
r = await req('GET', '/services');
const svc = Object.fromEntries(r.body.map((s) => [s.id, s]));

// O zi cu ore libere la frizer, pentru serviciu + vopsit.
let day = null, slots = [];
for (let i = 2; i < 12 && !slots.length; i++) {
  const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
  r = await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${d}&extra=${EXTRA}`);
  if (r.status === 200 && r.body.length > 4) { day = d; slots = r.body; }
}
ok(!!day, `found a day with free time (${day})`);
r = await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${day}`);
ok(r.body.length >= slots.length, 'longer booking has the same or fewer free times');
r = await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${day}&extra=nu-exista`);
ok(r.status === 404, 'unknown extra refused');

// Clientul programează Tuns + Vopsit barbă: durata și prețul se adună.
const pick = slots[Math.floor(slots.length / 2)];
r = await req('POST', '/bookings', { serviceId: MAIN, extraServiceIds: [EXTRA, EXTRA, MAIN], barberId, start: pick.start }, tok);
ok(r.status === 201, `client books with extra ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
const bk = r.body;
ok(bk.extras?.length === 1 && bk.extras[0].serviceId === EXTRA && bk.extras[0].name.includes('Vopsit'), 'one extra saved (duplicates and main ignored)');
ok(bk.price === svc[MAIN].price + svc[EXTRA].price, `price adds up (${bk.price})`);
ok(mins(bk) === svc[MAIN].durationMin + svc[EXTRA].durationMin, `duration adds up (${mins(bk)} min)`);
r = await req('GET', '/me/bookings', null, tok);
ok(r.body.find((b) => b.id === bk.id)?.extras?.length === 1, 'client list shows extras');
r = await req('GET', '/me/bookings?lang=en', null, tok);
ok(r.status === 200 && r.body.find((b) => b.id === bk.id)?.extras?.length === 1, 'english list keeps extras');
r = await req('POST', '/bookings', { serviceId: MAIN, extraServiceIds: [EXTRA, EXTRA2, 'svc-kids', 'svc-skin-fade'], barberId, start: pick.start }, tok);
ok(r.status === 400 && r.body.error === 'too_many_extras', 'more than 3 extras refused');

// Clientul scoate și pune la loc serviciul.
r = await req('DELETE', `/bookings/${bk.id}/extras/${bk.extras[0].id}`, null, tok);
ok(r.status === 200 && r.body.extras.length === 0 && r.body.price === svc[MAIN].price && mins(r.body) === svc[MAIN].durationMin, 'client removes extra: price and time back');
r = await req('POST', `/bookings/${bk.id}/extras`, { serviceId: EXTRA }, tok);
ok(r.status === 200 && r.body.extras.length === 1 && r.body.price === svc[MAIN].price + svc[EXTRA].price, 'client adds extra to existing booking');
const bkEnd = r.body.end;
r = await req('POST', `/bookings/${bk.id}/extras`, { serviceId: EXTRA }, tok);
ok(r.status === 409 && r.body.error === 'service_already_added', 'same extra twice refused');
r = await req('POST', `/bookings/${bk.id}/extras`, { serviceId: MAIN }, tok);
ok(r.status === 409 && r.body.error === 'service_already_added', 'main service as extra refused');
r = await req('POST', `/bookings/${bk.id}/extras`, { serviceId: EXTRA2 }, await register('Alt Client'));
ok(r.status === 404, "other client's booking not found");
r = await req('POST', `/bookings/${bk.id}/extras`, { serviceId: EXTRA2 });
ok(r.status === 401, 'needs login');
r = await req('GET', `/admin/bookings/${bk.id}/activity`, null, at);
ok(r.body.log?.some((e) => e.kind === 'extra_added') && r.body.log?.some((e) => e.kind === 'extra_removed'), 'activity log has extra entries');

// Panoul: altă programare imediat după → nu mai e timp de încă un serviciu.
r = await req('POST', '/admin/bookings', { clientId: (await req('GET', '/me', null, tok)).body.id, serviceId: 'svc-kids', barberId, start: bkEnd, force: true, notify: false }, at);
const next = r.body;
ok(r.status === 201 && !!next?.id, `next booking right after (${r.status})`);
r = await req('POST', `/bookings/${bk.id}/extras`, { serviceId: EXTRA2 }, tok);
ok(r.status === 409 && r.body.error === 'no_time_for_extra', 'client: no time for another extra');
r = await req('POST', `/admin/bookings/${bk.id}/extras`, { serviceId: EXTRA2, force: true }, at);
ok(r.status === 409 && r.body.error === 'no_time_for_extra', 'panel force still cannot overlap');
await req('PATCH', `/admin/bookings/${next.id}`, { status: 'cancelled' }, at);
r = await req('POST', `/admin/bookings/${bk.id}/extras`, { serviceId: EXTRA2 }, at);
ok(r.status === 200 && r.body.extras.length === 2 && r.body.price === svc[MAIN].price + svc[EXTRA].price + svc[EXTRA2].price, 'panel adds second extra');
const ex2 = r.body.extras.find((e) => e.serviceId === EXTRA2);
ok(mins(r.body) === svc[MAIN].durationMin + svc[EXTRA].durationMin + svc[EXTRA2].durationMin, 'panel extra adds time');

// Schimbarea serviciului principal păstrează serviciile adăugate.
r = await req('PATCH', `/admin/bookings/${bk.id}`, { serviceId: 'svc-skin-fade', force: true, notify: false }, at);
ok(r.status === 200 && r.body.extras.length === 2 && r.body.price === svc['svc-skin-fade'].price + svc[EXTRA].price + svc[EXTRA2].price, `main service change keeps extras (${r.body?.price})`);
ok(mins(r.body) === svc['svc-skin-fade'].durationMin + svc[EXTRA].durationMin + svc[EXTRA2].durationMin, 'main service change keeps extras time');
r = await req('PATCH', `/admin/bookings/${bk.id}`, { serviceId: EXTRA, force: true, notify: false }, at);
ok(r.status === 409 && r.body.error === 'service_already_added', 'main cannot become one of the extras');
{
  r = await req('DELETE', `/admin/bookings/${bk.id}/extras/${ex2.id}`, null, at);
  ok(r.status === 200 && r.body.extras.length === 1, 'panel removes extra');
}

// Programare din panou cu serviciu în plus.
const later = (await req('GET', `/availability?serviceId=${MAIN}&barberId=${barberId}&day=${day}&extra=${EXTRA2}`)).body.at(-1);
r = await req('POST', '/admin/bookings', { phone: '0737' + rnd(), name: 'Walk In', serviceId: MAIN, extraServiceIds: [EXTRA2], barberId, start: later.start, notify: false }, at);
ok(r.status === 201 && r.body.extras?.length === 1 && r.body.price === svc[MAIN].price + svc[EXTRA2].price, `panel booking with extra ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
const walk = r.body;

// Anulată: nu se mai poate adăuga.
await req('POST', `/bookings/${bk.id}/cancel`, null, tok);
r = await req('POST', `/bookings/${bk.id}/extras`, { serviceId: EXTRA2 }, tok);
ok(r.status === 409 && r.body.error === 'booking_not_editable', 'cancelled booking refused');
await req('PATCH', `/admin/bookings/${walk.id}`, { status: 'cancelled' }, at);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
