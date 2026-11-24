// Anunțul pe e-mail despre trecerea din Barberly: tranșe zilnice, fără dubluri, în limitele furnizorului.
// Rulează după test-api.mjs, pe `wrangler dev` local (fără cheie de e-mail: trimiterile se scriu în jurnal ca „test-mode”).
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, body: j, text };
}

let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
ok(r.status === 200, 'admin login');
const at = r.body.token;

// Clienți importați din Barberly: 6 cu e-mail (unul scris de două ori, cu majuscule), unul fără.
const rows = [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Anunt Client${i}`, phone: `07299900${String(i).padStart(2, '0')}`, email: `anunt${i}@exemplu.ro` }));
rows.push({ name: 'Anunt Dublu', phone: '0729990099', email: 'ANUNT1@exemplu.ro' });
rows.push({ name: 'Fara Email', phone: '0729990098' });
r = await req('POST', '/admin/clients/import', { rows }, at);
ok(r.status === 200, `clients imported ${JSON.stringify(r.body)}`);

r = await req('GET', '/admin/announce', null, at);
ok(r.status === 200 && r.body.settings.enabled === false, 'off by default');
const pending0 = r.body.pending;
ok(pending0 >= 6, `pending counts each e-mail once (${pending0})`);

r = await req('POST', '/admin/announce/run', {}, at);
ok(r.body.justSent === 0 && r.body.reason === 'off', 'nothing sent while off');

r = await req('GET', '/admin/announce/preview', null, at);
ok(r.status === 200 && r.text.includes('Avem aplicația noastră TAF Barbers') && r.text.includes('We have our own TAF Barbers app') && r.text.includes('apps.apple.com'), 'preview RO + EN with store links');

r = await req('POST', '/admin/announce/test', { email: 'nu-e-email' }, at);
ok(r.status === 400, 'test needs a valid e-mail');
r = await req('POST', '/admin/announce/test', { email: 'florin@exemplu.ro' }, at);
ok(r.status === 200 && r.body.ok, 'test e-mail sent');
r = await req('GET', '/admin/announce', null, at);
ok(r.body.sent === 0 && r.body.pending === pending0, 'test does not count as announcement');

r = await req('PUT', '/admin/announce', { enabled: true, dailyLimit: 3 }, at);
ok(r.body.settings.enabled && r.body.settings.dailyLimit === 3, 'enabled, 3 per day');
r = await req('POST', '/admin/announce/run', {}, at);
ok(r.body.justSent === 3 && r.body.today.announce === 3, `first batch of 3 (${r.body.justSent})`);
r = await req('POST', '/admin/announce/run', {}, at);
ok(r.body.justSent === 0 && r.body.reason === 'limit', 'daily limit reached, nothing more today');
ok(r.body.pending === pending0 - 3, 'pending went down by 3');

// Limita furnizorului (toate e-mailurile zilei) oprește și ea tranșa.
r = await req('PUT', '/admin/announce', { dailyLimit: 1000, providerDaily: 10, reserve: 15 }, at);
r = await req('POST', '/admin/announce/run', {}, at);
ok(r.body.justSent === 0 && r.body.today.room === 0, 'provider daily limit (with reserve) respected');

// Cu limite mari se termină lista, fără să trimită cuiva de două ori, apoi se oprește singur.
r = await req('PUT', '/admin/announce', { providerDaily: 100000, providerMonthly: 1000000, reserve: 0 }, at);
for (let i = 0; i < 10 && r.body.settings.enabled; i++) r = await req('POST', '/admin/announce/run', {}, at);
r = await req('GET', '/admin/announce', null, at);
ok(r.body.pending === 0 && r.body.sent === pending0, `everyone got it exactly once (${r.body.sent}/${pending0})`);
ok(r.body.settings.enabled === false, 'switched itself off when the list was done');
r = await req('PUT', '/admin/announce', { enabled: true }, at);
r = await req('POST', '/admin/announce/run', {}, at);
ok(r.body.justSent === 0 && r.body.sent === pending0, 'running again sends nothing');
// Mementourile programate (1 dec, 9 dec, 7 ian): pornite implicit, nu pleacă înainte de ziua lor.
r = await req('GET', '/admin/announce', null, at);
ok(r.body.waves?.length === 3 && r.body.waves.every((w) => w.enabled && !w.doneAt && w.sent === 0), 'three scheduled reminders, on, nothing sent');
const early = r.body.waves.filter((w) => w.day > r.body.localDay);
r = await req('POST', '/admin/announce/run', {}, at);
r = await req('GET', '/admin/announce', null, at);
ok(early.every((e) => r.body.waves.find((w) => w.id === e.id).sent === 0), 'reminders wait for their day');
r = await req('GET', '/admin/announce/preview?wave=announce-dec1', null, at);
ok(r.status === 200 && r.text.includes('La mulți ani') && r.text.includes('Trimite codul prin SMS') && r.text.includes('apps.apple.com'), 'preview 1 Dec: greeting, e-mail then SMS, store links');
r = await req('GET', '/admin/announce/preview?wave=announce-jan7', null, at);
ok(r.status === 200 && r.text.includes('11 ianuarie') && r.text.includes('11 January'), 'preview 7 Jan RO + EN');
r = await req('POST', '/admin/announce/test', { email: 'florin@exemplu.ro', wave: 'announce-dec9' }, at);
ok(r.status === 200 && r.body.ok, 'test e-mail for a reminder');
r = await req('PUT', '/admin/announce', { waves: { 'announce-dec9': false } }, at);
ok(r.body.settings.waves['announce-dec9'] === false && r.body.settings.waves['announce-dec1'] === true, 'one reminder switched off, others stay on');
await req('PUT', '/admin/announce', { waves: { 'announce-dec9': true } }, at);
await req('PUT', '/admin/announce', { enabled: false, dailyLimit: 80, providerDaily: 100, providerMonthly: 3000, reserve: 15 }, at);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
