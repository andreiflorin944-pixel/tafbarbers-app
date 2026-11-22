// Promo „Ne urmărești?”: oprit implicit; pornit din panou apare în datele salonului; o singură reducere pe cont.
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
const ip = { 'CF-Connecting-IP': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
const phone = '0739' + rnd();
let x = await req('POST', '/auth/otp', { phone, email: `soc${rnd()}@test.ro`, channel: 'email' }, null, ip);
x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name: 'Social Test', email: `soc${rnd()}@test.ro`, acceptTerms: true }, null, ip);
const ct = x.body.token;

await req('PUT', '/admin/social-promo', { enabled: false }, at);
r = await req('GET', '/business');
ok(r.status === 200 && r.body.socialPromo === null, 'off: nothing public');
r = await req('POST', '/me/social-promo', {}, ct);
ok(r.status === 404, 'off: cannot claim');
const biz = (await req('GET', '/admin/settings', null, at)).body;
await req('PUT', '/admin/settings', { instagram: '@tafbarbers' }, at);
r = await req('PUT', '/admin/social-promo', { enabled: true, percent: 50, validDays: 60 }, at);
ok(r.status === 200, 'enable from panel');
r = await req('GET', '/business');
ok(r.body.socialPromo?.percent === 50 && r.body.socialPromo.links.instagram === 'https://www.instagram.com/tafbarbers', 'on: public with links');
r = await req('POST', '/me/social-promo', {}, ct);
ok(r.status === 200 && r.body.claimed && !r.body.already && r.body.bonus?.value === 50, 'claim gives 50% bonus');
r = await req('POST', '/me/social-promo', {}, ct);
ok(r.body.already === true, 'second claim: already');
r = await req('GET', '/me', null, ct);
ok(r.body.socialPromoClaimed === true, 'me shows claimed');
await req('PUT', '/admin/social-promo', { enabled: false }, at);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
