/* Ice's canvas colours follow the theme.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/themetest.js

   The map and the charts are drawn on a canvas, which cannot read a stylesheet variable by itself.
   The band colours are the --b-* tokens (each theme has its own), read when the bands are built and
   again whenever the theme changes in the shared bar; the selection ring and the trend line use
   --frost. Changing the theme touches no record. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280), p = D.p;
const errs = []; p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
const R = (fn, a) => p.evaluate(fn, a);
await p.goto(B + '/ice.html#/f/f1/s/s1/rink');
await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
await p.waitForSelector('#shellbar .nav'); await sleep(1800);

const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const tokens = () => R(() => ['thin', 'low', 'ideal', 'high', 'thick'].map(n => getComputedStyle(document.documentElement).getPropertyValue('--b-' + n).trim()));
const bands = () => R(() => BANDS.map(b => b.color));
const pick = async name => { await p.click('#shellbar #acctMenu'); await p.click('#shellbar .dropdown .it:has-text("' + name + '")'); await sleep(400); };
const theme = () => R(() => document.documentElement.getAttribute('data-theme'));
const snap = () => k.rows().then(r => JSON.stringify(r.map(x => [x.kind, x.id, x.updated_at]).sort()));

const start = await theme();
const other = start === 'dark' ? 'Light' : 'Dark';
const t0 = await tokens(), b0 = await bands();
ok('in the starting theme the bands are that theme\'s tokens', JSON.stringify(t0) === JSON.stringify(b0), JSON.stringify([t0, b0]));
const c0 = await R(() => colorFor(1.5));
const before = await snap();

await pick(other);
const t1 = await tokens(), b1 = await bands();
ok('the two themes have different band colours', JSON.stringify(t0) !== JSON.stringify(t1));
ok('changing the theme in the bar re-reads them for the canvas', JSON.stringify(t1) === JSON.stringify(b1), JSON.stringify([t1, b1]));
const c1 = await R(() => colorFor(1.5));
ok('and the map\'s colour for a reading on a band follows', JSON.stringify(c0) !== JSON.stringify(c1) && JSON.stringify(c1) === JSON.stringify(rgb(t1[2])), JSON.stringify([c0, c1, rgb(t1[2])]));
ok('the legend swatches are the new colours', JSON.stringify(await R(() => [...document.querySelectorAll('#legend .sw')].slice(0, 5).map(e => { const c = getComputedStyle(e).backgroundColor.match(/\d+/g).slice(0, 3).map(Number); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); }))) === JSON.stringify(t1.map(x => x.toLowerCase())));
const ring = await R(() => themeInk('--frost', 'x'));
ok('the selection ring and trend line use the theme\'s accent, not a fixed colour', ring === await R(() => getComputedStyle(document.documentElement).getPropertyValue('--frost').trim()) && /^#/.test(ring));

await pick(start);
ok('and back again', JSON.stringify(await bands()) === JSON.stringify(t0) && JSON.stringify(await R(() => colorFor(1.5))) === JSON.stringify(c0));
ok('changing the theme writes no record', (await snap()) === before);
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
