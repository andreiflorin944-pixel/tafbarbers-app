const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const tomorrow = new Date(Date.now() + 86400000);
// pick next weekday (Mon-Fri)
while ([0, 6].includes(tomorrow.getUTCDay())) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const day = tomorrow.toISOString().slice(0, 10);

let r = await req('GET', '/business'); ok(r.status === 200 && r.body.hours[1]?.open === '10:00' && r.body.hours[0] === null, `business hours ${JSON.stringify(r.body.hours)}`);
r = await req('GET', '/services'); ok(r.body.length === 7 && r.body[0].price === 100, 'services 7, first 100 lei');
r = await req('GET', '/barbers'); ok(r.body.length === 2 && r.body[0].serviceIds.length === 7, 'barbers 2 with services');
r = await req('GET', `/availability?serviceId=svc-classic&day=${day}`);
ok(r.status === 200 && r.body.length > 0, `availability any: ${r.body.length} slots, first ${r.body[0]?.start}`);
const firstLocal = new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' }).format(new Date(r.body[0].start));
ok(firstLocal === '10:00', `first slot local time = ${firstLocal}`);
const lastLocal = new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' }).format(new Date(r.body.at(-1).start));
ok(lastLocal === '19:30', `last 30-min slot local = ${lastLocal}`);
const slot = r.body[0];

// auth
r = await req('POST', '/me/bookings'.replace('/me/bookings','/bookings'), { serviceId: 'svc-classic', start: slot.start }); ok(r.status === 401, 'booking without auth -> 401');
r = await req('POST', '/auth/otp', { phone: '0712 345 678' }); ok(r.status === 200 && r.body.phone === '+40712345678' && r.body.devCode, 'otp sent, phone normalized');
const code = r.body.devCode;
r = await req('POST', '/auth/otp', { phone: '0712345678' }); ok(r.status === 429, 'otp resend throttled');
r = await req('POST', '/auth/otp', { phone: '+12025550123' }); ok(r.status === 400 && r.body.error === 'country_not_supported', 'US number rejected');
r = await req('POST', '/auth/verify', { phone: '0712345678', code: code === '0000' ? '1111' : '0000' }); ok(r.status === 400, 'wrong code rejected');
r = await req('POST', '/auth/verify', { phone: '0712345678', code, name: 'Test Client', lang: 'fr' }); ok(r.status === 200 && r.body.token, 'verify ok');
const tok = r.body.token;
r = await req('GET', '/me', null, tok); ok(r.body.name === 'Test Client' && r.body.lang === 'fr', 'me');

// booking
r = await req('POST', '/bookings', { serviceId: 'svc-classic', barberId: null, start: slot.start }, tok); ok(r.status === 201 && r.body.barberId === slot.barberId, `booked ${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
const bk = r.body;
r = await req('POST', '/bookings', { serviceId: 'svc-classic', barberId: slot.barberId, start: slot.start }, tok); ok(r.status === 409, 'same barber same slot -> 409');
r = await req('GET', `/availability?serviceId=svc-classic&barberId=${slot.barberId}&day=${day}`); ok(!r.body.some(s => s.start === slot.start), 'slot gone for that barber');
r = await req('GET', `/availability?serviceId=svc-classic&day=${day}`); ok(r.body.find(s => s.start === slot.start)?.barberId !== slot.barberId, 'any-barber slot moved to other barber');
r = await req('GET', '/me/bookings', null, tok); ok(r.body.length === 1 && r.body[0].serviceName, 'my bookings');
r = await req('POST', '/bookings', { serviceId: 'svc-classic', start: '2020-01-01T10:00:00Z' }, tok); ok(r.status === 409, 'past slot rejected');

// admin
r = await req('POST', '/admin/setup', { setupKey: 'wrong', email: 'a@b.ro', password: 'x'.repeat(12) }); ok(r.status === 403, 'setup wrong key 403');
r = await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'Owner@Taf.ro', password: 'parola-lunga-1' }); ok(r.status === 201, 'setup ok');
r = await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'x@taf.ro', password: 'parola-lunga-1' }); ok(r.status === 409, 'setup only once');
r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'nope-nope-nope' }); ok(r.status === 401, 'bad login');
r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' }); ok(r.status === 200, 'login');
const at = r.body.token;
r = await req('GET', '/admin/services', null, tok); ok(r.status === 401, 'client token cannot access admin');
r = await req('GET', '/admin/bookings', null, at); ok(r.body.length === 1 && r.body[0].clientName === 'Test Client', 'admin sees booking');
r = await req('POST', '/admin/services', { name: 'Tuns + spălat', durationMin: 40, price: 80 }, at); ok(r.status === 201 && r.body.price === 80, 'create service');
const svcId = r.body.id;
r = await req('PATCH', `/admin/services/${svcId}`, { price: 85, active: false }, at); ok(r.body.price === 85 && !r.body.active, 'update service');
r = await req('GET', '/services'); ok(r.body.length === 7, 'inactive service hidden publicly');
r = await req('POST', '/admin/promos', { kicker: 'OFERTA', title: '-20%', cta: 'Rezervă', action: { type: 'service', serviceId: 'svc-classic' }, translations: { fr: { title: '-20% FR' } } }, at); ok(r.status === 201, 'create promo');
r = await req('GET', '/promos?lang=fr'); ok(r.body[0]?.title === '-20% FR' && r.body[0].kicker === 'OFERTA', 'promo translated with fallback');
// time off whole salon tomorrow -> no slots
r = await req('POST', '/admin/time-off', { fromDay: day, toDay: day, reason: 'test' }, at); ok(r.status === 201, 'time off');
const toId = r.body.id;
r = await req('GET', `/availability?serviceId=svc-classic&day=${day}`); ok(r.body.length === 0, 'no slots on day off');
await req('DELETE', `/admin/time-off/${toId}`, null, at);
// hours change: Florin only 12-14 on that weekday
const wd = new Date(day + 'T12:00:00Z').getUTCDay();
r = await req('PATCH', '/admin/barbers/barber-andrei', { active: false }, at);
r = await req('PATCH', '/admin/barbers/barber-florin', { hours: [{ weekday: wd, start: 720, end: 840 }] }, at); ok(r.status === 200, 'set hours');
r = await req('GET', `/availability?serviceId=svc-classic&day=${day}`); ok(r.body.length === 7, `only 12-14 => 7 starts (15-min grid), got ${r.body.length}`);
// admin force booking outside hours
r = await req('POST', '/admin/bookings', { phone: '0722000111', name: 'Walk In', serviceId: 'svc-beard', barberId: 'barber-florin', start: new Date(new Date(r.body[0].start).getTime() - 3*3600000).toISOString(), force: true }, at); ok(r.status === 201 && r.body.source === 'admin', 'admin forced booking');
r = await req('PATCH', `/admin/bookings/${bk.id}`, { status: 'cancelled' }, at); ok(r.body.status === 'cancelled', 'admin cancel');
r = await req('GET', '/admin/stats', null, at); ok(r.status === 200 && typeof r.body.upcoming === 'number', `stats ${JSON.stringify(r.body)}`);
r = await req('PATCH', '/me', { email: 'c@test.ro', marketing: { email: true, sms: true } }, tok); ok(r.body.marketing.email, 'marketing opt-in');
r = await req('GET', '/admin/campaigns/audience', null, at); ok(r.body.email === 1 && r.body.sms === 1, `audience ${JSON.stringify(r.body)}`);
r = await req('POST', '/admin/campaigns', { channel: 'email', title: 'Oferta', body: 'Salut', sendNow: true }, at); ok(r.status === 201, 'campaign send');
await new Promise(r => setTimeout(r, 800));
r = await req('GET', '/admin/campaigns', null, at); ok(r.body[0].status === 'sent' && r.body[0].recipients === 1, `campaign sent ${r.body[0].status}`);
r = await req('GET', '/admin/messages', null, at); ok(r.body.some(m => m.kind === 'confirm') && r.body.some(m => m.kind === 'otp'), `message log kinds ${[...new Set(r.body.map(m=>m.kind))]}`);
r = await req('POST', '/push-tokens', { token: 'ExponentPushToken[abc]', platform: 'ios' }, tok); ok(r.status === 200, 'push token saved');

// permissions for barber accounts
r = await req('POST', '/admin/admins', { email: 'andrei@taf.ro', name: 'Andrei', password: 'parola-andrei-1', barberId: 'barber-andrei' }, at); ok(r.status === 201, 'create barber account');
const andreiId = r.body.id;
r = await req('POST', '/admin/login', { email: 'andrei@taf.ro', password: 'parola-andrei-1' }); const bt = r.body.token; ok(!!bt, 'barber login');
r = await req('GET', '/admin/me', null, bt); ok(r.body.owner === false && r.body.permissions.bookings_create === true && r.body.permissions.clients === false, 'barber default perms');
r = await req('GET', '/admin/bookings', null, bt); ok(r.body.every(x => x.barberId === 'barber-andrei'), `barber sees only own bookings (${r.body.length})`);
r = await req('GET', '/admin/clients', null, bt); ok(r.status === 403, 'barber cannot list clients by default');
r = await req('POST', '/admin/services', { name: 'x', durationMin: 30, price: 1 }, bt); ok(r.status === 403, 'barber cannot edit services');
r = await req('GET', '/admin/stats', null, bt); ok(r.status === 200 && r.body.last30.revenue === null, 'barber stats without revenue');
r = await req('PATCH', `/admin/admins/${andreiId}`, { permissions: { clients: true, bookings_all: true } }, at); ok(r.status === 200, 'owner updates perms');
r = await req('GET', '/admin/clients', null, bt); ok(r.status === 200, 'barber can list clients after grant');
r = await req('GET', '/admin/admins', null, at); ok(r.body.find(a => a.id === andreiId)?.permissions.bookings_all === true, 'perms persisted');
r = await req('PATCH', `/admin/admins/${andreiId}`, { permissions: { bookings_create: false } }, at);
r = await req('POST', '/admin/bookings', { phone: '0722000333', serviceId: 'svc-beard', barberId: 'barber-andrei', start: new Date(Date.now() + 3 * 86400000).toISOString() }, bt); ok(r.status === 403, 'create blocked when permission removed');
// restore
await req('PATCH', '/admin/barbers/barber-andrei', { active: true }, at);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
