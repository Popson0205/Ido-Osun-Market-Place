// Network-first for pages and assets, cached copy only when offline. API and photos are never cached here.
const C = 'iom-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api') || u.pathname.startsWith('/img')) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || caches.match('/'))));
});
