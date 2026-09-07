/* G1: Glass knows about facilities, and panel ids are scoped without a migration.
   Plus the rebind: the glass belongs to an ice surface, not to the building.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/facilitytest.js

   The load-bearing claim is that nothing already on the server changes. Conway's
   127 panels keep bare record ids for good; only facilities added later get
   "<facilityId>:<panelId>". So a device still running the old Glass code stays
   consistent with a device running the new one, and there is no one-shot
   migration that has to be right first time.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const CFG = { url: B, anon: 'test', email: 'operations@conwayarena.local' };
const CODE = 'test-access-code';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, CFG);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', CODE);
  await p.click('.sync-gate button');
  await sleep(4000);
}
const rows = async () => (await (await fetch(B + '/__rows')).json());
const row = async (kind, id) => (await rows()).find(r => r.kind === kind && r.id === id);

/* Writes a record straight to the server, so a row in a shape this build no
   longer produces can still be put in front of it. */
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

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();

/* ---- the Ice app creates the facility, as it always has ---- */
const I = await device(b);
await I.p.goto(B + '/ice.html'); await signIn(I.p);
await I.p.evaluate(() => { facility().name = 'Conway Arena'; persist(); });
await sleep(4000);
const facRow = (await rows()).find(r => r.kind === 'facility');
ok('Ice put a facility on the server', !!facRow && facRow.body.name === 'Conway Arena',
   facRow && JSON.stringify(facRow.body));
await I.ctx.close();

/* ---- Glass picks it up and names itself after it ---- */
const G = await device(b);
await G.p.goto(B + '/glass.html'); await signIn(G.p);
await sleep(2000);

const shRow = await row('sheet', (await rows()).find(r => r.kind === 'sheet').id);
ok('Glass shows the facility name', (await G.p.textContent('#facName')).trim() === 'Conway Arena',
   await G.p.textContent('#facName'));
ok('and bound the legacy bucket to its ice surface',
   (await G.p.evaluate(() => boundSheetId)) === shRow.id,
   'bound=' + (await G.p.evaluate(() => boundSheetId)) + ' sheet=' + shRow.id);
/* One surface, so the sheet name would only be noise over the plan. */
ok('a single-sheet facility is not suffixed with the sheet name',
   !(await G.p.textContent('#facName')).includes(' - '),
   await G.p.textContent('#facName'));

/* ---- a mark still travels under a bare id ---- */
await G.p.evaluate(() => set('045', { status: 'replace', note: 'cracked' }));
await sleep(4000);
const all = await rows();
const bare = all.find(r => r.kind === 'glass_panel' && r.id === '045');
ok('panel 045 keeps its bare record id', !!bare,
   JSON.stringify(all.filter(r => r.kind === 'glass_panel').map(r => r.id)));
ok('no scoped id was invented for it',
   !all.some(r => r.kind === 'glass_panel' && r.id.indexOf(':') >= 0));
ok('the binding synced too', all.some(r => r.kind === 'glass_binding' && r.id === 'legacy'));
const bind = all.find(r => r.kind === 'glass_binding' && r.id === 'legacy');
ok('the binding names the sheet', bind && bind.body.sheetId === shRow.id,
   bind && JSON.stringify(bind.body));
/* Kept beside it so a device still on the facility-bound build reads a binding
   it understands, instead of seeing an empty one and re-binding on its own. */
ok('and still names the facility, for a device on the old build',
   bind && bind.body.facilityId === facRow.id, bind && JSON.stringify(bind.body));

/* Glass must never push the facility records it only reads. */
const facStamp = (await rows()).find(r => r.kind === 'facility').updated_at;
const shStamp = (await row('sheet', shRow.id)).updated_at;
await G.p.evaluate(() => Sync.sync('again')); await sleep(3000);
ok('Glass never restamps the facility',
   (await rows()).find(r => r.kind === 'facility').updated_at === facStamp);
ok('nor the sheet', (await row('sheet', shRow.id)).updated_at === shStamp);
await G.ctx.close();

/* ---- a second facility's panels are scoped, and stay out of Conway's ---- */
const H = await device(b);
await H.p.goto(B + '/glass.html'); await signIn(H.p);
await sleep(2500);
ok('a second device receives the mark', (await H.p.evaluate(() =>
  (bucketOf('legacy')['045'] || {}).status)) === 'replace');

await H.p.evaluate(() => {
  bucketOf('rink2')['045'] = { status: 'plexi', note: 'other rink', by: '', at: '2026-09-06',
                               updatedAt: new Date().toISOString() };
  store();
});
await sleep(4000);
const after = await rows();
ok('the other facility writes a scoped id',
   after.some(r => r.kind === 'glass_panel' && r.id === 'rink2:045'),
   JSON.stringify(after.filter(r => r.kind === 'glass_panel').map(r => r.id)));
ok("and Conway's 045 is untouched by it",
   after.find(r => r.kind === 'glass_panel' && r.id === '045').body.status === 'replace');

/* The two must not bleed into one another on a device that pulls both. */
const K = await device(b);
await K.p.goto(B + '/glass.html'); await signIn(K.p);
await sleep(3000);
const split = await K.p.evaluate(() => ({
  legacy: (bucketOf('legacy')['045'] || {}).status,
  rink2:  (bucketOf('rink2')['045']  || {}).status
}));
ok('a third device keeps the two apart',
   split.legacy === 'replace' && split.rink2 === 'plexi', JSON.stringify(split));
ok('and still draws Conway, not the other one',
   (await K.p.evaluate(() => activeBucket)) === 'legacy');
await K.ctx.close(); await H.ctx.close();

/* ---- a binding written by the facility-bound build, on the wire ---- */

/* The shape the old code pushed: a facility, no sheet. Every device has to
   land on the same surface from it, without rewriting the row to say so. */
await seed({ id: 'legacy', kind: 'glass_binding',
             body: { id: 'legacy', facilityId: facRow.id }, deleted: false });
const oldStamp = (await row('glass_binding', 'legacy')).updated_at;

const N = await device(b);
await N.p.goto(B + '/glass.html'); await signIn(N.p);
await sleep(3000);
ok('a facility-only binding resolves to that facility\'s first surface',
   (await N.p.evaluate(() => boundSheetId)) === shRow.id,
   'bound=' + (await N.p.evaluate(() => boundSheetId)) + ' sheet=' + shRow.id);
ok('and resolving it leaves the row on the server alone',
   (await row('glass_binding', 'legacy')).updated_at === oldStamp);
ok('the page is still named after the facility',
   (await N.p.textContent('#facName')).trim() === 'Conway Arena',
   await N.p.textContent('#facName'));
await N.ctx.close();

/* ---- and the same binding sitting in a device's own storage ---- */

/* bindingAt is dated past anything the server holds, so the row above cannot
   answer this for it - the stored facility id is the only route to a sheet. */
const M = await device(b);
await M.p.goto(B + '/glass.html');
await M.p.evaluate(fid => localStorage.setItem('glass_record_v2', JSON.stringify({
  records: { legacy: {} }, who: '', boundFacilityId: fid,
  bindingAt: '2099-01-01T00:00:00.000Z', activeBucket: 'legacy', names: {}, built: {} })), facRow.id);
await M.p.reload(); await signIn(M.p); await sleep(3000);
ok('a stored facility binding resolves the same way',
   (await M.p.evaluate(() => boundSheetId)) === shRow.id,
   'bound=' + (await M.p.evaluate(() => boundSheetId)) + ' sheet=' + shRow.id);
ok('and nothing is left waiting once it has',
   (await M.p.evaluate(() => pendingFacilityId)) === null);
await M.ctx.close();

/* ---- a second ice surface, which is the whole reason for the rebind ---- */

/* Conway has one sheet, which is why binding the glass to the building looked
   right here. Give the facility a second surface and the two facts come apart:
   an arena with two sheets has two sets of glass. */
const I2 = await device(b);
await I2.p.goto(B + '/ice.html'); await signIn(I2.p);
await I2.p.evaluate(() => { facility().sheets.push(newSheet('Olympic sheet')); persist(); });
await sleep(4000);
const sheetIds = (await rows()).filter(r => r.kind === 'sheet').map(r => r.id);
ok('Ice put a second sheet on the server', sheetIds.length === 2, JSON.stringify(sheetIds));
await I2.ctx.close();

const P = await device(b);
await P.p.goto(B + '/glass.html'); await signIn(P.p);
await sleep(3000);
ok('the glass stays on the surface it was bound to',
   (await P.p.evaluate(() => boundSheetId)) === shRow.id,
   'bound=' + (await P.p.evaluate(() => boundSheetId)) + ' sheet=' + shRow.id);
/* Now that the building has two, saying only "Conway Arena" over the plan
   would no longer tell you which set of glass you are looking at. */
ok('and the name now says which surface it is',
   (await P.p.textContent('#facName')).trim() === 'Conway Arena - Main sheet',
   await P.p.textContent('#facName'));
await P.ctx.close();

/* ---- an old device, still keyed on glass_record_v1, comes across ---- */
const L = await device(b);
await L.p.goto(B + '/glass.html');
await L.p.evaluate(() => localStorage.setItem('glass_record_v1', JSON.stringify({
  who: 'Pete', panels: { '007': { status: 'plexi', note: 'from the old format', at: '2026-08-01' } } })));
await L.p.evaluate(() => localStorage.removeItem('glass_record_v2'));
await L.p.reload(); await sleep(1500);
ok('the v1 record migrates into the legacy bucket',
   (await L.p.evaluate(() => (bucketOf('legacy')['007'] || {}).status)) === 'plexi');
ok('and the marked-by name comes with it',
   (await L.p.evaluate(() => who)) === 'Pete');
ok('v1 is left in place as a fallback',
   await L.p.evaluate(() => !!localStorage.getItem('glass_record_v1')));
await L.ctx.close();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
})();
