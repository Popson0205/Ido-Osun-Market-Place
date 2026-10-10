// Service worker: installable app, offline browsing of recently viewed pages, and vendor order notifications.
// Public catalogue data and photos are cached; accounts, orders and vendor/admin data are never cached here.
const VER = 'iom-v3', SHELL = VER + '-shell', API = VER + '-api', IMG = VER + '-img';
const PRECACHE = ['/', '/offline.html', '/manifest.webmanifest', '/icon-192.png'];
const PUBLIC_API = /^\/api\/(products|stores)(\/\d+)?$|^\/api\/config$/;
const trim = async (name, max) => { const c = await caches.open(name), k = await c.keys(); for (let i = 0; i < k.length - max; i++) await c.delete(k[i]); };

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, API, IMG].includes(k)).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;

  if (u.pathname.startsWith('/img/')) {            // photos: cache first (the URL changes when a photo changes)
    e.respondWith(caches.open(IMG).then(async c => {
      const m = await c.match(r); if (m) return m;
      try { const res = await fetch(r); if (res.ok) { await c.put(r, res.clone()); trim(IMG, 200); } return res; }
      catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  if (PUBLIC_API.test(u.pathname)) {               // catalogue data: network first, saved copy when offline
    e.respondWith(fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(API).then(c => c.put(r, cp)).then(() => trim(API, 80)); }
      return res;
    }).catch(() => caches.match(r, { cacheName: API }).then(m => m || new Response(
      JSON.stringify({ error: 'You are offline and this page was not saved. Reconnect and try again.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  if (u.pathname.startsWith('/api') || u.pathname === '/admin' || u.pathname === '/admin.html') return;   // admin is never cached       // everything else under /api goes straight to the network

  e.respondWith(fetch(r).then(res => {             // app pages and files: network first, saved copy when offline
    if (res.ok) { const cp = res.clone(); caches.open(SHELL).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('/offline.html') : Response.error()))));
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Ido-Osun Market', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) { if (w.navigate) w.navigate(url); return w.focus(); } }
    return clients.openWindow(url);
  }));
});
