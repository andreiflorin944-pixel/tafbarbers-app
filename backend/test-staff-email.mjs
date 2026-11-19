// Schimbarea e-mailului unui cont din echipă + „Am uitat parola” pentru echipă (panou și aplicația echipei).
// Rulează pe `npm run dev`, cu DEV_OTP=1 și ADMIN_SETUP_KEY în .dev.vars.
const B = 'http://127.0.0.1:8787';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, headers = {}) {
  const r = await fetch(B + '/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const ip = () => ({ 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const n = Date.now().toString(36);

await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'owner@taf.ro', password: 'parola-lunga-1' });
let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token;
ok(!!at, 'owner login');
await req('PUT', '/admin/captcha', { enforce: false }, at);

const oldEmail = `frizer-${n}@gresit.ro`;
const newEmail = `frizer-${n}@bun.ro`;
r = await req('POST', '/admin/admins', { email: oldEmail, name: 'Frizer', password: 'parola-veche-1', role: 'barber' }, at);
const id = r.body.id;
ok(r.status === 201, 'cont de frizer creat');
r = await req('POST', '/admin/login', { email: oldEmail, password: 'parola-veche-1' });
const bt = r.body.token;
ok(!!bt, 'frizerul intră cu e-mailul vechi');

// Un cod cerut pe adresa veche nu mai merge după schimbare.
r = await req('POST', '/admin/password/forgot', { email: oldEmail }, null, ip());
const oldCode = r.body.devCode;
ok(r.status === 200 && !!oldCode, 'cod cerut pe adresa veche');

// E-mailul altui cont: refuzat.
r = await req('PATCH', `/admin/admins/${id}`, { email: 'OWNER@taf.ro' }, at);
ok(r.status === 409 && r.body.error === 'email_taken', 'e-mailul altui cont e refuzat');
r = await req('PATCH', `/admin/admins/${id}`, { email: 'nu-e-email' }, at);
ok(r.status === 400 && r.body.error === 'invalid_email', 'adresă greșită refuzată');
r = await req('PATCH', `/admin/admins/${id}`, { email: 'x@y.ro' }, bt);
ok(r.status === 403, 'frizerul nu-și poate schimba singur e-mailul din echipă');

r = await req('PATCH', `/admin/admins/${id}`, { email: `  ${newEmail.toUpperCase()} `, name: 'Frizer Nou' }, at);
ok(r.status === 200, 'proprietarul schimbă e-mailul');
r = await req('GET', '/admin/admins', null, at);
const row = r.body.find((a) => a.id === id);
ok(row?.email === newEmail && row?.name === 'Frizer Nou', 'e-mailul nou apare în listă (litere mici)');
r = await req('GET', '/admin/me', null, bt);
ok(r.status === 200 && r.body.email === newEmail, 'sesiunea frizerului rămâne deschisă');
r = await req('POST', '/admin/login', { email: oldEmail, password: 'parola-veche-1' });
ok(r.status === 401, 'e-mailul vechi nu mai merge la intrare');
r = await req('POST', '/admin/login', { email: newEmail, password: 'parola-veche-1' });
ok(r.status === 200, 'intră cu e-mailul nou și aceeași parolă');
r = await req('POST', '/admin/password/reset', { email: newEmail, code: oldCode, password: 'parola-noua-12' });
ok(r.status === 400 && r.body.error === 'code_expired', 'codul trimis pe adresa veche nu mai merge');

// „Am uitat parola” pe adresa nouă.
r = await req('POST', '/admin/password/forgot', { email: 'nimeni@nicaieri.ro' }, null, ip());
ok(r.status === 200 && !r.body.devCode, 'adresă necunoscută: același răspuns, fără cod');
r = await req('POST', '/admin/password/forgot', { email: newEmail }, null, ip());
const code = r.body.devCode;
ok(r.status === 200 && !!code, 'cod trimis pe e-mailul nou');
r = await req('POST', '/admin/password/reset', { email: newEmail, code: '000000' === code ? '111111' : '000000', password: 'parola-noua-12' });
ok(r.status === 400 && r.body.error === 'wrong_code', 'cod greșit refuzat');
r = await req('POST', '/admin/password/reset', { email: newEmail, code, password: 'scurta' });
ok(r.status === 400 && r.body.error === 'password_too_short', 'parolă prea scurtă refuzată');
r = await req('POST', '/admin/password/reset', { email: newEmail, code, password: 'parola-noua-12' });
ok(r.status === 200 && !!r.body.token, 'parola nouă pusă, intră direct');
const nt = r.body.token;
r = await req('POST', '/admin/password/reset', { email: newEmail, code, password: 'alta-parola-12' });
ok(r.status === 400, 'codul merge o singură dată');
r = await req('GET', '/admin/me', null, bt);
ok(r.status === 401, 'sesiunile vechi sunt închise după resetare');
r = await req('GET', '/admin/me', null, nt);
ok(r.status === 200 && r.body.id === id, 'sesiunea nouă merge');
r = await req('POST', '/admin/login', { email: newEmail, password: 'parola-veche-1' });
ok(r.status === 401, 'parola veche nu mai merge');
r = await req('POST', '/admin/login', { email: newEmail, password: 'parola-noua-12' });
ok(r.status === 200, 'parola nouă merge');

// Cu verificarea „nu sunt robot” pornită, cererea fără bifă e refuzată (la fel ca la clienți).
r = await req('PUT', '/admin/captcha', { siteKey: '0x4AAAAAAAtest', secret: 'secret_good_1234567890' }, at);
if (r.status === 200) {
  await req('PUT', '/admin/captcha', { enforce: true }, at);
  r = await req('POST', '/admin/password/forgot', { email: newEmail }, null, ip());
  ok(r.status === 400 && r.body.error === 'captcha_required', 'bifa „nu sunt robot” e cerută');
  await req('PUT', '/admin/captcha', { siteKey: '', secret: null, enforce: false }, at);
} else console.log('SKIP captcha (fără serverul Turnstile de probă)');

// Contul de acces e separat de frizerul din calendar: ștergerea contului nu atinge frizerul.
r = await req('POST', '/admin/barbers', { name: `Frizer test ${n}` }, at);
const barberId = r.body?.id;
ok(!!barberId, 'frizer creat în tabel');
r = await req('PATCH', `/admin/admins/${id}`, { barberId }, at);
ok(r.status === 200, 'contul e legat de frizer');
r = await req('DELETE', `/admin/admins/${id}`, null, at);
ok(r.status === 200, 'contul de acces șters');
r = await req('GET', '/admin/barbers', null, at);
ok(r.body.some((b) => b.id === barberId), 'frizerul rămâne în tabel după ștergerea contului');
r = await req('GET', '/admin/me', null, nt);
ok(r.status === 401, 'contul șters nu mai intră');
r = await req('POST', '/admin/admins', { email: newEmail, name: 'Frizer', password: 'parola-alt-cont1', role: 'barber', barberId }, at);
ok(r.status === 201, 'cont nou cu același e-mail, atribuit aceluiași frizer');
const id2 = r.body.id;
r = await req('POST', '/admin/login', { email: newEmail, password: 'parola-alt-cont1' });
r = await req('GET', '/admin/me', null, r.body.token);
ok(r.status === 200 && r.body.barberId === barberId, 'contul nou lucrează pe același frizer');
await req('DELETE', `/admin/admins/${id2}`, null, at);
await req('DELETE', `/admin/barbers/${barberId}`, null, at);
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
