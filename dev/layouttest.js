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

/* ---------------- notes on the glass come off ---------------- */

/* Labels and tags lived in the layout with nothing able to edit them, so a
   panel replaced last month still read "Cracked" and the only fix was editing
   the file. */
const noted = await p.evaluate(() => {
  activeBucket = 'legacy'; useLayout('legacy');
  buildPlan(); table(); detail(); paint(); paintFacility();
  select('082');
  return { label: document.getElementById('plabel').value,
           tag: document.getElementById('ptag').value,
           chips: document.querySelectorAll('#tb .tagchip').length };
});
ok('a panel shows the label the survey gave it', noted.label === 'Cracked', noted.label);
ok('and the kind of note it is', noted.tag === 'damage', noted.tag);

const relabelled = await p.evaluate(() => {
  set('082', { label: 'Replaced Sept 2026', tag: '' });
  buildPlan(); paint(); table(); detail(); paintNotes();
  return { label: document.getElementById('plabel').value,
           tag: document.getElementById('ptag').value,
           chips: [...document.querySelectorAll('#tb .tagchip')].map(c => c.textContent),
           title: (document.querySelector('#pnl-082 title') || {}).textContent || '' };
});
ok('it can be relabelled', relabelled.label === 'Replaced Sept 2026', relabelled.label);
/* The word "Cracked" also sits in 082's condition note, so this has to look
   at the chip rather than the row text. */
ok('the schedule follows', relabelled.chips.indexOf('Replaced Sept 2026') >= 0
   && relabelled.chips.indexOf('Cracked') < 0, JSON.stringify(relabelled.chips));
ok('and so does the plan', /Replaced Sept 2026/.test(relabelled.title), relabelled.title);

/* An empty label is a deliberate clearing, not "fall back to the survey". */
const cleared = await p.evaluate(() => {
  set('082', { label: '' });
  buildPlan(); table(); detail();
  return { label: document.getElementById('plabel').value,
           chips: [...document.querySelectorAll('#tb .tagchip')].map(c => c.textContent) };
});
ok('clearing a label leaves it cleared, not back to the survey',
   cleared.label === '' && cleared.chips.indexOf('Replaced Sept 2026') < 0, JSON.stringify(cleared));

/* The standing explanation about panel 111 hangs off that panel's tag, so
   confirming it on a walk-round takes the explanation with it. */
const before111 = await p.evaluate(() =>
  [...document.querySelectorAll('#notes .note h3')].map(h => h.textContent));
ok('Conway shows its survey notes', before111.length === 3, JSON.stringify(before111));
ok('including the one about panel 111', before111.some(t => /111/.test(t)), JSON.stringify(before111));

const after111 = await p.evaluate(() => {
  set('111', { tag: '' });
  buildPlan(); paint(); paintNotes();
  return { titles: [...document.querySelectorAll('#notes .note h3')].map(h => h.textContent),
           ticks: document.querySelectorAll('.tick.assumed').length,
           dashed: document.querySelectorAll('.pnl.assumed').length };
});
ok('confirming panel 111 retires its explanation',
   !after111.titles.some(t => /111/.test(t)), JSON.stringify(after111.titles));
ok('and the others stay', after111.titles.length === 2, JSON.stringify(after111.titles));
ok('the plan stops flagging it too', after111.ticks === 0 && after111.dashed === 0,
   JSON.stringify(after111));

/* Those notes are Conway's findings about Conway. They were written into the
   markup, so every rink built since was shown them. */
const otherRink = await p.evaluate(() => {
  activeBucket = 'test'; useLayout('test');
  buildPlan(); table(); detail(); paint(); paintFacility();
  return { hidden: document.getElementById('notes').hidden,
           text: document.getElementById('notes').textContent.trim() };
});
ok('another rink is not shown Conway\'s survey notes',
   otherRink.hidden && otherRink.text === '', JSON.stringify(otherRink));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
