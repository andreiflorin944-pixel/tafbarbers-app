// „Am uitat parola” (client): codul pleacă pe ce a scris clientul, cu rezervă pe celălalt canal, și răspunsul spune unde a plecat.
// Rulează pe `npm run dev`, cu DEV_OTP=1 și ADMIN_SETUP_KEY în .dev.vars.
const B = 'http://127.0.0.1:8787';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, headers = {}) {
  const r = await fetch(B + '/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const ip = () => ({ 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

let r = await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'owner@taf.ro', password: 'parola-lunga-1' });
r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token;
ok(!!at, 'owner login');
await req('PUT', '/admin/captcha', { siteKey: '', secret: null, enforce: false }, at);
await req('PUT', '/admin/automations/switch', { key: 'otpSms', enabled: true }, at);

// Client cu telefon și e-mail.
const phone = '0745' + rnd();
const email = `ion${rnd()}@test.ro`;
r = await req('POST', '/auth/otp', { phone, channel: 'sms' }, null, ip());
r = await req('POST', '/auth/verify', { phone, code: r.body.devCode, name: 'Ion', acceptTerms: true, email }, null, ip());
ok(!!r.body.token, 'cont făcut');

r = await req('POST', '/auth/password/forgot', { identifier: '0799' + rnd() }, null, ip());
ok(r.status === 404 && r.body.error === 'no_account', 'număr fără cont: clientul află');

r = await req('POST', '/auth/password/forgot', { identifier: phone }, null, ip());
ok(r.status === 200 && r.body.channel === 'sms' && /^\+40\d\d\*{5}\d\d$/.test(r.body.sentTo) && !!r.body.devCode, `telefon scris: cod prin SMS (${r.body.sentTo})`);
const code1 = r.body.devCode;

r = await req('POST', '/auth/password/forgot', { identifier: email }, null, ip());
ok(r.status === 429 && r.body.error === 'too_many_requests', 'cerut iar imediat: clientul află să aștepte (nu mai tace)');

r = await req('POST', '/auth/password/reset', { identifier: phone, code: code1, password: 'parola-noua-1' }, null, ip());
ok(r.status === 200 && !!r.body.token, 'codul din SMS pune parola');
r = await req('POST', '/auth/password/login', { identifier: email, password: 'parola-noua-1' }, null, ip());
ok(r.status === 200, 'intră cu parola nouă');

// Alt client: e-mail scris → e-mail.
const phone2 = '0746' + rnd();
const email2 = `ana${rnd()}@test.ro`;
r = await req('POST', '/auth/otp', { phone: phone2, channel: 'sms' }, null, ip());
await req('POST', '/auth/verify', { phone: phone2, code: r.body.devCode, name: 'Ana', acceptTerms: true, email: email2 }, null, ip());
r = await req('POST', '/auth/password/forgot', { identifier: email2.toUpperCase() }, null, ip());
ok(r.status === 200 && r.body.channel === 'email' && r.body.sentTo === `${email2.slice(0, 2)}***@test.ro`, `e-mail scris: cod pe e-mail (${r.body.sentTo})`);

// „Cod prin SMS” oprit din panou.
await req('PUT', '/admin/automations/switch', { key: 'otpSms', enabled: false }, at);
const phone3 = '0747' + rnd();
const email3 = `dan${rnd()}@test.ro`;
r = await req('POST', '/auth/otp', { phone: phone3, channel: 'email', email: email3 }, null, ip());
await req('POST', '/auth/verify', { phone: phone3, code: r.body.devCode, name: 'Dan', acceptTerms: true }, null, ip());
r = await req('POST', '/auth/password/forgot', { identifier: phone3 }, null, ip());
ok(r.status === 200 && r.body.channel === 'email', 'SMS oprit, telefon scris: codul pleacă pe e-mailul contului');

// Client adus din panou / Barberly doar cu telefonul (fără e-mail), cu SMS oprit: tot primește SMS (singura cale).
const phone4 = '0748' + rnd();
r = await req('POST', '/admin/clients', { name: 'Fără Email', phone: phone4 }, at);
ok(r.status === 200 || r.status === 201, 'client fără e-mail adăugat din panou');
r = await req('POST', '/auth/password/forgot', { identifier: phone4 }, null, ip());
ok(r.status === 200 && r.body.channel === 'sms' && !!r.body.devCode, 'cont fără e-mail, SMS oprit: codul vine totuși prin SMS');
r = await req('POST', '/auth/password/reset', { identifier: phone4, code: r.body.devCode, password: 'parola-noua-4', acceptTerms: true }, null, ip());
ok(r.status === 200 && !!r.body.token, 'și intră în cont');
await req('PUT', '/admin/automations/switch', { key: 'otpSms', enabled: true }, at);

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
