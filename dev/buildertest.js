/* G3b: the rink builder, driven the way somebody at the boards would drive it.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/buildertest.js

   The builder is the only way a second rink can exist, so what matters is not
   that the form works but that what comes out the far end is a rink the rest of
   the app can draw, record conditions against, and still have after a reload.

   The walk here is a plain 185 x 85 sheet with a bench opening, a door and a
   Zamboni gate, entered stretch by stretch — deliberately not Conway, so
   nothing can pass by accidentally falling back to the compiled-in layout.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

(async () => {
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript(() => { window.__SYNC_CONFIG__ = { url: 'http://localhost:8200', anon: 'test', email: 'x@y.z' }; });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
await p.goto(B + '/glass.html'); await sleep(1500);
await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));

/* ---------------- step 1: the sheet ---------------- */
await p.click('#addRink');
ok('the builder opens', await p.isVisible('#builder'));

await p.fill('#bL', '185'); await p.fill('#bW', '85');
await p.fill('#bRf', '28'); await p.fill('#bRi', '0');
await sleep(200);
const read = await p.textContent('#bRead');
ok('it works out the boards to walk', /\d+\.\d/.test(read), read.slice(0, 60));

/* A corner that cannot fit has to be caught here, not at the drawing stage. */
await p.fill('#bRf', '60'); await sleep(200);
await p.click('#bldNext');
ok('an impossible corner radius is refused', /too big/i.test(await p.textContent('#bldMsg')),
   await p.textContent('#bldMsg'));
await p.fill('#bRf', '28'); await sleep(150);

await p.click('#bldNext');
ok('a rink with no name is refused', /name/i.test(await p.textContent('#bldMsg')));
await p.fill('#bName', 'Nashua Arena — Rink 2');
await p.click('#bldNext'); await sleep(200);

/* ---------------- step 2: the glass ---------------- */
ok('it moves on to the glass', /The glass/.test(await p.textContent('#bldBody')));
await p.fill('#bH', '72');
await p.click('#bldNext'); await sleep(200);

/* ---------------- step 3: the walk ---------------- */
ok('it starts the walk', /Stretch 1 of 4/.test(await p.textContent('#bldBody')));

const spans = await p.evaluate(() => bldWalls().spans);
const addPiece = async (kind, width, note) => {
  await p.selectOption('#bK', kind);
  await p.fill('#bWi', String(width));
  if (note) await p.fill('#bLb', note);
  await p.click('#bAdd'); await sleep(90);
};

/* Fill each stretch to roughly its board length, so the joints come out sane. */
for (let w = 0; w < 4; w++) {
  const span = spans[w];
  if (w === 1) {                                  // a side with a bench and a door
    await addPiece('open', 300, 'home bench');
    await addPiece('door', 36, 'penalty box');
  }
  if (w === 2) await addPiece('gate', 115, 'Zamboni');
  const already = await p.evaluate(() => bldTally(BLD.wi).used * 12);
  let left = span * 12 - already;
  const n = Math.max(1, Math.round(left / 48));
  const each = Math.floor((left / n) * 4) / 4 - 0.25;   // leave a little slack for joints
  for (let i = 0; i < n; i++) await addPiece('glass', each);
  if (w < 3) { await p.click('#bldNext'); await sleep(200); }
}

const t3 = await p.evaluate(() => bldTally(3));
ok('the joint is worked out live', t3.joint != null && t3.joint > 0, JSON.stringify(t3.joint));
ok('nothing overruns the boards', t3.left >= -0.01, String(t3.left));

/* Overrunning must be refused — that is the whole point of the readout. */
await addPiece('glass', 600);
await p.click('#bldNext');
ok('an overrun is refused', /overrun/i.test(await p.textContent('#bldMsg')), await p.textContent('#bldMsg'));
await p.evaluate(() => { BLD.walls[3].items.pop(); bldRender(); }); await sleep(150);

await p.click('#bldNext'); await sleep(600);

/* ---------------- step 4: check the drawing ---------------- */
ok('it draws the rink for checking', await p.isVisible('#bldPlan svg'));
const prev = await p.evaluate(() => ({
  panels: document.querySelectorAll('#bldPlan .pnl').length,
  viewBox: document.querySelector('#bldPlan svg').getAttribute('viewBox'),
  rows: document.querySelectorAll('.bld-secs tbody tr').length,
  pagePanels: document.querySelectorAll('#plan .pnl').length
}));
ok('the preview has the pieces in it', prev.panels > 10, String(prev.panels));
ok('the preview is sized for a 185ft sheet', prev.viewBox.indexOf('-110.5') === 0, prev.viewBox);
ok('a row per stretch', prev.rows === 4, String(prev.rows));
ok('the page underneath is left alone', prev.pagePanels === 127, String(prev.pagePanels));

/* ---------------- save, and use it ---------------- */
await p.click('#bldNext'); await sleep(700);
ok('the builder closes on save', !(await p.isVisible('#builder')));

const after = await p.evaluate(() => ({
  bucket: activeBucket,
  name: document.getElementById('facName').textContent,
  panels: document.querySelectorAll('#plan .pnl').length,
  rows: document.querySelectorAll('#tb tr[data-id]').length,
  height: document.getElementById('specHeight').textContent,
  viewBox: document.querySelector('#plan svg').getAttribute('viewBox')
}));
ok('the new rink becomes the one on screen', after.bucket !== 'legacy', after.bucket);
ok('it carries the name it was given', /Rink 2/.test(after.name), after.name);
ok('the plan is the new rink, not Conway', after.panels !== 127 && after.panels > 10, String(after.panels));
ok('its schedule is listed', after.rows === after.panels, after.rows + ' vs ' + after.panels);
ok('its glass height came through', after.height.indexOf('72') >= 0, after.height);
ok('the plan is sized for it', after.viewBox.indexOf('-110.5') === 0, after.viewBox);

/* Conditions are recorded against the new rink, not Conway's panels. */
await p.evaluate(() => set('004', { status: 'replace', note: 'chipped' })); await sleep(300);
const split = await p.evaluate(() => ({
  mine: (bucketOf(activeBucket)['004'] || {}).status,
  conway: (bucketOf('legacy')['004'] || {}).status || 'ok'
}));
ok('a mark lands on the new rink', split.mine === 'replace', JSON.stringify(split));
ok("and not on Conway's panel of the same number", split.conway === 'ok', JSON.stringify(split));

/* ---------------- and it survives a reload ---------------- */
await p.reload(); await sleep(1800);
await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));
const back = await p.evaluate(() => ({
  bucket: activeBucket,
  panels: document.querySelectorAll('#plan .pnl').length,
  name: document.getElementById('facName').textContent,
  mark: (bucketOf(activeBucket)['004'] || {}).status
}));
ok('the rink is still there after a reload', back.bucket === after.bucket, back.bucket);
ok('with its layout', back.panels === after.panels, back.panels + ' vs ' + after.panels);
ok('its name', /Rink 2/.test(back.name), back.name);
ok('and the condition recorded against it', back.mark === 'replace', String(back.mark));

ok('nothing threw throughout', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
