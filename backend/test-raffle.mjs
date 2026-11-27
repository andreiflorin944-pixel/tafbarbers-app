// Tombola săptămânală: participă o dată fiecare client programat în săptămână, cu telefon și e-mail (nu anulat / nu „nu a venit”); extragerea dă premiul ca beneficiu.
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
const ip = { 'CF-Connecting-IP': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
const register = async (name) => {
  const phone = '0738' + rnd();
  const email = `raffle${rnd()}@test.ro`;
  let x = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
  x = await req('POST', '/auth/verify', { phone, code: x.body?.devCode, name, email, acceptTerms: true }, null, ip);
  const me = (await req('GET', '/me', null, x.body.token)).body;
  return { token: x.body.token, id: me.id, phone };
};

// Oprită: nimic public, nu se poate extrage.
r = await req('GET', '/raffle');
ok(r.status === 200 && r.body.enabled === false, 'public raffle off by default');
r = await req('POST', '/admin/raffle/draw', {}, at);
ok(r.status === 409 && r.body.error === 'raffle_off', 'cannot draw when off');

// Setări.
r = await req('PUT', '/admin/raffle', { enabled: true, prizes: ['Ceară de păr', 'Fixativ', 'Șampon', ''], winnersPerWeek: 2, validDays: 30 }, at);
ok(r.status === 200 && r.body.settings.enabled && r.body.settings.prizes.length === 3, 'settings saved, empty prize dropped');
r = await req('PUT', '/admin/raffle', { prizes: [] }, at);
ok(r.status === 400, 'needs at least one prize');
r = await req('GET', '/raffle?lang=ro');
ok(r.body.enabled && r.body.prizes.includes('Fixativ') && r.body.rulesUrl.endsWith('/tombola'), 'public raffle on');
r = await req('GET', '/raffle/rules');
ok(r.status === 200 && r.body.body.includes('Ceară de păr, Fixativ, Șampon') && r.body.body.includes('OG 99/2000'), 'rules filled with prizes');

// Clienți: A (cont, e-mail) cu 2 programări neîncasate; B (cont) marcat „nu a venit”; C fără cont, cu telefon + e-mail în fișă;
// D fără cont și fără e-mail; E (cont) cu programarea anulată.
const A = await register('Raffle Alfa Test');
const Bc = await register('Raffle Beta Test');
const E = await register('Raffle Epsilon Test');
const barbers = (await req('GET', '/barbers')).body;
const barberId = barbers[0].id;
// Ora: acum minus N minute, rotunjită (programare în trecut, din panou, cu „force”).
const past = (min) => { const d = new Date(Date.now() - min * 60_000); d.setUTCSeconds(0, 0); d.setUTCMinutes(d.getUTCMinutes() - (d.getUTCMinutes() % 5)); return d.toISOString().replace('.000Z', 'Z'); };
const book = async (body) => req('POST', '/admin/bookings', { serviceId: 'svc-classic', barberId, force: true, notify: false, ...body }, at);
let bA = await book({ clientId: A.id, start: past(200) });
ok(bA.status === 201, `booking A (${bA.status} ${JSON.stringify(bA.body).slice(0, 80)})`);
let bA2 = await book({ clientId: A.id, start: past(800) });
ok(bA2.status === 201, 'booking A second');
let bB = await book({ clientId: Bc.id, start: past(400) });
ok(bB.status === 201, 'booking B');
const cPhone = '0739' + rnd();
let bC = await book({ phone: cPhone, name: 'Raffle Gamma Panou', start: past(600) });
ok(bC.status === 201, 'booking C (no app account)');
r = await req('PATCH', `/admin/clients/${bC.body.clientId}`, { email: `gamma${rnd()}@test.ro` }, at);
ok(r.status === 200, `C email added (${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
let bD = await book({ phone: '0737' + rnd(), name: 'Raffle Delta Fara Email', start: past(1000) });
ok(bD.status === 201, 'booking D (no email)');
let bE = await book({ clientId: E.id, start: past(1200) });
ok(bE.status === 201, 'booking E');
r = await req('PATCH', `/admin/bookings/${bE.body.id}`, { status: 'cancelled' }, at);
ok(r.status === 200, 'E cancelled');
r = await req('PATCH', `/admin/bookings/${bB.body.id}`, { status: 'no_show' }, at);
ok(r.status === 200, 'B marked no-show');

r = await req('GET', '/admin/raffle', null, at);
const names = r.body.participants.map((p) => p.name);
ok(names.filter((n) => n === 'Raffle Alfa Test').length === 1, 'A participates once, not paid');
ok(r.body.participants.find((p) => p.name === 'Raffle Alfa Test')?.visits === 2 && r.body.participants.find((p) => p.name === 'Raffle Alfa Test')?.email.includes('@'), 'A: 2 bookings, email shown');
ok(!names.includes('Raffle Beta Test'), 'B (no-show) does not participate');
ok(names.includes('Raffle Gamma Panou'), 'C (no app account, has phone+email) participates');
ok(!names.includes('Raffle Delta Fara Email'), 'D (no email) does not participate');
ok(r.body.noContact.some((u) => u.name === 'Raffle Delta Fara Email' && !u.email), 'D listed as missing e-mail');
ok(!names.includes('Raffle Epsilon Test'), 'E (cancelled) does not participate');
ok(r.body.current && r.body.left === 2 && r.body.weeks.length === 8, 'current week, 2 left');

// Clientul vede că e înscris.
r = await req('GET', '/me/raffle', null, A.token);
ok(r.body.enabled && r.body.entered === true && r.body.wins.length === 0, 'A sees entered');
r = await req('GET', '/me/raffle', null, Bc.token);
ok(r.body.entered === false, 'B not entered (no-show)');

// Săptămână viitoare / premiu greșit.
const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
r = await req('POST', '/admin/raffle/draw', { week: future }, at);
ok(r.status === 400 && r.body.error === 'raffle_future_week', 'no future week');
r = await req('POST', '/admin/raffle/draw', { prize: 'Mașină' }, at);
ok(r.status === 400 && r.body.error === 'raffle_bad_prize', 'prize must be from list');

// B readus la „confirmată” → intră la loc. Extragem de două ori: câștigători diferiți.
r = await req('PATCH', `/admin/bookings/${bB.body.id}`, { status: 'confirmed' }, at);
r = await req('GET', '/admin/raffle', null, at);
ok(r.body.participants.some((p) => p.name === 'Raffle Beta Test'), 'B participates again after undoing no-show');
const total = r.body.participants.length;
r = await req('POST', '/admin/raffle/draw', { prize: 'Fixativ' }, at);
ok(r.status === 201 && r.body.draw.prize === 'Fixativ' && r.body.draw.entries === total && r.body.participants.length === total, `draw 1 (${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
const w1 = r.body.draw;
r = await req('POST', '/admin/raffle/draw', {}, at);
ok(r.status === 201 && r.body.draw.clientId !== w1.clientId && ['Ceară de păr', 'Fixativ', 'Șampon'].includes(r.body.draw.prize), 'draw 2: other winner, random prize');
const w2 = r.body.draw;
r = await req('POST', '/admin/raffle/draw', {}, at);
ok(r.status === 409 && r.body.error === 'raffle_week_done', 'week limit reached');

// Câștigătorul are beneficiul.
r = await req('GET', `/admin/clients/${w1.clientId}`, null, at);
const bonus = r.body.bonuses.find((b) => b.title === 'Premiu tombolă: Fixativ');
ok(bonus && bonus.status === 'active' && bonus.expiresAt, 'winner got bonus with expiry');
for (const cl of [A, Bc, E]) {
  if (cl.id !== w1.clientId) continue;
  r = await req('GET', '/me/raffle', null, cl.token);
  ok(r.body.wins.length === 1 && r.body.wins[0].prize === 'Fixativ' && r.body.wins[0].status === 'active', 'winner sees win in app');
  r = await req('GET', '/me/referrals', null, cl.token);
  ok(r.body.bonuses.some((b) => b.title === 'Premiu tombolă: Fixativ'), 'win shown in Bonusurile mele');
}
r = await req('GET', '/raffle');
ok(r.body.winners.length >= 2 && r.body.winners.every((w) => !/Test$/.test(w.name)), `public winners shortened (${r.body.winners.map((w) => w.name).join(', ')})`);

// Anularea extragerii 2: premiul se anulează, locul se poate trage din nou.
r = await req('DELETE', `/admin/raffle/draws/${w2.id}`, null, at);
ok(r.status === 200, 'cancel draw');
r = await req('GET', `/admin/clients/${w2.clientId}`, null, at);
ok(!r.body.bonuses.some((b) => b.title.startsWith('Premiu tombolă') && b.status === 'active' && b.createdAt >= w2.drawnAt), 'cancelled prize bonus gone');
r = await req('GET', '/admin/raffle', null, at);
ok(r.body.left === 1 && r.body.draws.find((d) => d.id === w2.id).status === 'cancelled', 'one place free again');
// Premiul folosit nu se mai poate anula.
r = await req('PATCH', `/bonuses/${bonus.id}`.replace('/bonuses', '/admin/bonuses'), { status: 'used' }, at);
ok(r.status === 200, 'prize marked used at the salon');
r = await req('DELETE', `/admin/raffle/draws/${w1.id}`, null, at);
ok(r.status === 409 && r.body.error === 'raffle_prize_used', 'cannot cancel a used prize');

// Pagina publică cu regulamentul.
const page = await fetch('http://127.0.0.1:8787/tombola');
const html = await page.text();
ok(page.status === 200 && html.includes('REGULAMENTUL TOMBOLEI') && html.includes('Ultimii câștigători'), 'public /tombola page');

// Doar proprietarul.
r = await req('GET', '/admin/raffle', null, A.token);
ok(r.status === 401 || r.status === 403, 'client cannot open panel raffle');

// Oprește la loc, ca alte teste să nu fie influențate.
await req('PUT', '/admin/raffle', { enabled: false }, at);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
