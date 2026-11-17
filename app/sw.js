/* Pun Codex service worker.
 *
 * Two rules, both from experience:
 *   1. Documents are NETWORK ONLY. Caching index.html once meant an installed app kept
 *      booting from an HTML file that pointed at asset hashes a later deploy had
 *      already removed - the phone showed a blank screen and the user reported "the app
 *      will not update". A hashed asset can never go stale, an entry document can.
 *   2. Only same-origin hashed assets are cached. Supabase requests and signed photo
 *      URLs are never touched, so no student photo ends up in the cache.
 */
const CACHE = "puncodex-assets-v2";
const OFFLINE = new Response(
  "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">" +
    "<title>Pun Codex</title><body style=\"font-family:system-ui;background:#17150f;color:#fbf8f2;" +
    "display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px\">" +
    "<div><h1 style=\"font-size:18px\">ออฟไลน์อยู่</h1>" +
    "<p style=\"opacity:.7;font-size:14px\">เชื่อมต่ออินเทอร์เน็ตแล้วเปิดหน้านี้ใหม่</p></div>",
  { headers: { "Content-Type": "text/html; charset=utf-8" } },
);

self.addEventListener("install", () => self.skipWaiting());

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
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes("/app/")) return;

  const isHashedAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?)$/.test(url.pathname);

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
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

  // Navigation and everything else: always the network, with a written offline page as
  // the only fallback. Never a cached document.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => OFFLINE));
  }
});
