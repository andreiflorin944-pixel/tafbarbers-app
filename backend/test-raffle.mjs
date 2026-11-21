// Tombola săptămânală: participă doar clienții cu cont și tunsoare ÎNCHEIATĂ în săptămână; extragerea dă premiul ca beneficiu.
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

// Clienți: A tuns și închis; B tuns dar neînchis; C fără cont (doar în panou), tuns și închis.
const A = await register('Raffle Alfa Test');
const Bc = await register('Raffle Beta Test');
const barbers = (await req('GET', '/barbers')).body;
const barberId = barbers[0].id;
// Ora: acum minus 30–90 de minute, rotunjită (programare în trecut, din panou, cu „force”).
const past = (min) => { const d = new Date(Date.now() - min * 60_000); d.setUTCSeconds(0, 0); d.setUTCMinutes(d.getUTCMinutes() - (d.getUTCMinutes() % 5)); return d.toISOString().replace('.000Z', 'Z'); };
const book = async (body) => req('POST', '/admin/bookings', { serviceId: 'svc-classic', barberId, force: true, notify: false, ...body }, at);
let bA = await book({ clientId: A.id, start: past(200) });
ok(bA.status === 201, `booking A (${bA.status} ${JSON.stringify(bA.body).slice(0, 80)})`);
let bB = await book({ clientId: Bc.id, start: past(400) });
ok(bB.status === 201, 'booking B');
const cPhone = '0739' + rnd();
let bC = await book({ phone: cPhone, name: 'Raffle Gamma Panou', start: past(600) });
ok(bC.status === 201, 'booking C (no app account)');
r = await req('POST', `/admin/bookings/${bA.body.id}/complete`, { payment: 'paid', payMethod: 'cash' }, at);
ok(r.status === 200 && r.body.status === 'completed', 'A completed');
r = await req('POST', `/admin/bookings/${bC.body.id}/complete`, { payment: 'paid', payMethod: 'cash' }, at);
ok(r.status === 200, 'C completed');

r = await req('GET', '/admin/raffle', null, at);
const names = r.body.participants.map((p) => p.name);
ok(names.includes('Raffle Alfa Test'), 'A participates');
ok(!names.includes('Raffle Beta Test'), 'B (not closed) does not participate');
ok(!names.includes('Raffle Gamma Panou'), 'C (no app account) does not participate');
ok(r.body.unclosed.some((u) => u.id === bB.body.id && u.hasAccount), 'B listed as unclosed, with account');
ok(r.body.current && r.body.left === 2 && r.body.weeks.length === 8, 'current week, 2 left');

// Clientul vede că e înscris.
r = await req('GET', '/me/raffle', null, A.token);
ok(r.body.enabled && r.body.entered === true && r.body.wins.length === 0, 'A sees entered');
r = await req('GET', '/me/raffle', null, Bc.token);
ok(r.body.entered === false, 'B not entered yet');

// Săptămână viitoare / premiu greșit.
const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
r = await req('POST', '/admin/raffle/draw', { week: future }, at);
ok(r.status === 400 && r.body.error === 'raffle_future_week', 'no future week');
r = await req('POST', '/admin/raffle/draw', { prize: 'Mașină' }, at);
ok(r.status === 400 && r.body.error === 'raffle_bad_prize', 'prize must be from list');

// B închis acum → intră. Extragem de două ori: câștigători diferiți.
r = await req('POST', `/admin/bookings/${bB.body.id}/complete`, { payment: 'paid', payMethod: 'cash' }, at);
r = await req('GET', '/admin/raffle', null, at);
ok(r.body.participants.some((p) => p.name === 'Raffle Beta Test'), 'B participates after closing');
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
for (const cl of [A, Bc]) {
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
