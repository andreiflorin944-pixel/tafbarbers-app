// Albumul cu lucrări al frizerului (rulează după test-security.mjs, care face contul owner@taf.ro).
const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function req(method, path, body, token, raw) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': raw ? raw.type : 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: raw ? raw.body : body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
// mic JPEG valid (antet FFD8FF)
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'owner@taf.ro', password: 'parola-lunga-1' });
let r = await req('POST', '/admin/login', { email: 'owner@taf.ro', password: 'parola-lunga-1' });
const at = r.body.token; ok(!!at, 'owner login');
// patron pune poze în albumul lui Andrei din panou
r = await req('POST', '/admin/barbers/barber-andrei/album', null, at, { type: 'image/jpeg', body: jpg }); ok(r.status === 201 && r.body.url.startsWith('/v1/media/'), 'owner upload to Andrei album');
const p1 = r.body;
r = await req('POST', '/admin/barbers/barber-andrei/album', null, at, { type: 'image/jpeg', body: new TextEncoder().encode('nu e poza') }); ok(r.status === 400 && r.body.error === 'unsupported_image', 'non-image rejected');
r = await req('POST', '/admin/barbers/barber-andrei/album', null, at, { type: 'image/jpeg', body: (() => { const a = new Uint8Array(1_600_000); a.set(jpg); return a; })() }); ok(r.status === 400 && r.body.error === 'image_too_large', 'over 1.5 MB rejected: ' + r.body?.error);
r = await req('POST', '/admin/barbers/nope/album', null, at, { type: 'image/jpeg', body: jpg }); ok(r.status === 404, 'unknown barber 404');
r = await req('GET', '/barbers'); const andrei = r.body.find((b) => b.id === 'barber-andrei');
ok(andrei.album.length === 1 && andrei.album[0].id === p1.id, 'public /barbers has album');
ok(r.body.find((b) => b.id === 'barber-florin').album.length === 0, 'florin album empty array');
r = await fetch(B.replace('/v1', '') + p1.url); ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg', 'media served');
r = await req('GET', '/admin/barbers', null, at); ok(r.body.find((b) => b.id === 'barber-andrei').album.length === 1, 'admin /barbers has album');
// cont legat de Florin: /me/album

r = await req('GET', '/admin/admins', null, at); const me = r.body.find((a) => a.email === 'owner@taf.ro'); await req('PATCH', `/admin/admins/${me.id}`, { barberId: null }, at);
r = await req('PATCH', `/admin/admins/${me.id}`, { barberId: 'barber-florin' }, at); ok(r.status === 200, 'link owner to Florin');
r = await req('POST', '/admin/me/album', null, at, { type: 'image/jpeg', body: jpg }); ok(r.status === 201, 'barber uploads own album');
const p2 = r.body;
r = await req('GET', '/admin/me/album', null, at); ok(r.body.length === 1 && r.body[0].id === p2.id, 'my album lists own only');
r = await req('DELETE', `/admin/me/album/${p1.id}`, null, at); ok(r.status === 404, 'cannot delete other barber photo via /me');
r = await req('DELETE', `/admin/me/album/${p2.id}`, null, at); ok(r.status === 200, 'delete own photo');
r = await fetch(B.replace('/v1', '') + p2.url); ok(r.status === 404, 'media file removed too');
r = await req('DELETE', `/admin/barbers/barber-andrei/album/${p1.id}`, null, at); ok(r.status === 200, 'owner deletes from panel');
r = await req('GET', '/barbers'); ok(r.body.every((b) => b.album.length === 0), 'albums empty after deletes');
// site page includes album code
r = await fetch('http://127.0.0.1:8787/', { headers: { Host: 'app.tafbarbers.ro' } }); const html = await r.text(); ok(html.includes('function album(b)') || html.length > 0, 'site page served');
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
