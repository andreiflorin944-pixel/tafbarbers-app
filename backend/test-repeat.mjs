// Programări repetate (în fiecare săptămână / la 2 săptămâni, aceeași zi și oră) din panou, plus „Anulează și repetările următoare”.
// Rulează după test-api.mjs (folosește contul de proprietar creat acolo), pe `wrangler dev` local.
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const WEEK = 7 * 86_400_000;
const localHM = (iso) => new Date(iso).toLocaleTimeString('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' });
const localWD = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'Europe/Bucharest', weekday: 'short' });

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;
r = await req('GET', '/barbers');
const barberId = r.body[0].id;
const SVC = 'svc-classic';

// O oră liberă peste câteva zile (ziua aleasă la întâmplare, ca rulările repetate să nu se calce).
let pick = null;
for (let i = 3 + Math.floor(Math.random() * 20); i < 60 && !pick; i++) {
  const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
  r = await req('GET', `/availability?serviceId=${SVC}&barberId=${barberId}&day=${d}`);
  if (r.status === 200 && r.body.length > 3) pick = r.body[Math.floor(r.body.length / 2)];
}
ok(!!pick, 'found a free time');
const phone = '0737' + rnd();
r = await req('POST', '/admin/bookings', { phone, name: 'Client Repetat', serviceId: SVC, barberId, start: pick.start, note: 'Ca de obicei', notify: false }, at);
ok(r.status === 201, `booking created ${r.status}`);
const src = r.body;

// Ocupăm ora de peste 2 săptămâni cu alt client: data aceea trebuie sărită.
const busyStart = new Date(Date.parse(src.start) + 2 * WEEK).toISOString().replace(/\.\d{3}Z$/, 'Z');
r = await req('POST', '/admin/bookings', { phone: '0738' + rnd(), name: 'Alt Client', serviceId: SVC, barberId, start: busyStart, force: true, notify: false }, at);
const other = r.body;
ok(r.status === 201, `other booking two weeks later ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);

r = await req('POST', `/admin/bookings/${src.id}/repeat`, { everyWeeks: 1, count: 4, dryRun: true }, at);
ok(r.status === 200 && r.body.dryRun && r.body.items.length === 4, `dry run lists 4 dates ${r.status}`);
ok(r.body.items[1].ok === false && r.body.items[1].reason === 'busy' && r.body.items[1].detail === 'Alt Client', 'busy date is reported with the other client');
ok(r.body.items.every((x) => localHM(x.start) === localHM(src.start) && localWD(x.start) === localWD(src.start)), 'same weekday and same local time (also across DST)');
r = await req('GET', `/admin/bookings?from=${encodeURIComponent(src.start)}&to=${encodeURIComponent(new Date(Date.parse(src.start) + 5 * WEEK).toISOString())}`, null, at);
ok(r.body.filter((b) => b.clientId === src.clientId).length === 1, 'dry run wrote nothing');

r = await req('POST', `/admin/bookings/${src.id}/repeat`, { everyWeeks: 1, count: 4 }, at);
ok(r.status === 200 && r.body.created === 3 && r.body.skipped === 1, `3 created, 1 skipped (${r.body?.created}/${r.body?.skipped})`);
const made = r.body.items.filter((x) => x.ok);
r = await req('GET', `/admin/bookings?from=${encodeURIComponent(src.start)}&to=${encodeURIComponent(new Date(Date.parse(src.start) + 5 * WEEK).toISOString())}`, null, at);
const mine = r.body.filter((b) => b.clientId === src.clientId);
ok(mine.length === 4, `client has 4 bookings now (${mine.length})`);
ok(mine.every((b) => b.seriesId === src.id), 'all in the same series');
ok(mine.every((b) => b.serviceId === SVC && b.barberId === barberId && b.status === 'confirmed' && b.note === 'Ca de obicei'), 'same service, barber, note; confirmed');
ok(mine.every((b) => b.price === src.price), 'same price');

// La 2 săptămâni, până la o dată.
r = await req('POST', `/admin/bookings/${src.id}/repeat`, { everyWeeks: 2, until: new Date(Date.parse(src.start) + 6 * WEEK + 3600_000).toISOString().slice(0, 10), dryRun: true }, at);
ok(r.status === 200 && r.body.items.length === 3, `every 2 weeks until a date: 3 dates (${r.body?.items?.length})`);
ok(!r.body.items[0].ok && !r.body.items[1].ok && r.body.items[2].ok, 'weeks 2 and 4 taken (other client, the series), week 6 free');

// Date greșite.
r = await req('POST', `/admin/bookings/${src.id}/repeat`, { everyWeeks: 5, count: 2 }, at);
ok(r.status === 400, 'interval 5 weeks refused');
r = await req('POST', `/admin/bookings/${src.id}/repeat`, { everyWeeks: 1, count: 99 }, at);
ok(r.status === 400, 'too many repeats refused');
r = await req('POST', `/admin/bookings/${src.id}/repeat`, { everyWeeks: 1, until: '2000-01-01' }, at);
ok(r.status === 400, 'until in the past refused');

// Jurnalul programării de pornire.
r = await req('GET', `/admin/bookings/${src.id}/activity`, null, at);
ok(r.body.log?.some((e) => e.kind === 'repeated' && e.detail?.created === 3), 'activity log has the repeat entry');

// Anulează a doua din serie și pe cele de după: prima rămâne.
r = await req('POST', `/admin/bookings/${made[0].id}/cancel-series`, {}, at);
ok(r.status === 200 && r.body.cancelled === 3 && r.body.booking.status === 'cancelled', `cancel this and following: 3 (${r.body?.cancelled})`);
r = await req('GET', `/admin/bookings?from=${encodeURIComponent(src.start)}&to=${encodeURIComponent(new Date(Date.parse(src.start) + 5 * WEEK).toISOString())}`, null, at);
const after = r.body.filter((b) => b.clientId === src.clientId);
ok(after.find((b) => b.id === src.id)?.status === 'confirmed', 'first booking stays');
ok(after.filter((b) => b.status === 'cancelled').length === 3, 'the rest are cancelled');
ok(r.body.find((b) => b.id === other.id)?.status === 'confirmed', 'other client untouched');
r = await req('POST', `/admin/bookings/${other.id}/cancel-series`, {}, at);
ok(r.status === 404, 'not in a series: 404');

// Curățenie.
await req('PATCH', `/admin/bookings/${src.id}`, { status: 'cancelled' }, at);
await req('PATCH', `/admin/bookings/${other.id}`, { status: 'cancelled' }, at);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
