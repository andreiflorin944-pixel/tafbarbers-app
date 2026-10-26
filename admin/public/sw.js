// Service worker-ul panoului: face panoul instalabil ca aplicație pe Windows și Mac.
// Nu păstrează date: totul vine mereu de pe server, iar fără internet arată o pagină scurtă.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAF Panou</title>' +
            '<body style="background:#000;color:#fff;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
            '<div><h2>Nu ești conectat la internet</h2><p>Panoul se deschide imediat ce revine conexiunea.</p>' +
            '<button onclick="location.reload()" style="padding:10px 18px;border-radius:10px;border:0;background:#F5C542;font-weight:700">Încearcă din nou</button></div>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});
