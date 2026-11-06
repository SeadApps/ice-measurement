// Bump CACHE_VERSION whenever you change any file listed below — there's no build
// step, so this string is the only thing that retires the previous cache.
const CACHE_VERSION = "arena-v42";  // v42: on a touch device an export asks whether to share or save;  // v41: Reports carry the ice map and the glass plan (report-maps.js); a laptop saves exported files instead of opening the share window;  // v39: Undo moves under Clear this point in the Measurement builder;  // v38: Ice and Glass restyled to the Ice Board look (ice.css, glass.css);  // v37: the settings steppers no longer share the bar's .sb class (the bar collapsed to 60px wide);  // v36: Quality review (review.js), flags on the Facilities pages;  // v35: flags.js and the Flag buttons on Ice readings and Glass panels;  // v34: the old front page is gone (the shell is the front door); Glass has no header or Glass-only rinks;  // v33: glass.css (the Glass styling moved out of glass.html unchanged);  // v32: Glass in the app-wide backup (records.js, shell.js); no Save record / Load record in Glass;  // v31: Glass Builder — starts from the sheet size, Update/Keep, a draft that survives a reload, Remove this layout in the page, laptop message;  // v30: Glass pages (Rink view, Builder, Inventory) named by the address; editable counts as correction movements; shell.js knows /inventory;  // v29: Glass Rink view — no Marked by, Changed by in the order list, nearest-panel tap and a bottom sheet on a phone;  // v28: glass-core.js (the layouts, panel state and persistence moved out of glass.html unchanged);  // v27: glass-gen.js (the pure layout code moved out of glass.html unchanged);  // v26: Ice's script split into ice-rink.js, ice-trends.js, ice-build.js, ice-prefs.js (unchanged behaviour);  // v25: ice.css (the Ice styling moved out of ice.html); Trends by third and spot; in-page confirmations; band colours per theme;  // v20: Ice is three pages (Rink view, Trends, Measurement builder) named by the address; ice.html, shell.js
// v19: no 3D; Color map blend and Lowest point on the Rink view
// v18: ice-core.js (the model, moved out of ice.html unchanged)
// v17: the shared bar inside Ice and Glass (shellbar.css); shell.js, ice.html, glass.html
// v16: the Staff page; sync.js, shell.js, home.js, shell.css
// v15: backup, restore and units in the account menu; records.js, shell.js, shell.css, ice.html
// v14: Sheet settings page; records compared in a fixed key order; hidden sheets keep their rounds; records.js, home.js, shell.js, shell.css
// v13: the shell is the front door (index.html, shell.js, shell.css, home.js)
// v12: settings in eighths, overdue days per facility, settings edits sync; records.js, ice.html, index.html
// v11: restore is Management's, the seed fix, updateSheet; sync.js, records.js, ice.html, glass.html, index.html
// v10: D1 follow-ups — half-inch corners, glass widths record, gate without a facility name; sync.js, records.js, glass.html
// v9: D1 — two-step sign-in, editing lock, facility tags, sheet shape; sync.js, records.js, ice.html, glass.html
const PRECACHE_URLS = [
  "./", "index.html", "ice.html", "glass.html", "sync.js", "records.js", "flags.js",
  "shell.js", "shell.css", "shellbar.css", "home.js", "review.js", "report-maps.js", "glass-data.js", "ice-core.js", "ice.css", "ice-rink.js", "ice-trends.js", "ice-build.js", "ice-prefs.js", "glass-gen.js", "glass-core.js", "glass.css",
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
