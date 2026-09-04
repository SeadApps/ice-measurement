// Bump CACHE_VERSION whenever you change any file listed below — there's no build
// step, so this string is the only thing that retires the previous cache.
const CACHE_VERSION = "rink-apps-v3";
const PRECACHE_URLS = [
  "./", "index.html", "ice.html", "glass.html",
  "manifest.json", "icon-192.png", "icon-512.png"
];

// Add files one at a time: a single missing file then can't abort the whole install
// and leave the site with no service worker at all.
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => Promise.all(PRECACHE_URLS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, so a push goes live on the next visit instead of waiting
  // for the cache to be invalidated. Falls back to the cached copy when offline.
  if (e.request.mode === "navigate" || e.request.destination === "document") {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match("index.html")))
    );
    return;
  }

  // Everything else (icons, manifest): cache first — these rarely change.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }))
  );
});
