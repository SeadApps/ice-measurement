/* G3c: a rink built on one device turns up on another, drawn from the walk.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/layoutsynctest.js

   The load-bearing claim is that the drawing does not travel. A generated
   layout is around 60KB - a panel per piece, each carrying an SVG path - and
   none of it needs to cross the wire, because generateLayout() is
   deterministic: the ~2KB spec that produced it redraws the same rink
   anywhere. So what these checks are really asserting is that the two devices
   agree panel for panel while only the walk was ever sent.

   The builder's form is buildertest's job. Here the walk is set up directly and
   saved through bldSave(), which is the real path a rink takes.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const CFG = { url: B, anon: 'test', email: 'operations@conwayarena.local' };
const CODE = 'test-access-code';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

const errs = [];
async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, CFG);
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', CODE);
  await p.click('.sync-gate button');
  await sleep(4000);
}
const rows = async () => (await (await fetch(B + '/__rows')).json());
const layoutRows = async () => (await rows()).filter(r => r.kind === 'glass_layout');

/* Writes a record straight to the server, for shapes this build would not
   produce on its own. */
async function seed(rec) {
  const auth = await (await fetch(B + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CFG.email, password: CODE }) })).json();
  await fetch(B + '/rest/v1/records?on_conflict=kind,id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CFG.anon,
               Authorization: 'Bearer ' + auth.access_token },
    body: JSON.stringify([rec]) });
}

/* Set up a walk and save it the way the builder does. A plain 185 x 85 sheet
   with a Zamboni gate on the first end - deliberately not Conway, so nothing
   can pass by falling back to the compiled-in layout. */
function walkAndSave(name) {
  BLD.name = name; BLD.L = 185; BLD.W = 85; BLD.Rft = 28; BLD.Rin = 0;
  BLD.height = 72; BLD.start = 'end'; BLD.thickness = '1/2"';
  BLD.walls = []; BLD.wi = 0;
  bldEnsureWalls();
  const spans = bldWalls().spans;
  BLD.walls.forEach((w, i) => {
    const count = Math.max(1, Math.round(spans[i] * 12 / 48));
    const each = Math.floor(spans[i] * 12 / count);
    w.items = Array.from({ length: count },
      () => ({ kind: 'glass', width_in: each, label: null, height_in: null }));
  });
  BLD.walls[0].items.push({ kind: 'gate', width_in: 24, label: 'Zamboni', height_in: null });
  bldSave();
  return activeBucket;
}

/* Cheap content hash, so two devices' panel runs can be compared without
   dragging 60KB of paths back through the driver twice. */
function digestOf(bucket) {
  const s = JSON.stringify(LAYOUTS[bucket].panels);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return { n: LAYOUTS[bucket].panels.length, h: h, bytes: s.length };
}

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();

/* ---- A walks a rink in ---- */
const A = await device(b);
await A.p.goto(B + '/glass.html'); await signIn(A.p);
const bucket = await A.p.evaluate(walkAndSave, 'Twin Rinks East');
await sleep(4000);

const lays = await layoutRows();
ok('the rink reached the server', lays.length === 1 && lays[0].id === bucket,
   JSON.stringify(lays.map(r => r.id)));
ok("and Conway's compiled-in layout was not sent with it",
   !lays.some(r => r.id === 'legacy'));

const row = lays[0];
ok('the record carries the walk', !!row.body.spec && Array.isArray(row.body.spec.sections),
   JSON.stringify(Object.keys(row.body)));
ok('and the name, so the other device can label it', row.body.name === 'Twin Rinks East',
   row.body.name);

/* The whole point of G3c: the drawing stays at home. */
const wire = JSON.stringify(row.body).length;
const drawn = (await A.p.evaluate(digestOf, bucket)).bytes;
ok('no panel run is in the record', !('panels' in row.body), JSON.stringify(Object.keys(row.body)));
ok('and no SVG path data anywhere in it', !/"d":"M/.test(JSON.stringify(row.body)));
ok('the walk is a fraction of the drawing it produces', wire * 5 < drawn,
   wire + ' bytes on the wire vs ' + drawn + ' drawn');

/* ---- B has never seen this rink ---- */
const D = await device(b);
await D.p.goto(B + '/glass.html'); await signIn(D.p);
await sleep(3000);

const there = await D.p.evaluate(k => !!LAYOUTS[k], bucket);
ok('B receives the rink', there);

const from = await A.p.evaluate(digestOf, bucket);
const to = await D.p.evaluate(digestOf, bucket);
ok('and redraws it to the same number of pieces', from.n === to.n, from.n + ' vs ' + to.n);
/* The strong form: not merely a rink of the same size, but the identical run,
   panel for panel, off a spec that never carried one. */
ok('panel for panel identical, from the walk alone', from.h === to.h,
   from.h + ' vs ' + to.h);
ok('B names it from the record', (await D.p.evaluate(k => FACILITY_NAMES[k], bucket))
   === 'Twin Rinks East');
ok('and can show it', (await D.p.evaluate(k => { switchRink(k); return activeBucket; }, bucket))
   === bucket);

/* ---- a condition recorded on B comes back to A, scoped to this rink ---- */
await D.p.evaluate(() => set('002', { status: 'replace', note: 'from the other device' }));
await sleep(4000);
const scoped = (await rows()).find(r => r.kind === 'glass_panel' && r.id === bucket + ':002');
ok('a mark on the new rink travels under a scoped id', !!scoped,
   JSON.stringify((await rows()).filter(r => r.kind === 'glass_panel').map(r => r.id)));

await A.p.evaluate(() => Sync.sync('again')); await sleep(3000);
ok('and lands on A against the same rink',
   (await A.p.evaluate(k => (bucketOf(k)['002'] || {}).status, bucket)) === 'replace');
ok("without touching Conway's panel of that number",
   (await A.p.evaluate(() => (bucketOf('legacy')['002'] || {}).status || 'ok')) === 'ok');

/* ---- an idle device restamps nothing ---- */
const before = (await layoutRows())[0].updated_at;
await D.p.evaluate(() => Sync.sync('again')); await sleep(3000);
await A.p.evaluate(() => Sync.sync('again')); await sleep(3000);
ok('neither device echoes the layout back', (await layoutRows())[0].updated_at === before,
   before + ' -> ' + (await layoutRows())[0].updated_at);

/* ---- a spec this build cannot draw must not take the pull down ---- */
await seed({ id: 'rbroken', kind: 'glass_layout',
             body: { id: 'rbroken', name: 'Nonsense', spec: { L: 'wide', sections: 'no' } },
             deleted: false });
const E = await device(b);
await E.p.goto(B + '/glass.html'); await signIn(E.p);
await sleep(3000);
ok('a malformed layout is skipped, not drawn',
   await E.p.evaluate(() => !LAYOUTS['rbroken']));
ok('and the good rink still arrives alongside it',
   await E.p.evaluate(k => !!LAYOUTS[k], bucket));
ok('the marked panel came too', (await E.p.evaluate(k =>
   (bucketOf(k)['002'] || {}).status, bucket)) === 'replace');

ok('nothing threw throughout', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await A.ctx.close(); await D.ctx.close(); await E.ctx.close();
await b.close();
process.exit(fail ? 1 : 0);
})();
