/* The shell reads where you are from the address and from nothing else.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/routetest.js

   Every address opens the right page; reload, back and a bookmark return to the
   same place; an address that names nothing, or something this person was not
   given, lands on Facilities with the same message either way, so it never says
   which. The shell is the only writer of where you are, and the apps read it. */
const k = require('./shellkit');
const { ok, sleep, B, text } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();

/* ---- nothing is shown before the gate --------------------------------------------- */
const G = await k.device(b);
await G.p.goto(B + '/index.html'); await sleep(1500);
const before = await G.p.evaluate(() => document.body.textContent);
ok('before the code, no facility name is anywhere on the page', !/Conway|Flynn/.test(before), before.slice(0, 120));
ok('and no shell is drawn', !(await G.p.$('.app')) && !(await G.p.$('#page')));
await k.signIn(G.p);
ok('after it, the shell appears', !!(await G.p.$('.app')));

/* ---- every address, the right page -------------------------------------------------- */
const at = async hash => { await G.p.goto(B + '/index.html' + hash); await G.p.waitForSelector('#page .screen', { timeout: 8000 }); await sleep(500); };
const page = () => G.p.evaluate(() => (document.querySelector('#page .screen') || {}).id || '');
await at('#/');
ok('#/ is Facilities', await page() === 'pageFacilities' && /Conway Arena/.test(await text(G.p, '#page')) && /Flynn Rink/.test(await text(G.p, '#page')));
await at('');
ok('and so is no address at all', await page() === 'pageFacilities');
await at('#/f/f2');
ok('#/f/FID is that facility\'s sheets', await page() === 'pageSheets' && /Flynn Rink/.test(await text(G.p, '#page h2')) && !/Conway/.test(await text(G.p, '#page')));
ok('with both of its sheets', (await G.p.$$('#sheetRows .srow')).length === 2);
await at('#/f/f2/s/s3');
ok('#/f/FID/s/SID is the same page with that sheet in hand', await page() === 'pageSheets' && /Mini/.test(await text(G.p, '#sheetMenu')), await text(G.p, '#sheetMenu'));
await at('#/f/f2/s/s2/settings');
ok('/settings is the sheet settings page', await page() === 'pageSettings' && /Sheet settings/.test(await text(G.p, '#page h2')) && /Flynn Rink/.test(await text(G.p, '#page .crumb')));

/* ---- an address that names nothing ---------------------------------------------------- */
const msgs = [];
for (const bad of ['#/f/nope', '#/f/f1/s/nope', '#/f/f2/s/s1', '#/banana', '#/f', '#/f/f1/s/s1/extra/more', '#/staff']) {
  await G.p.goto(B + '/index.html#/'); await sleep(300);
  await G.p.goto(B + '/index.html' + bad); await G.p.waitForSelector('#page .screen', { timeout: 8000 }); await sleep(500);
  msgs.push([bad, await page(), (await text(G.p, '#page .notice')).trim(), await G.p.evaluate(() => location.hash)]);
}
ok('each lands on Facilities', msgs.every(m => m[1] === 'pageFacilities'), JSON.stringify(msgs));
ok('with one message, the same for all of them', new Set(msgs.map(m => m[2])).size === 1 && msgs[0][2] === 'That page is not available.', JSON.stringify(msgs.map(m => m[2])));
ok('and the address is corrected, so a reload does not say it again', msgs.every(m => m[3] === '#/'), JSON.stringify(msgs.map(m => m[3])));
ok('a sheet of another facility is treated like one that does not exist', msgs[2][2] === msgs[0][2]);
ok('the Staff address does not exist before people do', msgs[6][2] === msgs[0][2]);

/* ---- reload, back, bookmark ------------------------------------------------------------ */
await at('#/f/f2');
await G.p.reload(); await G.p.waitForSelector('#page .screen'); await sleep(600);
ok('a reload stays where it was', await page() === 'pageSheets' && /Flynn Rink/.test(await text(G.p, '#page h2')));
await G.p.evaluate(() => { location.hash = '#/'; }); await sleep(500);
await G.p.evaluate(() => { location.hash = '#/f/f1'; }); await sleep(500);
await G.p.evaluate(() => { location.hash = '#/f/f2'; }); await sleep(500);
ok('walking forward lands on the last one', /Flynn Rink/.test(await text(G.p, '#page h2')));
await G.p.goBack(); await sleep(600);
ok('back goes to the one before', /Conway Arena/.test(await text(G.p, '#page h2')), await text(G.p, '#page h2'));
await G.p.goBack(); await sleep(600);
ok('and before that', await page() === 'pageFacilities');
await G.p.goForward(); await sleep(600);
ok('forward comes back', /Conway Arena/.test(await text(G.p, '#page h2')));
await G.p.click('#logo'); await sleep(500);
ok('the logo returns to Facilities', await page() === 'pageFacilities' && (await G.p.evaluate(() => location.hash)) === '#/');
await G.p.click('#facMenu'); await G.p.click('.dropdown .it:has-text("Flynn Rink")'); await sleep(600);
ok('the facility menu changes place from any page', await page() === 'pageSheets' && /Flynn Rink/.test(await text(G.p, '#page h2')));
await G.p.click('#sheetMenu'); await G.p.click('.dropdown .it:has-text("Mini")'); await sleep(600);
ok('and so does the sheet menu', (await G.p.evaluate(() => location.hash)) === '#/f/f2/s/s3' && /Mini/.test(await text(G.p, '#sheetMenu')));

/* ---- the shell is the one writer of where you are, and the apps read it ---------------- */
const prefs = () => G.p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs') || '{}'));
await at('#/f/f1');
let pr = await prefs();
ok('opening a facility makes it where you are', pr.activeFacility === 'f1' && pr.activeSheet === 's1', JSON.stringify(pr));
await at('#/f/f2/s/s3');
pr = await prefs();
ok('and a sheet makes that the sheet', pr.activeFacility === 'f2' && pr.activeSheet === 's3', JSON.stringify(pr));
await at('#/f/f2');
ok('a facility with no sheet named keeps the sheet you were on there', (await prefs()).activeSheet === 's3');
await at('#/f/f1');
await at('#/');
ok('Facilities is not a place: where you are is left as it was', (await prefs()).activeSheet === 's1');

await at('#/f/f2');
await G.p.click('#sheetRows .srow[data-sid="s2"] [data-open="ice"]');
await G.p.waitForURL(/ice\.html/, { timeout: 8000 }); await sleep(2500);
ok('Ice Manager opens at the address of that sheet', /ice\.html#\/f\/f2\/s\/s2$/.test(G.p.url()), G.p.url());
ok('and Ice is on that sheet, read from where the shell put it', await G.p.evaluate(() => sheet().id) === 's2' && await G.p.evaluate(() => facility().id) === 'f2');
await G.p.goto(B + '/index.html#/f/f2/s/s3'); await G.p.waitForSelector('#page .screen'); await sleep(500);
await G.p.click('#appSw a:has-text("Glass")');
await G.p.waitForURL(/glass\.html/, { timeout: 8000 }); await sleep(2500);
ok('the Ice | Glass switch keeps the sheet', /glass\.html#\/f\/f2\/s\/s3$/.test(G.p.url()), G.p.url());
ok('and Glass is pointed at it', (await G.p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs')).activeSheet)) === 's3');
await G.ctx.close();

/* ---- a Staff person is given one facility ------------------------------------------------- */
await fetch(B + '/__reset');
await addPeople();
await ctlTight();
await k.seed(k.PETE);
const S = await k.device(b);
await S.p.goto(B + '/index.html'); await k.signInAs(S.p, 'flo', 'flo-code-1');
const seen = await text(S.p, '#page');
ok('Flo sees Flynn and not Conway', /Flynn Rink/.test(seen) && !/Conway/.test(seen), seen.slice(0, 160));
await S.p.click('#facMenu');
ok('the facility menu lists only hers', (await S.p.$$eval('.dropdown .it', e => e.map(x => x.textContent))).join() === 'Flynn Rink');
await S.p.keyboard.press('Escape');
await S.p.goto(B + '/index.html#/f/f1'); await S.p.waitForSelector('#page .screen'); await sleep(700);
const flo1 = (await text(S.p, '#page .notice')).trim();
await S.p.goto(B + '/index.html#/f/nope'); await S.p.waitForSelector('#page .screen'); await sleep(700);
const flo2 = (await text(S.p, '#page .notice')).trim();
ok('Conway\'s address is the same message as one that does not exist', flo1 === 'That page is not available.' && flo1 === flo2, flo1 + ' | ' + flo2);
await S.p.goto(B + '/index.html#/staff'); await S.p.waitForSelector('#page .screen'); await sleep(700);
ok('and the Staff page is not hers, even by address', (await text(S.p, '#page .notice')).trim() === 'That page is not available.' && !(await S.p.$('#rail a[href="#/staff"]')));
await S.ctx.close();

const M = await k.device(b);
await M.p.goto(B + '/index.html'); await k.signInAs(M.p, 'pete', 'pete-code-1');
ok('Pete, who is Management, sees both', /Conway Arena/.test(await text(M.p, '#page')) && /Flynn Rink/.test(await text(M.p, '#page')));
ok('and the Staff page is in his rail', !!(await M.p.$('#rail a[href="#/staff"]')));
await M.p.goto(B + '/index.html#/staff'); await M.p.waitForSelector('#page .screen'); await sleep(700);
ok('and opens for him', /Staff/.test(await text(M.p, '#page h2')) && !(await text(M.p, '#page .notice')));
await M.ctx.close();

/* ---- a shared iPad: Pete has been here, so Conway is on the device when Flo signs in ---------- */
const X = await k.device(b);
await X.p.goto(B + '/index.html'); await k.signInAs(X.p, 'pete', 'pete-code-1');
ok('(setup) Conway is on the device', (await X.p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}')))).includes('f1'));
await X.p.evaluate(() => Sync.switchUser()); await sleep(1500);
await X.p.waitForSelector('.sync-gate .sync-name[data-id="flo"]', { timeout: 8000 });
await X.p.click('.sync-gate .sync-name[data-id="flo"]');
await X.p.fill('.sync-gate #sg-personal', 'flo-code-1'); await X.p.click('.sync-gate .sync-go');
await sleep(3500);
const shared = await X.p.evaluate(() => document.body.textContent);
ok('the data is still there, and Flo is not shown it', (await X.p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}')))).includes('f1') && !/Conway/.test(shared) && /Flynn Rink/.test(shared), shared.slice(0, 200));
await X.p.goto(B + '/index.html#/f/f1'); await X.p.waitForSelector('#page .screen'); await sleep(800);
ok('and the address of Conway is not hers either', (await text(X.p, '#page .notice')).trim() === 'That page is not available.' && !/Conway/.test(await X.p.evaluate(() => document.body.textContent)));
await X.ctx.close();

await k.done(b);

async function addPeople() {
  await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
  await k.addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['f2'] });
}
async function ctlTight() { await k.ctl('tight=1'); }
})();
