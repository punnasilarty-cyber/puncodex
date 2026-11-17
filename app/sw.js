/* Pun Codex service worker.
 *
 * Network first for anything that can change (HTML, web-version.json), cache first for
 * hashed assets, and no caching at all for Supabase traffic or signed photo URLs -
 * a stale photo list would show deleted images, and caching personal photos is not
 * something this app should do silently.
 */
const CACHE = "puncodex-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;          // Supabase / fonts
  if (!url.pathname.includes("/app/")) return;              // the marketing site

  const isAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?)$/.test(url.pathname);
  if (isAsset) {
    event.respondWith(
      caches.match(request).then((hit) =>
        hit ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html"))),
  );
});
