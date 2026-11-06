/* Removing a whole facility, and bringing it back.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/facremovetest.js

   Management hides a facility and its sheets in one step, asked in the page. Every round is kept, nothing
   else is restamped, the last facility cannot go, it can be undone at once or later from the Facilities
   page, a sheet removed on its own beforehand stays removed, the removal reaches another device, and Staff
   are not offered it. */
const k = require('./shellkit');
const { ok, sleep, B, text, rows } = k;

const live = async (kind) => (await rows()).filter(r => r.kind === kind && !r.deleted && !(r.data && r.data.deleted));
const isGone = r => r.deleted || (r.data && r.data.deleted);
const open = async (p, hash) => { await p.goto(B + '/index.html' + hash); await p.waitForSelector('#page .screen'); await sleep(500); };

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280), p = D.p;
await p.goto(B + '/index.html'); await k.signIn(p);

await open(p, '#/f/f2');
ok('the facility page offers Remove facility', !!(await p.$('#fask')) && !(await p.$eval('#fask', e => e.disabled)));
await p.click('#fask'); await sleep(200);
ok('asking is in the page, names the facility and its sheets', /Hide.*Flynn Rink.*2 sheets.*kept/s.test(await text(p, '#removeFacZone')) && !!(await p.$('#fyes')));
await p.click('#fno'); await sleep(200);
ok('Keep it changes nothing', !!(await p.$('#fask')) && (await rows()).filter(isGone).length === 0);

await p.click('#fask'); await sleep(200); await p.click('#fyes'); await sleep(1500);
await p.evaluate(() => Sync.sync('t')); await sleep(1500);
ok('it lands on Facilities with the facility gone from the list', /#\/$/.test(await p.evaluate(() => location.hash)) && !/Flynn/.test(await text(p, '#facRows')));
ok('and an undo banner', /Flynn Rink has been hidden/.test(await text(p, '#removedFacBanner')));
const all = await rows();
const gone = all.filter(isGone).map(r => r.id).sort().join();
ok('the facility and both its sheets are hidden on the server', gone === 'f2,s2,s3', gone);
ok('no round was touched or hidden', all.filter(r => r.kind === 'session').every(r => !isGone(r)) && all.filter(r => r.kind === 'session').length === 4);
ok('Conway is untouched', all.filter(r => r.id === 'f1' || r.id === 's1').every(r => !isGone(r)));

await p.click('#undoRemoveFac'); await sleep(1200);
await p.evaluate(() => Sync.sync('t')); await sleep(1500);
ok('Undo brings the facility back', /Flynn/.test(await text(p, '#facRows')) && (await rows()).filter(isGone).length === 0);
await open(p, '#/f/f2');
ok('with both its sheets and their rounds', /2 sheets/.test(await text(p, '#sheetCount')));

/* a sheet hidden on its own earlier stays hidden through remove and bring back */
await open(p, '#/f/f2/s/s3/settings'); await p.click('#dask'); await p.click('#dyes'); await sleep(1200);
await open(p, '#/f/f2'); await p.click('#fask'); await p.click('#fyes'); await sleep(1500);
await open(p, '#/');
ok('the facility is listed under Removed facilities', /Flynn Rink/.test(await text(p, '#removedFacList')));
await p.click('[data-restore="f2"]'); await sleep(1500);
await open(p, '#/f/f2');
ok('bringing it back later restores its sheet but not the one removed before', /1 sheet/.test(await text(p, '#sheetCount')) && /Standard/.test(await text(p, '#sheetRows')) && !/Mini/.test(await text(p, '#sheetRows')));

/* the last facility cannot go */
await open(p, '#/f/f2'); await p.click('#fask'); await p.click('#fyes'); await sleep(1200);
await open(p, '#/f/f1');
ok('the last facility cannot be removed, and the page says why', await p.$eval('#fask', e => e.disabled) && /At least one facility/.test(await text(p, '#removeFacNote')));

/* another device sees it removed */
const E = await k.device(b, 1280);
await E.p.goto(B + '/index.html'); await k.signIn(E.p); await sleep(1500);
ok('another device no longer lists the removed facility', !/Flynn/.test(await text(E.p, '#facRows')) && /Conway/.test(await text(E.p, '#facRows')));
await E.ctx.close();
await D.ctx.close();
await k.done(b);
})();
