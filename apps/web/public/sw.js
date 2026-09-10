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

// Same-origin GETs only, and nothing else.
//
// `clients.claim()` above means this worker controls the page from its first load, so
// every request the app makes arrives here -- including the cross-origin POSTs to Apps
// Script. Answering those was a real bug, not merely a noisy one: `caches.match` can
// never hit on a POST, so each one fell through to a second `fetch` issued from inside
// the worker. That re-issued request is a different request. It loses the page's
// context, it is invisible to anything watching the page's own network, and it is one
// more place a token-bearing body can go wrong for no benefit at all -- this cache
// exists to serve the app shell offline, and nothing else.
//
// Returning without calling `respondWith` hands the request straight back to the
// browser, untouched.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
