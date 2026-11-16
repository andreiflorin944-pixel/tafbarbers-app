// Calendarul invers (programările noastre → Barberly), cu un server Barberly de probă pe portul 8799.
// Rulează după test-api.mjs, pe `wrangler dev` local pornit cu BARBERLY_API_BASE=http://127.0.0.1:8799 în .dev.vars.
import http from 'node:http';

const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

// --- Barberly de probă ---
const KEY = 'bk_test_cheie_de_proba_123';
const LOC = '11111111-1111-1111-1111-111111111111';
const calls = [];
let n = 0;
const server = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (d) => (raw += d));
  q.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: q.method, url: q.url, body });
    const send = (code, j) => { s.writeHead(code, { 'Content-Type': 'application/json' }); s.end(j === undefined ? '' : JSON.stringify(j)); };
    if (q.headers['x-api-key'] !== KEY) return send(401, { title: 'Unauthorized' });
    if (q.method === 'GET' && q.url === '/v1/locations') return send(200, [{ id: LOC, name: 'TAF Barbers Iasi' }]);
    if (q.method === 'POST' && q.url === `/v1/locations/${LOC}/team-members`) return send(200, [{ id: 'tm-florin', firstName: 'Florin', lastName: 'T' }, { id: 'tm-andrei', firstName: 'Andrei', lastName: null }]);
    if (q.method === 'POST' && q.url === `/v1/locations/${LOC}/services`) return send(200, [{ id: null, name: 'Toate', services: [{ id: 'bs-beard', name: 'Barbă', duration: 30 }, { id: 'bs-other', name: 'Altceva', duration: 45 }] }]);
    if (q.method === 'POST' && q.url === '/v1/bookings') return send(201, { id: `bb-${++n}`, status: 'Confirmed' });
    if (q.method === 'PUT' && q.url.startsWith('/v1/bookings/')) return send(200, { id: q.url.split('/')[3], status: 'Confirmed' });
    if (q.method === 'POST' && /\/v1\/bookings\/[^/]+\/cancel$/.test(q.url)) return send(204);
    send(404, { title: 'Not found' });
  });
});
await new Promise((r) => server.listen(8799, '127.0.0.1', r));

try {
  let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
  ok(r.status === 200, 'admin login');
  const at = r.body.token;

  r = await req('PUT', '/admin/barberly/push', { key: 'bk_greșită_1234567' }, at);
  ok(r.status === 400 && r.body.error === 'barberly_key_rejected', 'wrong key rejected before saving');
  r = await req('PUT', '/admin/barberly/push', { key: KEY }, at);
  ok(r.status === 200 && r.body.hasKey && r.body.keyHint === KEY.slice(-4) && r.body.locationId === LOC, 'key saved, location picked');
  ok(r.body.barberMap['barber-florin'] === 'tm-florin' && r.body.barberMap['barber-andrei'] === 'tm-andrei', 'barbers matched by first name');
  ok(r.body.serviceMap['svc-beard'] === 'bs-beard' || Object.values(r.body.serviceMap).includes('bs-beard'), `services matched ${JSON.stringify(r.body.serviceMap)}`);
  r = await req('PUT', '/admin/barberly/push', { enabled: true }, at);
  ok(r.status === 400 && r.body.error === 'barberly_push_incomplete', 'cannot enable without salon phone');
  r = await req('PUT', '/admin/barberly/push', { phone: '0747 857 517', enabled: true }, at);
  ok(r.status === 200 && r.body.enabled && r.body.phone === '+40747857517', 'enabled with salon phone');

  // O programare nouă la noi → apare în Barberly.
  const day = new Date(Date.now() + 5 * 864e5);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  const start = `${day.toISOString().slice(0, 10)}T09:00:00Z`; // 11:00 sau 12:00 la București
  r = await req('POST', '/admin/bookings', { phone: '0722000999', name: 'Ion Sincron', serviceId: 'svc-beard', barberId: 'barber-andrei', start, force: true, notify: false }, at);
  ok(r.status === 201, 'booking created at us');
  const bk = r.body;
  calls.length = 0;
  r = await req('POST', '/admin/barberly/push/run', {}, at);
  ok(r.status === 200 && r.body.sent >= 1 && r.body.errors === 0, `run: ${JSON.stringify(r.body)}`);
  const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/bookings' && c.body.note.includes('Ion Sincron'));
  ok(!!post, 'POST /v1/bookings sent');
  ok(post && post.body.teamMemberId === 'tm-andrei' && post.body.locationId === LOC && post.body.customer.phoneNumber === '+40747857517', 'right barber, location, salon phone as customer');
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(start)).split(':');
  ok(post && post.body.timeSlot.date === start.slice(0, 10) && post.body.timeSlot.startMinutesOfDay === +local[0] * 60 + +local[1], `local wall time ${JSON.stringify(post?.body.timeSlot)}`);
  ok(post && post.body.timeSlot.durationMinutes === Math.round((Date.parse(bk.end) - Date.parse(bk.start)) / 60000), 'duration from our booking');
  ok(post && !JSON.stringify(post.body).includes('0722000999'), 'client phone not sent to Barberly');

  // A doua rulare: nimic nou.
  calls.length = 0;
  r = await req('POST', '/admin/barberly/push/run', {}, at);
  ok(r.body.sent === 0 && r.body.moved === 0 && !calls.some((c) => c.url.startsWith('/v1/bookings')), 'second run sends nothing');

  // Mutată la noi → mutată în Barberly (PUT pe același id).
  const later = new Date(Date.parse(start) + 3600_000).toISOString();
  r = await req('PATCH', `/admin/bookings/${bk.id}`, { start: later, force: true, notify: false }, at);
  ok(r.status === 200, 'moved at us');
  calls.length = 0;
  r = await req('POST', '/admin/barberly/push/run', {}, at);
  const put = calls.find((c) => c.method === 'PUT');
  ok(r.body.moved === 1 && put && /^\/v1\/bookings\/bb-\d+$/.test(put.url), `moved in Barberly ${put?.url}`);

  // E-mailul Barberly pentru programarea trimisă de noi (client = numărul salonului) nu se copiază înapoi.
  r = await req('POST', '/admin/barberly/paste', { subject: 'Numire nouă: Aplicatia TAF', text: `Numire nouă: Aplicatia TAF\nCLIENT\nAplicatia TAF\n+40747857517\nCÂND\n${later.slice(0, 10)} 12:00\nSERVICII\nBarbă\nCU\nAndrei` }, at);
  ok(r.status === 200 && r.body.result === 'ignored', `own booking e-mail ignored (${r.body?.result}: ${r.body?.detail})`);

  // Anulată la noi → anulată în Barberly.
  r = await req('PATCH', `/admin/bookings/${bk.id}`, { status: 'cancelled' }, at);
  ok(r.body.status === 'cancelled', 'cancelled at us');
  calls.length = 0;
  r = await req('POST', '/admin/barberly/push/run', {}, at);
  ok(r.body.cancelled === 1 && calls.some((c) => c.method === 'POST' && /\/cancel$/.test(c.url)), 'cancelled in Barberly');

  r = await req('GET', '/admin/barberly/push', null, at);
  ok(r.body.log.some((e) => e.bookingId === bk.id && e.state === 'cancelled'), 'panel log shows it');
  ok(!JSON.stringify(r.body).includes(KEY), 'key never returned to the panel');

  r = await req('PUT', '/admin/barberly/push', { key: null }, at);
  ok(r.body.hasKey === false && r.body.enabled === false, 'key removed, push off');
} finally {
  server.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
