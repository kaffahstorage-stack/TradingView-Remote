import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`), {denylist:[/\/__\/auth/]}));
self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(self.registration.scope);
    const requestId = event.notification.data?.requestId;
    if (typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)) target.searchParams.set('request', requestId);
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing = windows.find(client => new URL(client.url).origin === target.origin && new URL(client.url).pathname.startsWith(target.pathname));
    if(existing) {await existing.navigate(target.href); await existing.focus();}
    else await self.clients.openWindow(target.href);
  })());
});
// FCM is intentionally not configured. Notifications are initiated by the open app.
