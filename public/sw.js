// App shell for offline launch plus notification clicks. Catalog requests
// (/api/*) always go to the network: the panel shows its own stale-data state.
const CACHE = 'sismos-shell-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Network first so each deploy is picked up immediately; cache only as offline fallback.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(request, { ignoreSearch: true }))
    || (request.mode === 'navigate' && await caches.match('/'))
    || Response.error()));
});

// Web Push from api/push-check.js. Same tag as the panel's local notification for the record.
self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch { /* Not JSON: show the generic title. */ }
  event.waitUntil(self.registration.showNotification(message.title || 'Nuevo registro sísmico', {
    body: message.body, tag: message.tag, data: { id: message.id }, icon: '/icon-192.png', lang: 'es',
  }));
});

// The browser rotated the subscription: move the stored filters to the new one.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    let subscription = event.newSubscription;
    if (!subscription) {
      const { publicKey } = await (await fetch('/api/push', { cache: 'no-store' })).json();
      if (!publicKey) return;
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription, oldEndpoint: old?.endpoint }) });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.id;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(item => new URL(item.url).origin === location.origin);
    if (!client) return self.clients.openWindow('/');
    await client.focus();
    if (id) client.postMessage({ type: 'select-event', id });
  })());
});
