const B = 'http://127.0.0.1:8787/v1';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
async function req(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
let r = await req('POST', '/admin/setup', { setupKey: 'local-setup-key-123', email: 'f@t.ro', password: 'parola-test-123', name: 'Florin' });
const adm = r.body.token; ok(!!adm, 'admin setup');
async function client(phone, name) {
  const o = await req('POST', '/auth/otp', { phone });
  const v = await req('POST', '/auth/verify', { phone, code: o.body.devCode, name, lang: 'ro', acceptTerms: true });
  return v.body.token;
}
const c1 = await client('0712000001', 'Ana'), c2 = await client('0712000002', 'Bogdan');
r = await req('POST', '/admin/products', { name: 'Ceară de păr', price: 45, stock: 2 }, adm); ok(r.status === 201 && r.body.stock === 2, 'product created');
const wax = r.body;
r = await req('POST', '/admin/products', { name: 'Ulei de barbă', price: 60.5, stock: null }, adm); const oil = r.body; ok(r.status === 201 && oil.price === 60.5, 'unlimited product');
r = await req('POST', '/admin/products', { name: 'Ascuns', price: 10, active: false }, adm); const hidden = r.body;
r = await req('POST', '/admin/products', { name: 'x', price: -1 }, adm); ok(r.status === 400, 'negative price rejected');
r = await req('GET', '/products'); ok(r.body.length === 2, 'public lists only active');
r = await req('POST', '/orders', { items: [{ productId: wax.id, qty: 1 }] }); ok(r.status === 401, 'order needs login');
r = await req('POST', '/orders', { items: [{ productId: hidden.id, qty: 1 }] }, c1); ok(r.status === 409 && r.body.error === 'product_unavailable', 'hidden product rejected');
r = await req('POST', '/orders', { items: [{ productId: wax.id, qty: 3 }] }, c1); ok(r.status === 409 && r.body.error === 'out_of_stock', `over stock rejected ${JSON.stringify(r.body)}`);
r = await req('GET', '/products'); ok(r.body.find(p => p.id === wax.id).stock === 2, 'stock unchanged after failed order');
r = await req('POST', '/orders', { items: [{ productId: wax.id, qty: 1 }, { productId: oil.id, qty: 2 }], note: 'vin mâine' }, c1);
ok(r.status === 201 && r.body.total === 166 && r.body.items.length === 2 && r.body.code.length === 5 && !('clientPhone' in r.body), `order total ${r.body?.total}`);
const o1 = r.body;
r = await req('POST', '/orders', { items: [{ productId: wax.id, qty: 1 }, { productId: oil.id, qty: 1 }] }, c2); const o2 = r.body; ok(r.status === 201, 'second client order');
r = await req('POST', '/orders', { items: [{ productId: wax.id, qty: 1 }] }, c2); ok(r.status === 409 && r.body.error === 'out_of_stock', 'stock exhausted');
r = await req('GET', '/products'); ok(r.body.find(p => p.id === wax.id).stock === 0 && r.body.find(p => p.id === oil.id).stock === null, 'stock 0, unlimited stays null');
r = await req('POST', `/orders/${o1.id}/cancel`, null, c2); ok(r.status === 404, 'cannot cancel other client order');
r = await req('POST', `/orders/${o2.id}/cancel`, null, c2); ok(r.status === 200 && r.body.status === 'cancelled', 'client cancels');
r = await req('GET', '/products'); ok(r.body.find(p => p.id === wax.id).stock === 1, 'stock restored on cancel');
r = await req('POST', `/orders/${o2.id}/cancel`, null, c2); ok(r.status === 409, 'double cancel rejected');
r = await req('GET', '/products'); ok(r.body.find(p => p.id === wax.id).stock === 1, 'no double restore');
r = await req('GET', '/admin/orders?status=open', null, adm); ok(r.body.length === 1 && r.body[0].clientName === 'Ana' && r.body[0].clientPhone === '+40712000001', 'admin open orders');
r = await req('PATCH', `/admin/orders/${o1.id}`, { status: 'ready' }, adm); ok(r.status === 200 && r.body.status === 'ready', 'marked ready');
r = await req('GET', '/admin/messages', null, adm);
ok(JSON.stringify(r.body).includes('order_ready'), 'order_ready SMS logged');
r = await req('POST', `/orders/${o1.id}/cancel`, null, c1); ok(r.status === 409, 'client cannot cancel once ready');
r = await req('PATCH', `/admin/orders/${o1.id}`, { status: 'ready' }, adm); ok(r.status === 409, 'ready twice rejected');
r = await req('PATCH', `/admin/orders/${o1.id}`, { status: 'picked_up' }, adm); ok(r.body.status === 'picked_up', 'picked up');
r = await req('PATCH', `/admin/orders/${o1.id}`, { status: 'cancelled' }, adm); ok(r.status === 409, 'cannot cancel picked up');
r = await req('GET', '/me/orders', null, c1); ok(r.body.length === 1 && r.body[0].status === 'picked_up', 'my orders');
// frizer fără dreptul „shop”
r = await req('POST', '/admin/admins', { name: 'Andrei', email: 'a@t.ro', password: 'parola-andrei-1', barberId: 'barber-andrei' }, adm);
const l = await req('POST', '/admin/login', { email: 'a@t.ro', password: 'parola-andrei-1' });
r = await req('GET', '/admin/orders', null, l.body.token); ok(r.status === 403, `barber without shop perm -> ${r.status}`);
r = await req('POST', '/admin/products', { name: 'y', price: 1 }, l.body.token); ok(r.status === 403, 'barber cannot add product');
// GDPR: ștergerea contului anulează comanda deschisă
r = await req('POST', '/orders', { items: [{ productId: wax.id, qty: 1 }] }, c2); ok(r.status === 201, 'order before delete');
r = await req('GET', '/me/export', null, c2); ok(r.body.orders?.length === 2, 'export includes orders');
r = await req('DELETE', '/me', null, c2); ok(r.status === 200, 'account deleted');
r = await req('GET', '/products'); ok(r.body.find(p => p.id === wax.id).stock === 1, 'delete cancelled open order, stock back');
r = await req('DELETE', `/admin/products/${wax.id}`, null, adm); ok(r.body.deactivated === true, 'used product only hidden');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
