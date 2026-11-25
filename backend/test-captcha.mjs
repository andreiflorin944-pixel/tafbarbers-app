// Verificarea „nu sunt robot” (Turnstile) la cererea codurilor + CORS doar pe adresele salonului.
// Rulează pe `npm run dev`, cu DEV_OTP=1, ADMIN_SETUP_KEY și TURNSTILE_MOCK_BASE=http://127.0.0.1:8799 în .dev.vars.
import { createServer } from 'node:http';
const B = 'http://127.0.0.1:8787';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, headers = {}) {
  const r = await fetch(B + '/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j, headers: r.headers };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const ip = () => ({ 'CF-Connecting-IP': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

// Turnstile de probă: cheia secretă bună + un singur răspuns bun.
const GOOD = 'secret_good_1234567890';
let seen = [];
const mock = createServer((q, s) => {
  let d = '';
  q.on('data', (x) => (d += x));
  q.on('end', () => {
    const secret = /name="secret"\r\n\r\n([^\r]*)/.exec(d)?.[1];
    const token = /name="response"\r\n\r\n([^\r]*)/.exec(d)?.[1];
    seen.push(token);
    const body = secret !== GOOD ? { success: false, 'error-codes': ['invalid-input-secret'] } : token === 'tok-ok' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] };
    s.writeHead(200, { 'content-type': 'application/json' });
    s.end(JSON.stringify(body));
  });
}).listen(8799);

let r = await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'owner@taf.ro', password: 'parola-lunga-1' });
r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token;
ok(!!at, 'owner login');
await req('PUT', '/admin/captcha', { siteKey: '', secret: null, enforce: false }, at);

r = await req('POST', '/auth/otp', { phone: '0733' + rnd(), channel: 'sms' }, null, ip());
ok(r.status === 200, 'fără chei: codul pleacă fără verificare');
r = await req('GET', '/business');
ok(!r.body.captchaSiteKey, 'fără chei: aplicația nu arată verificarea');
r = await req('PUT', '/admin/captcha', { enforce: true }, at);
ok(r.status === 400 && r.body.error === 'captcha_incomplete', 'nu se poate porni fără chei');

r = await req('PUT', '/admin/captcha', { siteKey: '0x4AAAAAAAtest', secret: 'secret_bad_1234567890' }, at);
ok(r.status === 400 && r.body.error === 'captcha_secret_rejected', 'cheia secretă greșită e refuzată la salvare');
r = await req('PUT', '/admin/captcha', { siteKey: '0x4AAAAAAAtest', secret: GOOD }, at);
ok(r.status === 200 && r.body.hasSecret && r.body.secretHint === '7890' && !JSON.stringify(r.body).includes(GOOD), 'cheile se salvează, secretul nu se mai arată');
r = await req('GET', '/business');
ok(r.body.captchaSiteKey === '0x4AAAAAAAtest', 'aplicația primește cheia de site');
const page = await (await fetch(B + '/v1/captcha?lang=ro')).text();
ok(page.includes('0x4AAAAAAAtest') && page.includes('challenges.cloudflare.com/turnstile'), 'pagina verificării pentru aplicație');
const site = await (await fetch(B + '/site')).text();
ok(site.includes('turnstile/v0/api.js') && site.includes('"captcha":"0x4AAAAAAAtest"'), 'site-ul are verificarea');
const del = await (await fetch(B + '/sterge-cont')).text();
ok(del.includes('id="cf"') && del.includes('0x4AAAAAAAtest'), 'pagina de ștergere a contului are verificarea');
r = await req('POST', '/auth/otp', { phone: '0733' + rnd(), channel: 'sms' }, null, ip());
ok(r.status === 200, 'cheile puse, verificarea oprită: versiunile vechi primesc încă cod');

r = await req('PUT', '/admin/captcha', { enforce: true }, at);
ok(r.status === 200 && r.body.enforce, 'verificarea pornită');
const phone = '0733' + rnd();
r = await req('POST', '/auth/otp', { phone, channel: 'sms' }, null, ip());
ok(r.status === 400 && r.body.error === 'captcha_required', 'fără bifă: niciun cod');
r = await req('POST', '/auth/otp', { phone, channel: 'sms', captcha: 'tok-bad' }, null, ip());
ok(r.status === 400 && r.body.error === 'captcha_failed', 'bifă falsă: niciun cod');
r = await req('POST', '/auth/otp', { phone, channel: 'sms', captcha: 'tok-ok' }, null, ip());
ok(r.status === 200 && !!r.body.devCode, 'bifă bună: codul pleacă');
r = await req('POST', '/auth/password/forgot', { identifier: phone }, null, ip());
ok(r.status === 400 && r.body.error === 'captcha_required', 'parolă uitată fără bifă: niciun cod');
r = await req('POST', '/auth/password/forgot', { identifier: '0744' + rnd(), captcha: 'tok-ok' }, null, ip());
ok(r.status === 404 && r.body.error === 'no_account', 'parolă uitată cu bifă: trece de verificare (număr fără cont)');
r = await req('GET', '/admin/captcha', null, at);
ok(!!r.body.lastFailAt, 'panoul arată ultimul robot oprit');

// CORS: doar adresele salonului primesc voie de la browser.
r = await req('GET', '/business', null, null, { Origin: 'https://site-strain.com' });
ok(!r.headers.get('access-control-allow-origin'), 'CORS: un site străin nu primește voie');
r = await req('GET', '/business', null, null, { Origin: 'https://app.tafbarbers.ro' });
ok(r.headers.get('access-control-allow-origin') === 'https://app.tafbarbers.ro', 'CORS: site-ul salonului primește voie');

await req('PUT', '/admin/captcha', { siteKey: '', secret: null, enforce: false }, at);
mock.close();
console.log(fails ? `\n${fails} FAIL` : '\nTOATE OK');
process.exit(fails ? 1 : 0);
