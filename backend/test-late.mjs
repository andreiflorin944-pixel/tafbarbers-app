// Mesajul clientului către frizer (cu „întârzii X min” opțional) și versiunea cerută în aplicație (Panou → Aplicații).
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

// Client nou.
const phone = '0734' + rnd();
const email = `intarzie${rnd()}@test.ro`;
const ip = { 'CF-Connecting-IP': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone, code: r.body?.devCode, name: 'Client Grăbit', email, acceptTerms: true }, null, ip);
ok(r.status === 200, 'client registered');
const tok = r.body.token;
r = await req('GET', '/me', null, tok); const clientId = r.body.id;

r = await req('GET', '/barbers'); const barberId = r.body[0].id;
// Ore la întâmplare, ca testul să poată rula de mai multe ori pe aceeași bază.
const shift = Math.floor(Math.random() * 10) * 5 * 60_000;
const at5 = (ms) => { const d = new Date(Date.now() + ms + (ms > 0 ? -shift : 0)); d.setUTCSeconds(0, 0); d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 5) * 5); return d.toISOString(); };
const mk = async (ms) => (await req('POST', '/admin/bookings', { clientId, serviceId: 'svc-classic', barberId, start: at5(ms), force: true, notify: false }, at)).body;

// Programare peste o oră: se poate anunța.
const soon = await mk(3_600_000);
ok(!!soon?.id, `booking in 1h created ${JSON.stringify(soon).slice(0, 80)}`);
r = await req('POST', `/bookings/${soon.id}/late`, { minutes: 7 }, tok); ok(r.status === 400 && r.body.error === 'invalid_minutes', '7 min refused');
r = await req('POST', `/bookings/${soon.id}/late`, { minutes: 10, note: '  Sunt   în trafic ' }, tok);
ok(r.status === 200 && r.body.lateMin === 10 && r.body.lateNote === 'Sunt în trafic' && !!r.body.lateAt, 'late 10 min saved with note');
r = await req('GET', '/me/bookings', null, tok); ok(r.body.find((b) => b.id === soon.id)?.lateMin === 10, 'client list shows lateMin');
r = await req('GET', '/admin/bookings/requests', null, at); ok(r.body.late?.some((b) => b.id === soon.id && b.lateMin === 10), 'panel bell lists the late client');
r = await req('GET', `/admin/bookings/${soon.id}/activity`, null, at); ok(r.body.log.some((e) => e.kind === 'late' && e.detail.minutes === 10), 'activity log has late entry');
r = await req('POST', `/bookings/${soon.id}/late`, {}, tok); ok(r.status === 400 && r.body.error === 'empty_message', 'empty message refused');
r = await req('POST', `/bookings/${soon.id}/late`, { note: 'Am ajuns, sunt în față' }, tok); ok(r.status === 200 && r.body.lateMin === 10 && r.body.lateNote === 'Am ajuns, sunt în față', 'message only keeps lateMin, saves text');
r = await req('POST', `/bookings/${soon.id}/late`, { minutes: 15 }, tok); ok(r.status === 200 && r.body.lateMin === 15 && r.body.lateNote === null, 'minutes only');
r = await req('POST', `/bookings/${soon.id}/late`, { note: 'a 4-a' }, tok); ok(r.status === 200, '4th ok');
r = await req('POST', `/bookings/${soon.id}/late`, { note: 'a 5-a' }, tok); ok(r.status === 200, '5th ok');
r = await req('POST', `/bookings/${soon.id}/late`, { note: 'a 6-a' }, tok); ok(r.status === 429 && r.body.error === 'late_too_many', '6th refused');

// Prea devreme (peste 5 ore) și programarea altcuiva.
const later = await mk(5 * 3_600_000);
r = await req('POST', `/bookings/${later.id}/late`, { minutes: 5 }, tok); ok(r.status === 409 && r.body.error === 'late_too_early', 'late minutes too early refused');
r = await req('POST', `/bookings/${later.id}/late`, { note: 'Pot veni cu fiul meu?' }, tok); ok(r.status === 200 && r.body.lateNote === 'Pot veni cu fiul meu?' && r.body.lateMin === null, 'plain message hours before is fine');
r = await req('POST', `/bookings/${soon.id}/late`, { minutes: 5 }); ok(r.status === 401, 'needs login');
const phone2 = '0735' + rnd();
r = await req('POST', '/auth/otp', { phone: phone2, email: `alt${rnd()}@test.ro`, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone: phone2, code: r.body?.devCode, name: 'Alt Client', email: `alt${rnd()}@test.ro`, acceptTerms: true }, null, ip);
r = await req('POST', `/bookings/${later.id}/late`, { minutes: 5 }, r.body.token); ok(r.status === 404, "other client's booking not found");
// Anulată: nu se mai poate.
const gone = await mk(2 * 3_600_000 + 1_800_000);
r = await req('PATCH', `/admin/bookings/${gone.id}`, { status: 'cancelled' }, at); ok(r.status === 200 && r.body.status === 'cancelled', 'salon cancels');
r = await req('POST', `/bookings/${gone.id}/late`, { note: 'x' }, tok); ok(r.status === 409 && r.body.error === 'booking_not_active', 'cancelled booking refused');

// Versiunea cerută în aplicație.
r = await req('GET', '/app-version'); ok(r.status === 200 && r.body.ios.min === '' && r.body.android.url.includes('ro.tafbarbers.app'), 'no version required by default');
r = await req('PUT', '/admin/apps/versions', { ios: { min: '1.0', latest: '' } }, at); ok(r.status === 400 && r.body.error === 'invalid_version_ios', 'bad version refused');
r = await req('PUT', '/admin/apps/versions', { ios: { min: '1.0.3', latest: '1.0.2' } }, at); ok(r.status === 400 && r.body.error === 'latest_below_min_ios', 'latest below min refused');
r = await req('PUT', '/admin/apps/versions', { ios: { min: '1.0.2', latest: '1.0.3' }, android: { min: '', latest: '1.0.3' }, message: 'Poți anunța dacă întârzii.' }, at);
ok(r.status === 200 && r.body.ios.min === '1.0.2', 'owner saves versions');
r = await req('GET', '/app-version'); ok(r.body.ios.min === '1.0.2' && r.body.ios.latest === '1.0.3' && r.body.android.latest === '1.0.3' && r.body.message.includes('întârzii'), 'app sees versions');
r = await req('GET', '/admin/apps', null, at); ok(r.body.versions?.ios.latest === '1.0.3', 'panel page returns versions');
await req('PUT', '/admin/apps/versions', {}, at);
for (const b of [soon, later]) await req('PATCH', `/admin/bookings/${b.id}`, { status: 'cancelled' }, at);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
