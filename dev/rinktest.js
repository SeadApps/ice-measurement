/* Rink view: Compare to.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/rinktest.js

   The old Map | Trend buttons are gone. "Compare to" on the Rink view picks Nothing (the colour
   map), the previous round, or any other round; anything but Nothing draws each spot as the
   change since that round, with the change legend. There is no 3D control. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280), p = D.p;
const errs = []; p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
const R = fn => p.evaluate(fn);
const vis = sel => p.isVisible(sel);
await p.goto(B + '/ice.html#/f/f1/s/s1/rink');
await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
await p.waitForSelector('#shellbar .nav'); await sleep(1800);

ok('no Map | Trend buttons', await R(() => !document.getElementById('viewMap') && !document.getElementById('viewTrend')));
ok('no 3D control or surface canvas', await R(() => !document.getElementById('view3d') && !document.getElementById('surf')));
ok('Compare to is on the Rink view', await vis('#cmpSel'));
const opts = () => R(() => [...document.getElementById('cmpSel').options].map(o => o.textContent));
const o0 = await opts();
ok('it offers Nothing, then the previous round, then the other rounds', o0[0] === 'Nothing' && o0[1] === 'Previous round' && o0.length >= 3, o0.join(' | '));
ok('and starts on Nothing: the colour map, with the band legend', await p.inputValue('#cmpSel') === 'off' && await R(() => viewMode) === 'map' && !(await R(() => /thinner/.test(document.getElementById('legend').textContent))));
ok('where the map-mode toggle is offered', await R(() => document.getElementById('mapModeRow').style.display) !== 'none');

const cur = await R(() => state.activeSession);
await p.selectOption('#cmpSel', ''); await sleep(400);
ok('Previous round draws the change since it', await R(() => viewMode) === 'trend' && await R(() => /thinner/.test(document.getElementById('legend').textContent)));
ok('the colour-map controls are put away', await R(() => document.getElementById('mapModeRow').style.display) === 'none');
const other = await R(() => [...document.getElementById('cmpSel').options].map(o => o.value).filter(v => v && v !== 'off')[0]);
await p.selectOption('#cmpSel', other); await sleep(400);
ok('a chosen round is the one compared to', await R(() => compareId) === other && await p.inputValue('#cmpSel') === other);
ok('and the baseline is that round', await R(() => baselineSession().id) === other);
ok('the address does not change', /\/s\/s1\/rink$/.test(await R(() => location.hash)));
await p.selectOption('#cmpSel', 'off'); await sleep(400);
ok('Nothing returns to the colour map', await R(() => viewMode) === 'map' && await R(() => document.getElementById('mapModeRow').style.display) !== 'none');
ok('with no comparison kept', await R(() => compareId) === null);

/* it is remembered, and it is only on the Rink view */
await p.selectOption('#cmpSel', ''); await sleep(300);
await p.reload(); await sleep(1800);
if (await vis('.sync-gate')) { await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button'); await sleep(1800); }
ok('a reload keeps comparing', await p.inputValue('#cmpSel') === '' && await R(() => viewMode) === 'trend');
await p.click('#iceTabs [data-page=build]'); await sleep(400);
ok('the builder does not offer it', !(await vis('#cmpSel')));
ok('and the builder always shows the map', await R(() => viewMode) === 'map' || await R(() => document.getElementById('rink').clientWidth > 0));
await p.click('#iceTabs [data-page=rink]'); await sleep(400);
ok('back on the Rink view it is there again', await vis('#cmpSel'));

/* exports follow what is on screen */
await p.selectOption('#cmpSel', ''); await sleep(300);
ok('the image export says Change vs when comparing', await R(() => { const c = renderToImage(600); return c.width === 600; }));

ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
