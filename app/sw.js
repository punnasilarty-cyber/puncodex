// Pun Codex web app service worker.
//
// Flutter's generated flutter_service_worker.js now unregisters itself, so the
// bundle was not installable and had no offline shell. This worker keeps the app
// shell in the cache (HTML, bootstrap, main.dart.js, canvaskit, icons) and never
// touches Supabase traffic: only same-origin GET requests are handled here.
//
// The cache name comes from web-version.json, so publishing a new bundle
// automatically creates a new cache and the old one is deleted on activate.

const FALLBACK_CACHE = "pun-codex-shell";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      let version = FALLBACK_CACHE;
      try {
        const res = await fetch("web-version.json", { cache: "no-store" });
        if (res.ok) {
          const marker = await res.json();
          version = `pun-codex-${marker.commit || marker.builtAt || "dev"}`;
        }
      } catch {
        // offline during install: still cache what we can under the fallback name
      }
      const cache = await caches.open(version);
      const shell = [
        "./",
        "index.html",
        "flutter_bootstrap.js",
        "main.dart.js",
        "manifest.json",
        "web-version.json",
        "favicon.png",
        "icons/Icon-192.png",
        "icons/Icon-512.png",
      ];
      await Promise.allSettled(
        shell.map(async (path) => {
          try {
            const response = await fetch(new Request(path, { cache: "reload" }));
            if (response.ok) await cache.put(path, response);
          } catch {
            // a missing optional asset must not fail the whole install
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const current = names.filter((name) => name.startsWith("pun-codex-"));
      // keep the newest cache, drop the rest
      if (current.length > 1) {
        const keep = current.sort().at(-1);
        await Promise.all(
          current.filter((name) => name !== keep).map((name) => caches.delete(name)),
        );
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache Supabase/Graph calls
  if (url.pathname.includes("web-version.json")) return; // always check the marker live

  // Navigations: network first so a new deploy is picked up, cache as fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(await currentCacheName());
          cache.put("index.html", fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(await currentCacheName());
          return (
            (await cache.match("index.html")) ||
            (await cache.match("./")) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Assets: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(await currentCacheName());
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })(),
  );
});

async function currentCacheName() {
  const names = (await caches.keys())
    .filter((name) => name.startsWith("pun-codex-"))
    .sort();
  return names.at(-1) || FALLBACK_CACHE;
}
