/* The web app manifest is valid, and what it points at exists.

   Run:  node dev/manifesttest.js   (it needs no server)

   Named for the program, starts at the shell, icons exist at the sizes they say they are (read from the PNG
   itself), and the shortcuts open the Facilities page rather than skipping sign-in and the choice of sheet by
   landing inside an app. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

let m = null;
try { m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')); } catch (e) {}
ok('it is valid JSON', !!m);
m = m || {};
ok('it is named for the program', m.name === 'Arena Management System' && !!m.short_name && m.short_name.length <= 12, m.name + ' / ' + m.short_name);
ok('it starts at the shell, inside its own scope', m.start_url === './' && m.scope === './');
ok('it opens as an app, not a tab', m.display === 'standalone');
ok('it has a description', typeof m.description === 'string' && m.description.length > 20);
ok('its colours are real colours', /^#[0-9a-f]{6}$/i.test(m.background_color || '') && /^#[0-9a-f]{6}$/i.test(m.theme_color || ''));
const png = f => { try { const b = fs.readFileSync(path.join(ROOT, f)); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; } catch (e) { return null; } };
const sizes = (m.icons || []).map(i => i.sizes);
ok('it has the 192 and 512 icons', sizes.includes('192x192') && sizes.includes('512x512'), sizes.join());
(m.icons || []).forEach(i => {
  const d = png(i.src), want = i.sizes.split('x').map(Number);
  ok(i.src + ' exists, is a PNG and is the size it says', !!d && d[0] === want[0] && d[1] === want[1], JSON.stringify(d));
});
ok('the icons are square, so a crop to a circle or rounded square loses only corners', (m.icons || []).every(i => { const d = png(i.src); return d && d[0] === d[1]; }));
const sc = m.shortcuts || [];
ok('it has a shortcut to Facilities', sc.length >= 1 && sc.some(s => /Facilities/i.test(s.name)));
ok('every shortcut opens the shell\'s Facilities page', sc.every(s => /^\.\/index\.html#\/$/.test(s.url)), sc.map(s => s.url).join());
ok('and the page it names exists', sc.every(s => fs.existsSync(path.join(ROOT, s.url.split('#')[0]))));
ok('shortcut icons exist', sc.every(s => (s.icons || []).every(i => !!png(i.src))));
ok('the pages link it, and the icon the home screen uses', ['index.html', 'ice.html', 'glass.html'].every(p => { const h = fs.readFileSync(path.join(ROOT, p), 'utf8'); return /rel="manifest" href="manifest.json"/.test(h) && /rel="apple-touch-icon"/.test(h); }));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
