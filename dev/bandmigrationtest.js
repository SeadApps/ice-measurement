/* D3: band edges, flood and shave levels and the target move to eighths of an inch.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/bandmigrationtest.js

   A reading is one of sixteen labels in eighths, so an edge sitting between two
   eighths (5/8 to 11/16) means the same as the eighth above it. Rounding UP is what
   keeps every reading in the band it is in now. That is the claim, and it is
   checked for every reading against the defaults and against two thousand random
   sets of edges, not just the defaults.

   Reads go through Records.settingsOf, so a device that has not migrated a facility
   (a Staff device may not write one) classifies exactly like one that has. The one
   case it cannot cover is an edge above 2 inches against the legacy "2+" label,
   which is counted as 2.1: no default comes near it, and the test says so. */
const { chromium } = require('playwright');
const B = 'http://localhost:8200';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = async () => (await (await fetch(B + '/__rows')).json());

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', 'test-access-code'); await p.click('.sync-gate button'); await sleep(2500);
}
const OLD = [0.6875, 1.4375, 1.5625, 1.9375];

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();
const { ctx, p } = await device(b);
await p.goto(B + '/ice.html'); await signIn(p);
const R = (fn, arg) => p.evaluate(fn, arg);

/* ---- the claim ----------------------------------------------------------------- */
const readings = await R(() => OPTIONS.filter(o => o !== '2+"').map(o => decOf.get(o)));
ok('there are fifteen readings in eighths besides "2+"', readings.length === 15, String(readings.length));
const bandIdx = (v, e) => { for (let i = 0; i < 4; i++) if (v < e[i]) return i; return 4; };
const same = (a, b2) => readings.every(v => bandIdx(v, a) === bandIdx(v, b2));
const mig = s => R(s => Records.settingsOf(s), s);

const def = await mig({ edges: OLD, target: 1.5, floodBelow: 1.25, shaveAbove: 1.5625, tieAttention: true });
ok('the old defaults become 3/4, 1 1/2, 1 5/8 and 2', JSON.stringify(def.edges) === '[0.75,1.5,1.625,2]', JSON.stringify(def.edges));
ok('and every reading keeps its band', same(OLD, def.edges));
ok('5/8 is still too thin, 3/4 still thin: the one reading that could have moved', bandIdx(0.625, def.edges) === 0 && bandIdx(0.75, def.edges) === 1);
ok('1 1/2 is the only ideal reading, as it was', readings.filter(v => bandIdx(v, def.edges) === 2).join() === '1.5');
ok('the new defaults are the migrated old ones', JSON.stringify(await R(() => Records.DEFAULT_EDGES)) === '[0.75,1.5,1.625,2]');
ok('flood 1.25 stays and shave 1 9/16 becomes 1 5/8', def.floodBelow === 1.25 && def.shaveAbove === 1.625);
ok('every reading is flooded or shaved exactly as before', readings.every(v => (v < 1.25) === (v < def.floodBelow) && (v >= 1.5625) === (v >= def.shaveAbove)));

const sets = await R(() => {
  const out = []; let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 2000; i++) {
    const e = [0, 0, 0, 0].map(() => 0.25 + rnd() * 1.75).sort((a, b) => a - b);
    out.push({ e, m: Records.settingsOf({ edges: e }).edges });
  }
  return out;
});
ok('and for two thousand random edge sets up to 2 inches', sets.every(s => same(s.e, s.m)), JSON.stringify(sets.find(s => !same(s.e, s.m))));
ok('every migrated edge is a whole number of eighths', sets.every(s => s.m.every(v => Math.abs(v * 8 - Math.round(v * 8)) < 1e-9)));
ok('and never lower than the edge it came from', sets.every(s => s.m.every((v, i) => v >= s.e[i] - 1e-9)));
const legacy = await R(() => decOf.get('2+"'));
ok('(the "2+" label counts as 2.1: an edge above 2 inches is the one case rounding up cannot keep)', legacy === 2.1);

/* ---- the function itself ---------------------------------------------------------- */
const f = await R(() => {
  const old = [0.6875, 1.4375, 1.5625, 1.9375];
  const d = Records.settingsOf(Records.defaultSettings()), once = Records.settingsOf({ edges: old, target: 1.5625 });
  return { same: JSON.stringify(d) === JSON.stringify(Records.defaultSettings()),
           idem: JSON.stringify(Records.settingsOf(once)) === JSON.stringify(once), target: once.target,
           empty: Records.settingsOf(null), junk: Records.settingsOf({ edges: [1, 'x', null], floodBelow: 'a' }),
           flood: Records.settingsOf({ edges: old, tieAttention: false }) };
});
ok('a new facility is already in migrated form', f.same);
ok('migrating twice changes nothing', f.idem);
ok('a target between eighths goes to the nearest', f.target === 1.625, String(f.target));
ok('no settings at all read as the defaults', JSON.stringify(f.empty.edges) === '[0.75,1.5,1.625,2]' && f.empty.target === 1.5 && f.empty.overdueDays === 7 && f.empty.settingsVersion === 2);
ok('edges that are not four numbers fall back to the defaults', JSON.stringify(f.junk.edges) === '[0.75,1.5,1.625,2]');
ok('flood and shave default to the edges they follow', f.flood.floodBelow === 1.5 && f.flood.shaveAbove === 1.625);

/* ---- migrating the records ---------------------------------------------------------- */
await R(() => { Object.assign(facility().settings, { target: 1.5, edges: [0.6875, 1.4375, 1.5625, 1.9375], tieAttention: true, floodBelow: 1.25, shaveAbove: 1.5625 });
  delete facility().settings.settingsVersion; delete facility().settings.overdueDays;
  session().data['3'] = '1 1/2"'; persist(); });
await sleep(1500);
await R(() => Sync.sync('t')); await sleep(1500);
const fid = await R(() => facility().id);
const stamps = async () => JSON.stringify((await rows()).map(r => [r.kind, r.id, r.updated_at]).sort());
const before = await stamps();
const prev = await R(() => Records.Repo.previewSettings());
ok('the preview lists the facility and what it would become', prev.length === 1 && prev[0].id === fid && JSON.stringify(prev[0].to.edges) === '[0.75,1.5,1.625,2]', JSON.stringify(prev));
ok('and wrote nothing', (await R(() => Records.Repo.previewSettings())).length === 1 && JSON.stringify((await R(() => facility().settings.edges))) === JSON.stringify(OLD));
const n = await R(() => Records.Repo.backfillSettings());
ok('migrating does one facility', n === 1, String(n));
const local = await R(() => JSON.parse(localStorage.getItem('ice_v4_facilities'))[facility().id].settings);
ok('and stores eighths with the version', JSON.stringify(local.edges) === '[0.75,1.5,1.625,2]' && local.settingsVersion === 2 && local.overdueDays === 7 && local.shaveAbove === 1.625, JSON.stringify(local));
ok('a second run finds nothing', await R(() => Records.Repo.backfillSettings()) === 0 && (await R(() => Records.Repo.previewSettings())).length === 0);
await R(() => Sync.sync('t')); await sleep(2000);
const after = JSON.parse(await stamps()), was = JSON.parse(before);
const moved = after.filter(r => JSON.stringify(r) !== JSON.stringify(was.find(w => w[0] === r[0] && w[1] === r[1])));
ok('only the facility was restamped, not a sheet or a round', moved.length === 1 && moved[0][0] === 'facility', JSON.stringify(moved));
const idle = await stamps();
await R(() => Sync.sync('t')); await sleep(1500);
ok('an idle device afterwards restamps nothing', idle === await stamps());

/* ---- Ice reads it the same either way, and an edit brings the lot across -------------- */
await R(() => { Object.assign(facility().settings, { edges: [0.6875, 1.4375, 1.5625, 1.9375], floodBelow: 1.25, shaveAbove: 1.5625 }); delete facility().settings.settingsVersion; buildBands(); });
const bands = await R(() => OPTIONS.map(o => bandOf(decOf.get(o)).key).join());
await R(() => { facility().settings.edges = [0.75, 1.5, 1.625, 2]; facility().settings.shaveAbove = 1.625; facility().settings.settingsVersion = 2; buildBands(); });
ok('Ice colours every reading the same on an unmigrated facility and a migrated one', bands === await R(() => OPTIONS.map(o => bandOf(decOf.get(o)).key).join()));
await R(() => { Object.assign(facility().settings, { edges: [0.6875, 1.4375, 1.5625, 1.9375], floodBelow: 1.25, shaveAbove: 1.5625, target: 1.5 }); delete facility().settings.settingsVersion; delete facility().settings.overdueDays; });
await R(() => { buildSettings(); const i = document.querySelectorAll('#edges input')[0]; i.value = '0.875'; i.dispatchEvent(new Event('input')); });
const touched = await R(() => facility().settings);
ok('editing one edge brings every setting across, so no old number sits beside a new one',
   JSON.stringify(touched.edges) === '[0.875,1.5,1.625,2]' && touched.settingsVersion === 2 && touched.shaveAbove === 1.625, JSON.stringify(touched));
await R(() => { buildSettings(); });
ok('the steppers show eighths', (await R(() => [...document.querySelectorAll('#edges input')].map(i => i.value).join())) === '0.875,1.5,1.625,2');
await R(() => { const i = document.getElementById('targetIn'); i.value = '1.3'; i.dispatchEvent(new Event('input')); });
ok('a typed value snaps to the nearest eighth', (await R(() => facility().settings.target)) === 1.25);
/* A settings edit has to reach the server. Until now it did not: the facility's settings were shared with
   the snapshot, so save() compared an object with itself and the facility was never restamped. */
await sleep(1200); await R(() => Sync.sync('t')); await sleep(2000);
const srv = (await rows()).find(r => r.kind === 'facility').body.settings;
ok('an edit made in Preferences reaches the server', srv.target === 1.25 && JSON.stringify(srv.edges) === '[0.875,1.5,1.625,2]' && srv.settingsVersion === 2, JSON.stringify(srv));
ok('the steppers move in eighths from 1/2 to 3', await R(() => ['targetIn', 'floodIn', 'shaveIn'].every(id => { const e = document.getElementById(id); return e.step === '0.125' && e.min === '0.5' && e.max === '3'; })));

await ctx.close(); await b.close();
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
