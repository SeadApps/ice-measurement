/* The service worker's precache list is exactly what ships.

   Run:  node dev/swtest.js   (it needs no server)

   Every file the three pages load, and every icon the manifest names, is in the list; nothing in the list is
   missing from the repository; the list does not name anything that is gone or was never shipped (the old front page,
   the dev folder); the version is a bumped arena-vNN; and an activate drops every cache but the current one. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const sw = read('sw.js');
const list = (/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/.exec(sw) || [, ''])[1].match(/"[^"]+"/g).map(s => s.slice(1, -1));
const version = (/CACHE_VERSION\s*=\s*"([^"]+)"/.exec(sw) || [])[1];
const local = u => u && !/^(https?:)?\/\//.test(u) && !u.startsWith('data:');
const loaded = new Set(['manifest.json']);
['index.html', 'ice.html', 'glass.html'].forEach(page => {
  const html = read(page);
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) if (local(m[1])) loaded.add(m[1].split(/[?#]/)[0]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) if (local(m[1])) loaded.add(m[1].split(/[?#]/)[0]);
});
const manifest = JSON.parse(read('manifest.json'));
(manifest.icons || []).forEach(i => loaded.add(i.src));
const pages = ['index.html', 'ice.html', 'glass.html'];

ok('the version is arena-v followed by a number', /^arena-v\d+$/.test(version || ''), String(version));
ok('the list is not empty', list.length > 10, String(list.length));
ok('every file the pages load exists', [...loaded].every(f => fs.existsSync(path.join(ROOT, f))), [...loaded].filter(f => !fs.existsSync(path.join(ROOT, f))).join(', '));
const missing = [...loaded].filter(f => !list.includes(f));
ok('and every one of them is in the precache list', missing.length === 0, missing.join(', '));
pages.forEach(pg => ok(pg + ' is in the list', list.includes(pg)));
const gone = list.filter(f => f !== './' && !fs.existsSync(path.join(ROOT, f)));
ok('nothing in the list is missing from the repository', gone.length === 0, gone.join(', '));
ok('the root, "./", is in the list: the shell is the front door', list.includes('./'));
ok('the old front page is neither in the list nor in the repository', !list.includes('launcher.html') && !fs.existsSync(path.join(ROOT, 'launcher.html')));
ok('nothing from dev/ or supabase/ is cached', !list.some(f => /^(dev|supabase)\//.test(f)));
ok('a page that cannot be fetched falls back to the shell', /caches\.match\("index\.html"\)/.test(sw));
ok('an activate deletes every cache but the current one', /caches\.keys\(\)/.test(sw) && /k\s*!==\s*CACHE_VERSION/.test(sw) && /caches\.delete/.test(sw));
ok('pages are fetched network first, so a push goes live on the next visit', /cache:\s*"no-store"/.test(sw));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
