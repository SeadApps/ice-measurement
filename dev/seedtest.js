/* A fresh device invents a facility ("Main facility"), a sheet and a round so
   there is something to draw. That is where it starts, not something anybody
   observed. Sent early, it added a phantom facility to everybody's list and
   shifted the real one's order.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/seedtest.js

   The invented records are marked as a seed: kept off the wire while untouched,
   sent whole the moment anybody really edits any part of them, and dropped when
   real facilities arrive. */
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const CFG = { url: B, anon: 'test', email: 'operations@conwayarena.local' };
const CODE = 'test-access-code';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const rows = async () => (await (await fetch(B + '/__rows')).json());
const kinds = async () => (await rows()).filter(r => ['facility', 'sheet', 'session'].includes(r.kind));
const H = t => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, CFG);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', CODE);
  await p.click('.sync-gate button');
  await sleep(3500);
}
const names = p => p.evaluate(() => state.facilities.map(f => f.name));
const T = '2026-09-01T10:00:00.000Z';
async function seedServer() {
  const r = await fetch(B + '/auth/v1/token?grant_type=password', { method: 'POST',
    body: JSON.stringify({ email: CFG.email, password: CODE }) });
  const tok = (await r.json()).access_token;
  const rec = (kind, id, body) => ({ kind, id, deleted: false, body: Object.assign({ id }, body) });
  const res = await fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: H(tok), body: JSON.stringify([
    rec('facility', 'fconway', { name: 'Conway Arena', ord: 0, settings: { target: 1.5, edges: [0.6875, 1.4375, 1.5625, 1.9375] }, updatedAt: T }),
    rec('sheet', 'sconway', { facilityId: 'fconway', name: 'Main sheet', ord: 0, size: { L: 200, W: 85, corner: 28 }, updatedAt: T }),
    rec('session', 'zconway', { sheetId: 'sconway', ord: 0, date: T, mode: 'moderate', data: { '1': 1.5 }, notes: {}, updatedAt: T })]) });
  return res.ok;
}

(async () => {
const b = await chromium.launch();

/* ---- a fresh device, and the building already has records -------------------- */
await fetch(B + '/__reset');
ok('the server holds Conway', await seedServer());
const A = await device(b);
await A.p.goto(B + '/ice.html'); await signIn(A.p);
ok('a fresh device ends up with Conway and nothing else', JSON.stringify(await names(A.p)) === '["Conway Arena"]', JSON.stringify(await names(A.p)));
const srv = await kinds();
ok('and the server gained nothing: no phantom facility', srv.filter(r => r.kind === 'facility').length === 1, JSON.stringify(srv.map(r => r.kind + ':' + (r.body.name || r.id))));
ok('Conway kept its place', srv.find(r => r.kind === 'facility').body.ord === 0);
const local = await A.p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}')).map(f => f.name));
ok('the invented one is gone from the device too, not just hidden', JSON.stringify(local) === '["Conway Arena"]', JSON.stringify(local));
ok('the device is pointed at the real facility', await A.p.evaluate(() => facility().name) === 'Conway Arena');
const stampBefore = JSON.stringify((await kinds()).map(r => [r.id, r.updated_at]).sort());
await A.p.evaluate(() => Sync.sync()); await sleep(1000);
ok('an idle device sends nothing', JSON.stringify((await kinds()).map(r => [r.id, r.updated_at]).sort()) === stampBefore);
await A.ctx.close();

/* ---- a fresh device, and the building has nothing yet ------------------------- */
await fetch(B + '/__reset');
const C = await device(b);
await C.p.goto(B + '/ice.html'); await signIn(C.p);
ok('it still has something to draw', JSON.stringify(await names(C.p)) === '["Main facility"]', JSON.stringify(await names(C.p)));
await C.p.evaluate(() => Sync.sync()); await sleep(1000);
ok('but it has sent none of it', (await kinds()).length === 0, JSON.stringify((await kinds()).map(r => r.kind)));
await C.p.reload(); await sleep(2500);
await C.p.evaluate(() => Sync.sync()); await sleep(1000);
ok('and a reload does not change that', (await kinds()).length === 0 && JSON.stringify(await names(C.p)) === '["Main facility"]');
await C.p.evaluate(() => persist());
await sleep(1500);
ok('saving with nothing changed does not send it either', (await kinds()).length === 0);

/* a real edit sends the whole tree, so a round never arrives under an unknown sheet */
await C.p.evaluate(() => { session().data['5'] = '1 1/4"'; persist(); }); await sleep(2500);
let k = (await kinds()).map(r => r.kind).sort();
ok('a reading in the invented round sends the facility, sheet and round', JSON.stringify(k) === '["facility","session","sheet"]', JSON.stringify(k));
ok('without the mark', (await kinds()).every(r => !('seed' in r.body)), JSON.stringify((await kinds())[0].body));
await C.ctx.close();

/* ---- renaming it is an edit too ------------------------------------------------ */
await fetch(B + '/__reset');
const D = await device(b);
await D.p.goto(B + '/ice.html'); await signIn(D.p);
await D.p.evaluate(() => { facility().name = 'Flynn Rink'; persist(); }); await sleep(2500);
k = (await kinds()).map(r => r.kind).sort();
ok('naming the facility sends the whole tree', JSON.stringify(k) === '["facility","session","sheet"]', JSON.stringify(k));
ok('under the name it was given', (await kinds()).find(r => r.kind === 'facility').body.name === 'Flynn Rink');
await D.ctx.close();

/* ---- the launcher ------------------------------------------------------------------ */
await fetch(B + '/__reset');
const L = await device(b);
await L.p.goto(B + '/ice.html'); await signIn(L.p);
await L.p.goto(B + '/launcher.html'); await sleep(3000);
await L.p.evaluate(() => Sync.sync && Sync.sync()); await sleep(1000);
ok('the launcher does not send an invented facility', (await kinds()).length === 0, JSON.stringify((await kinds()).map(r => r.kind)));
await L.ctx.close();

/* ---- real data arriving after the device has been used offline -------------------- */
await fetch(B + '/__reset');
const E = await device(b);
await E.p.goto(B + '/ice.html'); await signIn(E.p);
ok('(offline-first) it starts on its invention', JSON.stringify(await names(E.p)) === '["Main facility"]');
await seedServer();
await E.p.evaluate(() => Sync.sync()); await sleep(2500);
ok('when Conway arrives the untouched invention goes', JSON.stringify(await names(E.p)) === '["Conway Arena"]', JSON.stringify(await names(E.p)));
ok('and the server still has one facility', (await kinds()).filter(r => r.kind === 'facility').length === 1);

/* a device that really used its facility keeps it */
await fetch(B + '/__reset');
const F = await device(b);
await F.p.goto(B + '/ice.html'); await signIn(F.p);
await F.p.evaluate(() => { session().data['9'] = '1 1/8"'; persist(); }); await sleep(2500);
await seedServer();
await F.p.evaluate(() => Sync.sync()); await sleep(2500);
const fn = await names(F.p);
ok('a facility somebody really used is kept beside the real one', fn.includes('Main facility') && fn.includes('Conway Arena'), JSON.stringify(fn));
await F.ctx.close();

await b.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
