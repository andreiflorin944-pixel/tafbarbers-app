// Recomandări: lanț A → B → C (fiecare își vede prietenii și bonusurile), un client poate fi recomandat o singură dată,
// iar un client care exista deja (adus din panou / Barberly) și intră prima dată în aplicație cu un cod e legat și el.
// Rulează pe `wrangler dev` local (DEV_OTP=1), după test-api.mjs.
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token, extra = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...extra, ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const ip = () => ({ 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token;
// Beneficiu automat pentru cel care recomandă (setările implicite).
await req('PUT', '/admin/referral-settings', { enabled: true, auto: true, toReferrer: true, toNew: false }, at);

async function register(name, ref) {
  const phone = '0741' + rnd(), email = `ref${rnd()}@test.ro`, h = ip();
  let x = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, h);
  x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name, email, acceptTerms: true, ref }, null, h);
  const token = x.body?.token;
  const me = await req('GET', '/me', null, token);
  return { token, id: me.body?.id, phone };
}
const refs = async (tok) => (await req('GET', '/me/referrals', null, tok)).body;

// Lanțul Karina → B → C.
const A = await register('Karina Test');
const codeA = (await refs(A.token)).code;
ok(/^[A-Z2-9]{6}$/.test(codeA), `A has a code (${codeA})`);
const Bc = await register('Bogdan Test', codeA);
let ra = await refs(A.token);
ok(ra.referred === 1 && ra.bonuses.some((b) => b.source === 'referral'), 'A sees 1 friend + referral bonus');
const codeB = (await refs(Bc.token)).code;
ok(codeB && codeB !== codeA, 'B has its own code');
const C = await register('Cristi Test', codeB);
let rb = await refs(Bc.token);
ok(rb.referred === 1 && rb.bonuses.filter((b) => b.source === 'referral').length === 1, `B (referred by A) sees C + bonus (${JSON.stringify({ n: rb.referred, b: rb.bonuses.length })})`);
ra = await refs(A.token);
ok(ra.referred === 1 && ra.bonuses.filter((b) => b.source === 'referral').length === 1, 'A still sees only B (C does not move to A)');
r = await req('GET', `/admin/clients/${Bc.id}`, null, at);
ok(r.body.referredBy?.id === A.id && r.body.referredCount === 1, 'panel: B referred by A and brought 1');
r = await req('GET', `/admin/clients/${C.id}`, null, at);
ok(r.body.referredBy?.id === Bc.id, 'panel: C referred by B');
r = await req('GET', '/admin/referrals/tree', null, at);
const tA = r.body.find((x) => x.referrer.id === A.id), tB = r.body.find((x) => x.referrer.id === Bc.id);
ok(tA?.people.length === 1 && tA.people[0].id === Bc.id && tB?.people.length === 1 && tB.people[0].id === C.id, 'panel tree: A→B and B→C');

// Cod greșit sau propriul cod: nimic.
const D = await register('Dan Test', 'XXXXXX');
r = await req('GET', `/admin/clients/${D.id}`, null, at); ok(!r.body.referredBy, 'unknown code ignored');

// Client adăugat din panou (ca cei aduși din Barberly), care intră prima dată în aplicație cu codul lui B.
const pPhone = '0742' + rnd(), pEmail = `panou${rnd()}@test.ro`;
r = await req('POST', '/admin/clients', { phone: pPhone, name: 'Client Panou', email: pEmail }, at);
const pid = r.body?.id;
ok(!!pid, `panel client created (${r.status})`);
let h = ip();
r = await req('POST', '/auth/otp', { phone: pPhone, email: pEmail, channel: 'email' }, null, h);
ok(r.body?.newAccount === false, 'panel client: app sees existing account');
r = await req('POST', '/auth/verify', { phone: pPhone, code: r.body?.devCode, acceptTerms: true, ref: codeB }, null, h);
const pTok = r.body?.token;
ok(!!pTok, 'panel client logs in first time');
r = await req('GET', `/admin/clients/${pid}`, null, at);
ok(r.body.referredBy?.id === Bc.id, 'existing client entering the app first time with a code is linked to B');
rb = await refs(Bc.token);
ok(rb.referred === 2 && rb.bonuses.filter((b) => b.source === 'referral').length === 2, 'B now sees 2 friends + 2 bonuses');

// A doua intrare cu alt cod: nu se schimbă cine l-a recomandat și nu se mai dă bonus.
h = ip();
r = await req('POST', '/auth/otp', { phone: pPhone, email: pEmail, channel: 'email' }, null, h);
r = await req('POST', '/auth/verify', { phone: pPhone, code: r.body?.devCode, acceptTerms: true, ref: codeA }, null, h);
r = await req('GET', `/admin/clients/${pid}`, null, at);
ok(r.body.referredBy?.id === Bc.id, 'later login with another code does not change referrer');
ra = await refs(A.token);
ok(ra.referred === 1 && ra.bonuses.filter((b) => b.source === 'referral').length === 1, 'A got no extra bonus from a re-login');

// Cineva care folosea deja aplicația nu poate fi „recomandat” ulterior.
h = ip();
r = await req('POST', '/auth/otp', { phone: D.phone, channel: 'sms' }, null, h);
r = await req('POST', '/auth/verify', { phone: D.phone, code: r.body?.devCode, acceptTerms: true, ref: codeA }, null, h);
r = await req('GET', `/admin/clients/${D.id}`, null, at); ok(!r.body.referredBy, 'existing app user cannot be referred later');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
