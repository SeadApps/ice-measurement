/* Ice as three pages: Rink view, Trends and the Measurement builder, named by the address.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/pagestest.js

   The address (#/f/FID/s/SID/rink|trends|build) is the page. An address without one, and a
   device that last stood on the old home screen, open the rink. Each page shows its own
   controls and puts the other's away; the home screen's fleet, facility list and sheet grid
   are gone (the shell's Facilities and Sheets pages are where that lives). */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280);
const p = D.p;
const errs = []; p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
const R = (fn, a) => p.evaluate(fn, a);
const vis = sel => p.isVisible(sel);
const hash = () => R(() => location.hash);
const cur = () => R(() => [...document.querySelectorAll('#iceTabs [data-page]')].filter(x => x.getAttribute('aria-current') === 'page').map(x => x.dataset.page).join());
const open = async url => {
  await p.goto(B + url); await p.reload(); await sleep(1500);
  if (await vis('.sync-gate')) { await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button'); }
  await p.waitForSelector('#shellbar .nav'); await sleep(1200);
};

await p.goto(B + '/ice.html#/f/f1/s/s1');
await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
await p.waitForSelector('#shellbar .nav'); await sleep(1500);

/* ---- an address with no page opens the rink ------------------------------------------------------ */
ok('no page in the address opens the Rink view', await cur() === 'rink' && /\/s\/s1\/rink$/.test(await hash()), await hash());
ok('the tab row has the three pages, in order', await R(() => [...document.querySelectorAll('#iceTabs button')].map(x => x.textContent).join('|')) === 'Rink view|Trends|Measurement builder');
ok('the rink is drawn', await vis('#rink') && !(await vis('#home')));
ok('Rink view shows its own controls', await vis('#legend') && await vis('#mapModeRow') && await vis('#expCsv') && await vis('#expPng') && await vis('#expPdf') && await vis('.readout'));
ok('and puts the builder\'s away', !(await vis('#chips')) && !(await vis('#noteInput')) && !(await vis('#undoBtn')) && !(await vis('#newRound')) && !(await vis('#impBtn')) && !(await vis('#clearBtn')));
ok('the old Sheets button, fleet, facility list and sheet grid are gone',
   await R(() => !document.getElementById('homeBtn') && !document.getElementById('fleet') && !document.getElementById('facList') && !document.getElementById('sheetGrid')));

/* ---- the builder ------------------------------------------------------------------------------------ */
await p.click('#iceTabs [data-page=build]'); await sleep(500);
ok('the Measurement builder tab writes the address', /\/s\/s1\/build$/.test(await hash()) && await cur() === 'build', await hash());
ok('Builder shows the entry controls', await vis('#chips') && await vis('#noteInput') && await vis('#undoBtn') && await vis('#newRound') && await vis('#impBtn') && await vis('#clearBtn') && await vis('#rink'));
ok('and puts the rink\'s away', !(await vis('#mapModeRow')) && !(await vis('#expCsv')) && !(await vis('#expPdf')) && !(await vis('.readout')) && !(await vis('#cmpWrap')) && !(await vis('#contourBar')));
ok('the builder always shows the map, whatever view was saved', await R(() => viewMode) === 'map');

/* ---- trends ----------------------------------------------------------------------------------------- */
await p.click('#iceTabs [data-page=trends]'); await sleep(500);
ok('Trends: the address and the tab', /\/s\/s1\/trends$/.test(await hash()) && await cur() === 'trends', await hash());
ok('shows the chart and the rounds, and not the workspace', await vis('#home') && await vis('#histChart') && !(await vis('#rink')));
ok('with the sheet named', (await R(() => document.getElementById('trendTitle').textContent)).includes('Conway Arena') && (await R(() => document.getElementById('trendsFac').textContent)).includes('Main'));
ok('and a row for each round', (await p.$$('#roundsList .round')).length === 2);
await p.click('#roundsList .round'); await sleep(500);
ok('a round opens on the Rink view', await cur() === 'rink' && await vis('#rink'));

/* ---- opening an address directly ------------------------------------------------------------------ */
for (const pg of ['trends', 'build', 'rink']) {
  await open('/ice.html#/f/f1/s/s1/' + pg);
  ok('opening /' + pg + ' lands on it', await cur() === pg && (await hash()).endsWith('/' + pg), await hash());
}

/* ---- the address changes under you ---------------------------------------------------------------- */
await R(() => { location.hash = '#/f/f1/s/s1/build'; }); await sleep(600);
ok('editing the address to /build switches the page', await cur() === 'build' && await vis('#chips'));
await R(() => { location.hash = '#/f/f2/s/s2/trends'; }); await sleep(900);
ok('and across sheets, keeping the page asked for', await cur() === 'trends' && (await R(() => document.getElementById('trendTitle').textContent)).includes('Flynn Rink · Standard'), await R(() => document.getElementById('trendTitle').textContent));
await p.click('#iceTabs [data-page=build]'); await sleep(500);
await R(() => { location.hash = '#/f/f2/s/s3'; }); await sleep(900);
ok('a sheet address with no page keeps the one you were on', await cur() === 'build' && /\/s\/s3\/build$/.test(await hash()), await hash());
ok('and the sheet\'s own size is drawn (120 by 60)', await R(() => L === 120 && W === 60));

/* ---- a device that last stood on the old home screen ---------------------------------------------- */
await open('/ice.html#/f/f1/s/s1');
ok('an address with no page resumes the page this device was last on', await cur() === 'build', await cur());
await R(() => { state.screen = 'home'; delete state.lastPage; persist(); }); await sleep(600);
await open('/ice.html#/f/f1/s/s1');
ok('a device that last stood on the old home screen opens the rink', await cur() === 'rink' && await vis('#rink'));

/* ---- looking writes nothing -------------------------------------------------------------------------- */
const stamp = async () => JSON.stringify((await k.rows()).map(r => [r.kind, r.id, r.updated_at]).sort());
const before = await stamp();
for (const pg of ['build', 'trends', 'rink']) { await p.click('#iceTabs [data-page=' + pg + ']'); await sleep(500); }
await sleep(1500);
ok('walking the three pages restamps no record', before === await stamp());

ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
