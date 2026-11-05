// Bump CACHE_VERSION whenever you change any file listed below — there's no build
// step, so this string is the only thing that retires the previous cache.
const CACHE_VERSION = "arena-v23";  // v20: Ice is three pages (Rink view, Trends, Measurement builder) named by the address; ice.html, shell.js
// v19: no 3D; Color map blend and Lowest point on the Rink view
// v18: ice-core.js (the model, moved out of ice.html unchanged)
// v17: the shared bar inside Ice and Glass (shellbar.css); shell.js, ice.html, glass.html
// v16: the Staff page; sync.js, shell.js, home.js, shell.css
// v15: backup, restore and units in the account menu; records.js, shell.js, shell.css, ice.html
// v14: Sheet settings page; records compared in a fixed key order; hidden sheets keep their rounds; records.js, home.js, shell.js, shell.css
// v13: the shell replaces the launcher (index.html, shell.js, shell.css, home.js); the old launcher is launcher.html
// v12: settings in eighths, overdue days per facility, settings edits sync; records.js, ice.html, index.html
// v11: restore is Management's, the seed fix, updateSheet; sync.js, records.js, ice.html, glass.html, index.html
// v10: D1 follow-ups — half-inch corners, glass widths record, gate without a facility name; sync.js, records.js, glass.html
// v9: D1 — two-step sign-in, editing lock, facility tags, sheet shape; sync.js, records.js, ice.html, glass.html
const PRECACHE_URLS = [
  "./", "index.html", "ice.html", "glass.html", "sync.js", "records.js",
  "shell.js", "shell.css", "shellbar.css", "home.js", "launcher.html", "ice-core.js",
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
      // cache:"no-store" steps over the browser's own HTTP cache as well. Without
      // it, GitHub Pages' 10-minute max-age can keep serving yesterday's page even
      // though the service worker asked the network for it.
      fetch(e.request.url, { cache: "no-store", credentials: "same-origin" })
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
