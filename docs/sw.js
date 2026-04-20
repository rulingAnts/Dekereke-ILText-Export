// Bump this string to force all clients to discard the old cache and re-fetch.
const CACHE_VERSION = "v1";
const CACHE_NAME = `dekereke-iltextexport-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        "./",
        "./index.html",
      ])
    )
  );
});

self.addEventListener("activate", (event) => {
  // Delete every cache that doesn't match the current version.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Cache-first for same-origin requests; network-only for everything else.
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only cache successful, non-opaque responses.
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});
