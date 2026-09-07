// Caching only. No `push` handler and no `notificationclick` handler: that is PR 5's
// job. Apple silently revokes a push subscription that was registered by a service
// worker without both handlers wired up, so neither gets added ahead of that PR.
const CACHE_NAME = "house-v1";
const APP_SHELL = ["/house/", "/house/index.html", "/house/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
