/* G2: the renderer draws a layout, not Conway.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/layouttest.js

   Two things are being checked. First that Conway is unchanged — the whole
   refactor is meant to be invisible, and the surest way to know is to render
   it and look. Second that a sheet which is not 200x85, has no Zamboni gate
   and names its own edges renders at all, which it could not before: the gate
   lookup was unguarded and took the entire plan down with it.

   The synthetic layout reuses Conway's panel run. Generating a real one for a
   different sheet is G3's job; what matters here is that everything around the
   panels stops being Conway-shaped.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { window.__SYNC_CONFIG__ = { url: 'http://localhost:8200', anon: 'test', email: 'x@y.z' }; });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
await p.goto(B + '/glass.html'); await sleep(1500);
await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));

/* ---------------- Conway, unchanged ---------------- */
const conway = await p.evaluate(() => {
  const svg = document.getElementById('plan').innerHTML;
  return {
    viewBox: document.querySelector('#plan svg').getAttribute('viewBox'),
    blue: (svg.match(/--rink-blue/g) || []).length,
    door: svg.indexOf('doorlbl') >= 0,
    dims: (svg.match(/class="dim-t"[^>]*>([^<]+)</g) || []).map(m => m.replace(/.*>/, '').replace(/<$/, '')),
    edges: (svg.match(/class="seclbl"[^>]*>([^<]+)</g) || []).map(m => m.replace(/.*>/, '').replace(/<$/, '')),
    panels: document.querySelectorAll('.pnl').length
  };
});
ok('Conway keeps its viewBox', conway.viewBox === '-118 -60 236 120', conway.viewBox);
ok('Conway keeps full ice markings', conway.blue > 0, String(conway.blue));
ok('Conway keeps the Zamboni door callout', conway.door);
ok('Conway keeps its dimensions', conway.dims.join(' / ').indexOf('200') >= 0, conway.dims.join(' / '));
ok('Conway keeps its four edge labels', conway.edges.length === 4, JSON.stringify(conway.edges));
ok('Conway still draws 127 panels', conway.panels === 127, String(conway.panels));

/* ---------------- a rink that is not Conway ---------------- */
const other = await p.evaluate(() => {
  LAYOUTS.test = {
    rink: { L: 185, W: 85, R: 28 },
    panels: LAYOUTS.legacy.panels.map(x => Object.assign({}, x, { tag: x.tag === 'zamdoor' ? 'door' : x.tag })),
    meta: {},                       // no surveyed bench gap, no uniform joint
    glassHeight: 72,
    edges: { top: 'North side', bottom: 'South side' },   // no end labels at all
    copy: { lede: ' - a different building.', planNote: '', footer: 'a different footer' }
  };
  activeBucket = 'test';
  useLayout('test');
  buildPlan(); rail(); totals(); table(); detail(); paint(); paintFacility();
  const svg = document.getElementById('plan').innerHTML;
  return {
    viewBox: document.querySelector('#plan svg').getAttribute('viewBox'),
    blue: (svg.match(/--rink-blue/g) || []).length,
    redLines: (svg.match(/stroke="var\(--rink-red\)"/g) || []).length,
    door: svg.indexOf('doorlbl') >= 0,
    dims: (svg.match(/class="dim-t"[^>]*>([^<]+)</g) || []).map(m => m.replace(/.*>/, '').replace(/<$/, '')),
    edges: (svg.match(/class="seclbl"[^>]*>([^<]+)</g) || []).map(m => m.replace(/.*>/, '').replace(/<$/, '')),
    aria: document.querySelector('#plan svg').getAttribute('aria-label'),
    footer: document.getElementById('pageFooter').textContent,
    height: document.getElementById('specHeight').textContent,
    totals: document.getElementById('totals').textContent
  };
});

/* 185/2 + 18 = 110.5 either side; the height is unchanged so y is not. */
ok('the viewBox follows the sheet', other.viewBox === '-110.5 -60 221 120', other.viewBox);
ok('a non-regulation sheet drops the blue lines', other.blue === 0, String(other.blue));
ok('but keeps a centre line', other.redLines >= 1, String(other.redLines));
ok('no Zamboni callout without a gate', !other.door);
ok('the dimensions read 185 feet', other.dims.some(d => d.indexOf('185') >= 0), other.dims.join(' / '));
ok('only the edges the layout names', other.edges.length === 2 && other.edges.indexOf('North side') >= 0,
   JSON.stringify(other.edges));
ok('the plan is labelled for the reader', /rink glass at/.test(other.aria || ''), other.aria);
ok('the footer comes from the layout', other.footer === 'a different footer', other.footer);
ok('glass height comes from the layout', other.height.indexOf('72') >= 0, other.height);
ok('no uniform-joint row without a survey', other.totals.indexOf('Uniform joint') < 0);

/* The unguarded gate lookup used to throw here and take the plan with it. */
ok('nothing threw while drawing it', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

/* ---------------- and back again ---------------- */
const back = await p.evaluate(() => {
  activeBucket = 'legacy'; useLayout('legacy');
  buildPlan(); rail(); totals(); table(); detail(); paint(); paintFacility();
  return { viewBox: document.querySelector('#plan svg').getAttribute('viewBox'),
           panels: document.querySelectorAll('.pnl').length,
           height: document.getElementById('specHeight').textContent };
});
ok('switching back restores Conway', back.viewBox === '-118 -60 236 120' && back.panels === 127, JSON.stringify(back));
ok('and its glass height', back.height.indexOf('75') >= 0, back.height);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
