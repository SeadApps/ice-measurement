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

/* One rink is not a choice, so there is nothing to pick from yet. */
ok('a device with only Conway has no picker',
   await p.evaluate(() => document.getElementById('rinkPick').hidden));

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
/* The centre red line is the default start, and it splits the side it begins
   on, so the walk reads as five stretches rather than four. */
ok('the walk starts at the centre red line',
   (await p.evaluate(() => BLD.start)) === 'centre');
/* The two that actually get ordered, written the way Conway's survey writes
   them so a value from the builder compares equal to one from the survey. */
const opts = await p.evaluate(() =>
  Array.from(document.querySelectorAll('#bT button')).map(b => b.dataset.t));
ok('thickness offers the two real options', opts.join(' ') === String.fromCharCode(49,47,50,34)
   + ' ' + String.fromCharCode(53,47,56,34), JSON.stringify(opts));
const HALF = String.fromCharCode(49,47,50,34), FIVE8 = String.fromCharCode(53,47,56,34);
const pickThickness = (sel, t) => p.evaluate(a => {
  document.querySelectorAll(a.sel + ' button').forEach(b => { if (b.dataset.t === a.t) b.click(); });
}, { sel: sel, t: t });
await pickThickness('#bT', HALF);
await p.click('#bldNext'); await sleep(250);

/* ---------------- step 3: the walk ---------------- */
ok('it starts the walk', /Stretch 1 of 5/.test(await p.textContent('#bldBody')),
   (await p.textContent('#bldBody')).slice(0, 40));

const spans = await p.evaluate(() => bldWalls().spans);
ok('five stretches, the start side halved',
   spans.length === 5 && Math.abs(spans[0] - spans[4]) < 0.01, JSON.stringify(spans.map(v => +v.toFixed(1))));
const addPiece = async (kind, width, note) => {
  await p.selectOption('#bK', kind);
  await p.fill('#bWi', String(width));
  if (note) await p.fill('#bLb', note);
  await p.click('#bAdd'); await sleep(90);
};

/* Fill each stretch to roughly its board length, so the joints come out sane.
   Ends get 5/8in and sides 1/2in, the way Conway is actually glazed. */
for (let w = 0; w < spans.length; w++) {
  const span = spans[w];
  const isEnd = (w === 1 || w === 3);
  await pickThickness('#bWt', isEnd ? FIVE8 : HALF);
  await sleep(80);
  if (w === 2) {                                  // the far side: a bench and a door
    await addPiece('open', 300, 'home bench');
    await addPiece('door', 36, 'penalty box');
  }
  if (w === 1) await addPiece('gate', 115, 'Zamboni');
  const already = await p.evaluate(() => bldTally(BLD.wi).used * 12);
  let left = span * 12 - already;
  const n = Math.max(1, Math.round(left / 48));
  const each = Math.floor((left / n) * 4) / 4 - 0.25;   // leave a little slack for joints
  for (let i = 0; i < n; i++) await addPiece('glass', each);
  if (w < spans.length - 1) { await p.click('#bldNext'); await sleep(200); }
}

const t3 = await p.evaluate(() => bldTally(BLD.wi));
ok('the joint is worked out live', t3.joint != null && t3.joint > 0, JSON.stringify(t3.joint));
ok('nothing overruns the boards', t3.left >= -0.01, String(t3.left));

/* Overrunning must be refused — that is the whole point of the readout. */
await addPiece('glass', 600);
await p.click('#bldNext');
ok('an overrun is refused', /overrun/i.test(await p.textContent('#bldMsg')), await p.textContent('#bldMsg'));
await p.evaluate(() => { BLD.walls[BLD.wi].items.pop(); bldRender(); }); await sleep(150);

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
ok('a row per stretch', prev.rows === 5, String(prev.rows));
/* Thickness is recorded per stretch, because ends and sides differ. */
const thick = await p.evaluate(() => {
  const by = {};
  BLD.built.panels.filter(x => x.kind === 'glass')
    .forEach(x => { (by[x.sectionKey] = by[x.sectionKey] || {})[x.thickness] = 1; });
  return Object.keys(by).map(k => k + ':' + Object.keys(by[k]).join(','));
});
ok('ends and sides carry different thicknesses',
   thick.some(t => t.indexOf('5/8') >= 0) && thick.some(t => t.indexOf('1/2') >= 0),
   JSON.stringify(thick));
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

/* ---------------- the way back off it ---------------- */

/* bldSave() moves you to the rink it just made. Until now nothing could move
   you off it again short of clearing site data. */
ok('the picker appears once there are two rinks',
   !(await p.evaluate(() => document.getElementById('rinkPick').hidden)));
const rinkOpts = await p.evaluate(() =>
  [...document.getElementById('rinkPick').options].map(o => o.textContent));
ok('it lists both, Conway first', rinkOpts.length === 2 && /Conway/.test(rinkOpts[0]), JSON.stringify(rinkOpts));

const built = await p.evaluate(() => ({
  size: document.getElementById('specSize').textContent,
  run: document.getElementById('specRun').textContent
}));
ok('the spec strip shows the built rink, not Conway', built.size.indexOf('185') === 0, built.size);

await p.selectOption('#rinkPick', 'legacy'); await sleep(700);
const home = await p.evaluate(() => ({
  bucket: activeBucket,
  panels: document.querySelectorAll('#plan .pnl').length,
  size: document.getElementById('specSize').textContent,
  radius: document.getElementById('specRadius').textContent,
  run: document.getElementById('specRun').textContent
}));
ok('choosing Conway goes back to it', home.bucket === 'legacy', home.bucket);
ok('with its own plan', home.panels === 127, String(home.panels));
/* Three of these were Conway's figures written into the markup. Read from the
   layout they have to reproduce them exactly, or the strip is now computing
   something different from the survey it came from. */
ok('and the strip reads exactly what the markup used to say',
   home.size === '200\u2032 \u00d7 85\u2032' && home.radius === '27\u2032 2\u2033'
   && home.run === '455\u2032 8\u2033', JSON.stringify(home));
ok("the built rink's run really was a different figure", built.run !== home.run,
   built.run + ' vs ' + home.run);

await p.reload(); await sleep(1800);
await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));
ok('and the rink you chose survives a reload',
   (await p.evaluate(() => activeBucket)) === 'legacy');

/* Changing where the walk starts changes the shape of the stretches, so what
   was entered against the old ones cannot be carried across. */
await p.click('#addRink'); await sleep(200);
await p.fill('#bName', 'Third rink'); await p.click('#bldNext'); await sleep(200);
await p.selectOption('#bStart', 'end'); await sleep(200);
await p.click('#bldNext'); await sleep(250);
ok('a corner start gives four stretches', /Stretch 1 of 4/.test(await p.textContent('#bldBody')),
   (await p.textContent('#bldBody')).slice(0, 40));
await p.click('#bldClose'); await sleep(150);

/* ---------------- the join: glass hangs off an ice surface ---------------- */

/* Seeded the way the launcher writes them, so the builder is looking at real
   surfaces rather than anything invented here. */
await p.evaluate(t => {
  localStorage.setItem('ice_v4_facilities', JSON.stringify({
    fa:{id:'fa',name:'Laconia Ice',ord:0,updatedAt:t} }));
  localStorage.setItem('ice_v4_sheets', JSON.stringify({
    sa:{id:'sa',facilityId:'fa',name:'Rink 1',ord:0,updatedAt:t},
    sb:{id:'sb',facilityId:'fa',name:'Rink 2',ord:1,updatedAt:t} }));
  localStorage.setItem('ice_v4_sessions', JSON.stringify({}));
  const pr = JSON.parse(localStorage.getItem('ice_v4_prefs') || '{}');
  pr.activeFacility = 'fa'; pr.activeSheet = 'sb';
  localStorage.setItem('ice_v4_prefs', JSON.stringify(pr));
}, '2026-09-01T00:00:00.000Z');

await p.click('#addRink'); await sleep(500);
const surfaces = await p.evaluate(() =>
  [...document.getElementById('bSheet').options].map(o => ({ v: o.value, t: o.textContent })));
ok('the builder offers the surfaces that have no glass yet',
   surfaces.some(o => o.v === 'sa') && surfaces.some(o => o.v === 'sb'), JSON.stringify(surfaces));
ok('naming them by facility and sheet',
   (surfaces.find(o => o.v === 'sa') || {}).t === 'Laconia Ice \u2014 Rink 1',
   JSON.stringify(surfaces));
/* The reason you opened this is the rink you are standing in. */
ok('and it starts on the one the launcher says you are at',
   (await p.evaluate(() => BLD.sheet)) === 'sb');
ok('the rink-name field stays out of the way for a surface that exists',
   !(await p.isVisible('#bNewWrap')));

/* Fills every stretch to roughly its board length and saves, the way the
   walk does, without driving the form a fourth time. */
async function walkIn(name) {
  if (name) BLD.name = name;
  BLD.L = 185; BLD.W = 85; BLD.Rft = 28; BLD.Rin = 0; BLD.height = 72;
  BLD.start = 'end'; BLD.walls = []; BLD.wi = 0;
  bldEnsureWalls();
  const spans = bldWalls().spans;
  BLD.walls.forEach((w, i) => {
    const count = Math.max(1, Math.round(spans[i] * 12 / 48));
    const each = Math.floor(spans[i] * 12 / count);
    w.items = Array.from({ length: count },
      () => ({ kind: 'glass', width_in: each, label: null, height_in: null }));
  });
  await bldSave();
  return activeBucket;
}

const onSb = await p.evaluate(walkIn, null); await sleep(400);
ok('walking it keys the glass by the surface itself', onSb === 'sb', String(onSb));
ok('so the plan is named after that surface',
   /Laconia Ice/.test(await p.textContent('#facName')), await p.textContent('#facName'));

await p.click('#addRink'); await sleep(500);
const left = await p.evaluate(() =>
  [...document.getElementById('bSheet').options].map(o => o.value));
ok('a surface that already has glass is not offered again', left.indexOf('sb') < 0,
   JSON.stringify(left));

/* And a rink that is not in the system at all: the builder writes the facility
   and the sheet, through the same method the launcher uses. */
await p.selectOption('#bSheet', '__new'); await sleep(250);
ok('choosing a new surface asks what it is called', await p.isVisible('#bNewWrap'));
const made = await p.evaluate(walkIn, 'Rink 3'); await sleep(400);
const recs = await p.evaluate(() => ({
  sh: JSON.parse(localStorage.getItem('ice_v4_sheets') || '{}'),
  fac: JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}') }));
ok('a rink walked from scratch gets a sheet record', !!recs.sh[made], String(made));
ok('under the facility you are already at', !!recs.sh[made] && recs.sh[made].facilityId === 'fa',
   JSON.stringify(recs.sh[made]));
ok('named what you called it', !!recs.sh[made] && recs.sh[made].name === 'Rink 3',
   JSON.stringify(recs.sh[made]));
ok('and its glass is keyed by that same surface',
   await p.evaluate(k => !!LAYOUTS[k], made));

/* Which rink you are at is one fact, not one per app. */
await p.evaluate(async () => { await switchRink('sb'); }); await sleep(500);
const prefs = await p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs') || '{}'));
ok('switching rink in Glass moves where the launcher says you are',
   prefs.activeSheet === 'sb' && prefs.activeFacility === 'fa', JSON.stringify(prefs));

await p.reload(); await sleep(1800);
await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));
ok('and Glass opens on that surface next time',
   (await p.evaluate(() => activeBucket)) === 'sb');

/* ---------------- and which way round it is drawn ---------------- */

/* Step 4 is where you are already holding the drawing up against the room. */
await p.click('#addRink'); await sleep(500);
await p.evaluate(() => {
  BLD.L = 185; BLD.W = 85; BLD.Rft = 28; BLD.Rin = 0; BLD.height = 72;
  BLD.start = 'end'; BLD.walls = []; BLD.wi = 0; BLD.step = 4;
  bldEnsureWalls();
  const spans = bldWalls().spans;
  BLD.walls.forEach((w, i) => {
    const count = Math.max(1, Math.round(spans[i] * 12 / 48));
    const each = Math.floor(spans[i] * 12 / count);
    w.items = Array.from({ length: count },
      () => ({ kind: 'glass', width_in: each, label: null, height_in: null }));
  });
  bldRender();
});
await sleep(400);
ok('the check step offers turn and mirror',
   (await p.$$('#bOrient button')).length === 2);
const drawnBefore = await p.evaluate(() =>
  (document.querySelector('#bldPlan .pnl') || {}).getAttribute
    ? document.querySelector('#bldPlan .pnl').getAttribute('d') : '');
await p.click('#bOrient button[data-o="flip"]'); await sleep(500);
const drawnAfter = await p.evaluate(() =>
  document.querySelector('#bldPlan .pnl').getAttribute('d'));
ok('mirroring redraws the preview', !!drawnBefore && drawnAfter !== drawnBefore);
ok('and the button says it is on',
   (await p.getAttribute('#bOrient button[data-o="flip"]', 'aria-pressed')) === 'true');

/* It has to be in the spec, or the rink arrives on the next device facing the
   way the builder was not holding it. */
const facedBucket = await p.evaluate(async () => { BLD.name = 'Faced rink'; await bldSave(); return activeBucket; });
await sleep(400);
ok('the walk records which way round it is',
   await p.evaluate(k => LAYOUTS[k].spec.flip === true, facedBucket));

ok('nothing threw throughout', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
