// Blocarea unui client și curățenia conturilor după criterii (Panou → Clienți). Rulează după test-api.mjs, pe `wrangler dev` local.
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
const at = r.body.token;
const ip = { 'CF-Connecting-IP': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
const phone = '0738' + rnd(), email = `blocat${rnd()}@test.ro`;
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone, code: r.body?.devCode, name: 'Client Problemă', email, acceptTerms: true }, null, ip);
const tok = r.body.token;
r = await req('GET', '/me', null, tok); const id = r.body.id;
ok(!!id, 'client registered');

// Blocare.
r = await req('POST', `/admin/clients/${id}/block`, { reason: 'Nu vine la programări' }, at);
ok(r.status === 200, 'owner blocks client');
r = await req('GET', '/me', null, tok); ok(r.status === 401, 'blocked client is logged out');
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip); ok(r.status === 403 && r.body.error === 'account_blocked', 'no login code for blocked client');
r = await req('GET', `/admin/clients/${id}`, null, at); ok(r.body.blocked?.reason === 'Nu vine la programări', 'panel shows blocked + reason');
r = await req('GET', `/admin/clients?q=${phone.slice(1)}`, null, at); ok(r.body.some?.((x) => x.id === id && x.blocked), 'search marks blocked');
r = await req('POST', '/admin/clients/cleanup/preview', { blockedOnly: true }, at); ok(r.status === 200 && r.body.items.some((x) => x.id === id && x.blocked), 'cleanup finds blocked clients');
r = await req('DELETE', `/admin/clients/${id}/block`, null, at); ok(r.status === 200, 'owner unblocks');
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone, code: r.body?.devCode }, null, ip); ok(r.status === 200 && !!r.body.token, 'unblocked client logs in again');

// Curățenie: criterii obligatorii, previzualizare, confirmare.
r = await req('POST', '/admin/clients/cleanup/preview', {}, at); ok(r.status === 400 && r.body.error === 'criteria_required', 'criteria required');
r = await req('POST', '/admin/clients/cleanup/preview', { noVisitMonths: 0 }, at); ok(r.status === 400, 'bad months refused');
// Client adăugat din panou, fără aplicație și fără vizite.
const p2 = '0739' + rnd();
r = await req('POST', '/admin/clients', { phone: p2, name: 'Fără Vizite' }, at); const id2 = r.body?.id;
ok(!!id2, `panel client created (${r.status})`);
r = await req('POST', '/admin/clients/cleanup/preview', { neverVisited: true, noApp: true }, at);
ok(r.body.items.some((x) => x.id === id2) && !r.body.items.some((x) => x.id === id), 'never visited + no app: includes panel client, not app client');
// Cu programare viitoare nu se șterge.
r = await req('GET', '/barbers'); const barberId = r.body[0].id;
const d = new Date(Date.now() + 3 * 86_400_000); d.setUTCHours(9, 0, 0, 0);
r = await req('POST', '/admin/bookings', { clientId: id2, serviceId: 'svc-classic', barberId, start: d.toISOString(), force: true, notify: false }, at);
const bk = r.body;
r = await req('POST', '/admin/clients/cleanup/preview', { neverVisited: true, noApp: true }, at);
ok(!r.body.items.some((x) => x.id === id2) && r.body.kept >= 1, 'client with future booking is kept');
await req('PATCH', `/admin/bookings/${bk.id}`, { status: 'cancelled' }, at);
r = await req('POST', '/admin/clients/cleanup/delete', { criteria: { neverVisited: true, noApp: true }, ids: [id2] }, at);
ok(r.status === 400 && r.body.error === 'confirm_required', 'delete needs confirmation');
r = await req('POST', '/admin/clients/cleanup/delete', { criteria: { neverVisited: true, noApp: true }, ids: [id2, id], confirm: 'STERGE' }, at);
ok(r.status === 200 && r.body.deleted === 1 && r.body.skipped.includes(id), `deletes only matching (${JSON.stringify(r.body)})`);
r = await req('GET', `/admin/clients/${id2}`, null, at); ok(r.status === 404 || !!r.body?.deletedAt || r.body?.name === '' , `deleted client gone (${r.status})`);

// Doar proprietarul.
r = await req('POST', '/admin/admins', { email: `frizer${rnd()}@taf.ro`, password: 'parola-lunga-2', name: 'Frizer', role: 'barber' }, at);
const em = r.body?.email;
if (em) {
  r = await req('POST', '/admin/login', { email: em, password: 'parola-lunga-2' });
  const bt = r.body?.token;
  r = await req('POST', `/admin/clients/${id}/block`, {}, bt); ok(r.status === 403, 'barber cannot block');
  r = await req('POST', '/admin/clients/cleanup/preview', { neverVisited: true }, bt); ok(r.status === 403, 'barber cannot clean up');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
