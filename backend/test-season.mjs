// Campania de sezon: setări, perioada, bannerul de pe Acasă, textele de pe ecranul cardului cadou, pop-up-ul.
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
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;

r = await req('GET', '/admin/season-campaign', null, at);
ok(r.status === 200 && r.body.enabled === false && r.body.theme === 'christmas' && r.body.target === 'gift_card' && r.body.popup === true, 'off by default, Crăciun → card cadou, cu pop-up');
const v0 = r.body.version;
r = await req('GET', '/promos'); ok(!r.body.some((p) => p.id.startsWith('season-')), 'no banner while off');

r = await req('PUT', '/admin/season-campaign', { enabled: true, startsAt: day(-1), endsAt: day(-2) }, at); ok(r.status === 400 && r.body.error === 'invalid_dates', 'end before start refused');
r = await req('PUT', '/admin/season-campaign', { theme: 'halloween' }, at); ok(r.status === 400, 'unknown theme refused');
r = await req('PUT', '/admin/season-campaign', { target: 'nope' }, at); ok(r.status === 400, 'unknown target refused');
r = await req('PUT', '/admin/season-campaign', { title: { ro: '' } }, at); ok(r.status === 400, 'empty title refused');
r = await req('PUT', '/admin/season-campaign', { imageUrl: 'javascript:alert(1)' }, at); ok(r.status === 400, 'bad image url refused');

// Programată în viitor: încă nu se vede.
r = await req('PUT', '/admin/season-campaign', { enabled: true, startsAt: day(3), endsAt: day(10) }, at);
ok(r.status === 200 && r.body.enabled && r.body.version > v0, 'saved, new version');
r = await req('GET', '/promos'); ok(!r.body.some((p) => p.id.startsWith('season-')), 'not visible before start');

// În desfășurare: primul banner, cu pop-up, deschide cardul cadou.
r = await req('PUT', '/admin/season-campaign', { startsAt: day(-1), endsAt: day(5) }, at);
const ver = r.body.version;
r = await req('GET', '/promos?lang=ro');
const p = r.body[0];
ok(p && p.id === `season-${ver}` && p.action.type === 'gift_card' && p.popup === true && p.title === 'Fă cadou o tunsoare de Crăciun' && p.imageUrl === '/campanii/craciun.jpg', `first banner is the season (${JSON.stringify(p).slice(0, 120)})`);
r = await req('GET', '/promos?lang=en'); ok(r.body[0].title === 'Give a haircut for Christmas', 'english texts');

// Ecranul cardului cadou: titlul campaniei și urarea.
const phone = '0734' + rnd();
const email = `sezon${rnd()}@test.ro`;
const ip = { 'CF-Connecting-IP': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
r = await req('POST', '/auth/otp', { phone, email, channel: 'email' }, null, ip);
r = await req('POST', '/auth/verify', { phone, code: r.body?.devCode, name: 'Client Sezon', email, acceptTerms: true }, null, ip);
const tok = r.body.token;
r = await req('GET', '/me/gift-cards?lang=ro', null, tok);
ok(r.status === 200 && r.body.season && r.body.season.wish === 'Crăciun fericit! 🎄' && r.body.season.kicker === 'CADOU DE CRĂCIUN', 'gift card screen gets the season texts');

// Butonul duce la programare: bannerul rămâne, ecranul cardului cadou nu mai are campania.
r = await req('PUT', '/admin/season-campaign', { target: 'book', popup: false }, at);
r = await req('GET', '/promos'); ok(r.body[0].action.type === 'book' && r.body[0].popup === false, 'target book, no popup');
r = await req('GET', '/me/gift-cards', null, tok); ok(r.body.season === null, 'no season on gift card screen when target is not gift card');

// Încheiată: dispare singură.
r = await req('PUT', '/admin/season-campaign', { startsAt: day(-10), endsAt: day(-1) }, at);
r = await req('GET', '/promos'); ok(!r.body.some((p) => p.id.startsWith('season-')), 'gone after the end day');

r = await req('PUT', '/admin/season-campaign', { enabled: false, target: 'gift_card', popup: true, startsAt: '', endsAt: '' }, at); ok(r.status === 200 && !r.body.enabled, 'turned off again');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
