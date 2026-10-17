// Caches the page and fonts on first load so the game keeps working if venue Wi-Fi drops.
// Serves from cache immediately and refreshes the cache in the background.
const CACHE = "tof-keynote-v1";
const FILES = [
  "./",
  "./index.html",
  "./fonts/oswald-latin.woff2",
  "./fonts/oswald-latin-ext.woff2",
  "./fonts/public-sans-latin.woff2",
  "./fonts/public-sans-latin-ext.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    // Hash routes (#r1 etc.) never reach the network, so the page itself is one cache entry.
    const key = req.mode === "navigate" ? "./index.html" : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    if (cached) { e.waitUntil(fresh); return cached; }
    return fresh;
  }));
});
