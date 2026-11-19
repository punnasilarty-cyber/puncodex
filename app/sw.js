/* Pun Codex service worker.
 *
 * Three rules, all from experience:
 *   1. Documents are NETWORK ONLY. Caching index.html once meant an installed app kept
 *      booting from an HTML file that pointed at asset hashes a later deploy had
 *      already removed - the phone showed a blank screen and the user reported "the app
 *      will not update". A hashed asset can never go stale, an entry document can.
 *   2. Only same-origin hashed assets are cached. Supabase requests and signed photo
 *      URLs are never touched, so no student photo ends up in the cache.
 *   3. Face models are cached with a birthday. The recognition page needs ~23 MB of .onnx
 *      and .wasm before it can answer a single search, and paying that again on every
 *      visit is what makes people close the page. Their names carry no content hash, so
 *      they are not cache-forever either: a copy younger than MAX_AGE is served without
 *      touching the network, and an older one is served immediately while a fresh copy
 *      is fetched for the next visit. When the models themselves are replaced, rename
 *      MODEL_CACHE so nothing old survives.
 */
const CACHE = "puncodex-assets-v2";
const MODEL_CACHE = "puncodex-models-v1";
const MODEL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE && key !== MODEL_CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

/** Age of a cached response, from its own Date header. Infinity when it cannot be read. */
function ageOf(response) {
  const stamp = Date.parse(response.headers.get("date") ?? "");
  return Number.isFinite(stamp) ? Date.now() - stamp : Number.POSITIVE_INFINITY;
}

async function store(cache, request, response) {
  if (!response || !response.ok) return;
  try {
    await cache.put(request, response.clone());
  } catch {
    /* quota exceeded: the page still works, it just downloads again next time */
  }
}

/**
 * A big, unhashed model file.
 * Fresh copy -> cache only. Stale copy -> cache now, newer copy in the background.
 * Nothing cached -> the network, and keep what comes back.
 */
function serveModel(event, request) {
  return caches.open(MODEL_CACHE).then(async (cache) => {
    const hit = await cache.match(request);
    if (hit) {
      if (ageOf(hit) >= MODEL_MAX_AGE_MS) {
        event.waitUntil(fetch(request).then((response) => store(cache, request, response)).catch(() => undefined));
      }
      return hit;
    }
    const response = await fetch(request).catch(() => null);
    if (response) await store(cache, request, response);
    return response ?? Response.error();
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes("/app/")) return;

  const isModelFile = /\/(face-models|face-models-arcface|ort)\//.test(url.pathname) || /\.wasm$/.test(url.pathname);
  const isHashedAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?)$/.test(url.pathname);

  if (isModelFile) {
    // A Range response is a fragment; stored as a whole file it would corrupt the next search.
    if (request.headers.has("range")) return;
    event.respondWith(serveModel(event, request));
    return;
  }

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
            }
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
