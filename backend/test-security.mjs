// Verificări pentru reparațiile din auditul din 6 nov. 2026 (rulează pe `npm run dev`, cu DEV_OTP=1 și ADMIN_SETUP_KEY în .dev.vars).
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, headers = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const ipHdr = (ip) => ({ 'CF-Connecting-IP': ip });
async function account(phone, email, extra = {}, channel = 'email') {
  const h = ipHdr(`10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
  let r = await req('POST', '/auth/otp', channel === 'email' ? { phone, email, channel } : { phone, channel }, null, h);
  r = await req('POST', '/auth/verify', { phone, code: r.body?.devCode, acceptTerms: true, name: 'T', email, ...extra }, null, h);
  return r.body?.token;
}

// Proprietarul (îl face test-api.mjs; altfel îl facem aici).
let r = await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'owner@taf.ro', password: 'parola-lunga-1' });
r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token;
ok(!!at, 'owner login');

// B1: cont pe numărul altcuiva, cu cod pe e-mail
const victim = '0744' + rnd();
r = await req('POST', '/admin/gift-cards', { amount: 200, recipientName: 'Ion', recipientPhone: victim }, at);
const code = r.body.code;
ok(r.status === 201 && !!code, 'card cadou vândut la salon');
const fake = await account(victim, `fals${rnd()}@exemplu.ro`);
r = await req('GET', '/me/gift-cards', null, fake);
ok(r.status === 200 && r.body.received.length === 0, 'B1: contul cu număr nedovedit nu vede cardul primit');
r = await req('GET', '/me/export', null, fake);
ok(!JSON.stringify(r.body.giftCards).includes(code), 'B1: nici în exportul datelor');
r = await req('DELETE', '/me', null, fake);
r = await req('GET', '/admin/gift-cards', null, at);
ok(r.body.find((g) => g.code === code)?.recipientPhone, 'B1: ștergerea contului fals nu dezleagă cardul de destinatar');
// Cel care are cu adevărat numărul intră cu cod prin SMS: vede cardul.
const real = await account(victim, `ion${rnd()}@exemplu.ro`, {}, 'sms');
r = await req('GET', '/me/gift-cards', null, real);
ok(r.body.received.some((g) => g.code === code), 'B1: titularul dovedit prin SMS vede cardul');

// B2: limita pe IP la coduri
const ip = `10.9.${Math.floor(Math.random() * 250)}.1`;
const st = [];
for (let i = 0; i < 12; i++) st.push((await req('POST', '/auth/otp', { phone: '0733' + rnd(), channel: 'sms' }, null, ipHdr(ip))).status);
ok(st.slice(0, 10).every((s) => s === 200) && st[10] === 429 && st[11] === 429, `B2: al 11-lea cod de pe același IP într-o oră e refuzat (${st.join(',')})`);
r = await req('POST', '/auth/otp', { phone: '0733' + rnd(), channel: 'sms' }, null, ipHdr(ip.replace(/\.1$/, '.2')));
ok(r.status === 200, 'B2: de pe alt IP merge');

// B5: jurnalul de erori
const eip = ipHdr(`10.8.${Math.floor(Math.random() * 250)}.1`);
for (let i = 0; i < 35; i++) await req('POST', '/app-errors', { message: `spam-${i}`, platform: 'ios' }, null, eip);
r = await req('GET', '/admin/app-errors', null, at);
const spam = JSON.stringify(r.body).match(/spam-\d+/g) ?? [];
ok(spam.length === 30, `B5: cel mult 30 de erori pe zi de pe un IP (${spam.length})`);

// B6: administratorul de locație
r = await req('GET', '/admin/locations', null, at);
const loc1 = (Array.isArray(r.body) ? r.body : r.body.locations)[0].id;
r = await req('POST', '/admin/locations', { name: 'Salon 2', address: 'Str. Test' }, at);
const loc2 = r.body.id;
r = await req('POST', '/admin/barbers', { name: 'Frizer 2', locationId: loc2 }, at);
const br2 = r.body.id;
const day = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
r = await req('POST', '/admin/bookings', { phone: '0722' + rnd(), name: 'X', serviceId: 'svc-classic', barberId: br2, start: `${day}T09:00:00Z`, force: true, notify: false }, at);
const bk2 = r.body.id;
ok(r.status === 201, 'programare în locația 2');
const em = `loc${rnd()}@taf.ro`;
r = await req('POST', '/admin/admins', { email: em, password: 'parola-lunga-1', role: 'location_admin' }, at);
await req('PATCH', `/admin/admins/${r.body.id}`, { locationId: loc1 }, at);
r = await req('POST', '/admin/login', { email: em, password: 'parola-lunga-1' });
const lt = r.body.token;
r = await req('PATCH', `/admin/bookings/${bk2}`, { status: 'cancelled' }, lt);
ok(r.status === 404, 'B6: adminul locației 1 nu poate anula în locația 2');
r = await req('GET', `/admin/bookings/${bk2}/checkout`, null, lt);
ok(r.status === 404, 'B6: nici încasa');
r = await req('POST', '/admin/bookings', { phone: '0722' + rnd(), name: 'Y', serviceId: 'svc-classic', barberId: br2, start: `${day}T11:00:00Z`, force: true }, lt);
ok(r.status === 403, 'B6: nici programa la frizerul din locația 2');
r = await req('PATCH', `/admin/bookings/${bk2}`, { status: 'cancelled' }, at);
ok(r.status === 200, 'proprietarul poate în continuare');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
