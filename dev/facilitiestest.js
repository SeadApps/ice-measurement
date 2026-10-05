/* The Facilities and Sheets pages.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/facilitiestest.js

   Cards and the Fleet table agree with each other and with Ice about what is
   overdue; the toggle is remembered per device; the trend is the real average of
   the real readings; adding a facility or a sheet goes through the store; a Staff
   person sees only their facilities and no add buttons; and opening the shell
   restamps nothing, on a device that holds records or one that holds none. */
const k = require('./shellkit');
const { ok, sleep, B, text, rows, stamps } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280);
const p = D.p;
await p.goto(B + '/index.html'); await k.signIn(p);

/* ---- cards ------------------------------------------------------------------------------- */
const cards = await p.$$eval('#facRows .frow', r => r.map(x => ({ id: x.dataset.fid, t: x.textContent })));
ok('one card per facility, in order', cards.map(c => c.id).join() === 'f1,f2', JSON.stringify(cards));
ok('Conway is up to date and Flynn has one overdue, by Flynn\'s own 3-day rule', /All up to date/.test(cards[0].t) && /1 overdue/.test(cards[1].t) && !/overdue/.test(cards[0].t), JSON.stringify(cards));
ok('each says how many sheets it has', /1 sheet(?!s)/.test(cards[0].t) && /2 sheets/.test(cards[1].t));
ok('the count says how many facilities', (await text(p, '#facCount')).trim() === '2 facilities');

/* ---- Ice and the shell agree about what is overdue --------------------------------------------- */
const shellSays = await p.evaluate(() => { const d = Shell.data(), out = {};
  d.facilities.forEach(f => f.sheets.forEach(s => { out[s.id] = Shell.status(d, f, s).over; })); return out; });
/* Ice reads where you are from the shell, so open Flynn in the shell first, as a person would. */
await p.goto(B + '/index.html#/f/f2'); await p.waitForSelector('#page .screen'); await sleep(500);
await p.goto(B + '/ice.html'); await sleep(2500);
const iceFlynn = await p.evaluate(() => [...document.querySelectorAll('#fleet .fl-row')].map(r => [r.textContent, r.className.includes('over')]));
ok('Ice calls Flynn\'s Standard overdue, as the shell does', shellSays.s2 === true && iceFlynn.some(r => /Standard/.test(r[0]) && r[1] === true), JSON.stringify(iceFlynn));
ok('and Flynn\'s Mini, which has no rounds, is not overdue in either', shellSays.s3 === false && !iceFlynn.some(r => /Mini/.test(r[0]) && r[1] === true));
await p.goto(B + '/index.html#/f/f1'); await p.waitForSelector('#page .screen'); await sleep(500);
await p.goto(B + '/ice.html'); await sleep(2500);
const iceConway = await p.evaluate(() => [...document.querySelectorAll('#fleet .fl-row')].map(r => r.className.includes('over')));
ok('Ice agrees Conway is not overdue (7 days, last round 2 days ago)', shellSays.s1 === false && iceConway.every(x => x === false), JSON.stringify(iceConway));

/* ---- readings are read the same way in both places ------------------------------------------------- */
const same = await p.evaluate(() => OPTIONS.every(o => Records.readingValue(o) === decOf.get(o)));
ok('the store\'s reading parser agrees with Ice on every one of its sixteen labels', same);

/* ---- the Fleet table ------------------------------------------------------------------------------------- */
await p.goto(B + '/index.html#/'); await p.waitForSelector('#page .screen'); await sleep(500);
ok('cards are the default', (await p.getAttribute('#viewCards', 'aria-pressed')) === 'true' && !(await p.$('#fleetTable')));
await p.click('#viewFleet'); await sleep(400);
const trs = await p.$$eval('#fleetTable tbody tr', r => r.map(x => [...x.children].map(c => c.textContent)));
ok('the Fleet table has a row per sheet', trs.length === 3, JSON.stringify(trs));
ok('with facility, sheet, last round, ice and glass', trs[0][0] === 'Conway Arena' && trs[0][1] === 'Main' && trs[1][1] === 'Standard' && trs[2][1] === 'Mini', JSON.stringify(trs));
ok('and agrees with the cards: Standard overdue by 6 days, Main up to date, Mini no rounds', /Overdue 6 days/.test(trs[1][3]) && /Up to date/.test(trs[0][3]) && /No rounds yet/.test(trs[2][3]), JSON.stringify(trs.map(t => t[3])));
ok('Glass says it has not been loaded on a device that never opened it', trs.every(t => /Glass not loaded/.test(t[4])));
await p.reload(); await p.waitForSelector('#page .screen'); await sleep(500);
ok('the choice is remembered on this device', !!(await p.$('#fleetTable')) && (await p.getAttribute('#viewFleet', 'aria-pressed')) === 'true');
await p.click('#fleetTable tbody tr:nth-child(3)'); await sleep(600);
ok('a row opens that sheet', (await p.evaluate(() => location.hash)) === '#/f/f2/s/s3');
await p.goto(B + '/index.html#/'); await p.waitForSelector('#page .screen'); await p.click('#viewCards'); await sleep(300);

/* ---- sheets and the trend ---------------------------------------------------------------------------------- */
await p.goto(B + '/index.html#/f/f1'); await p.waitForSelector('#page .screen'); await sleep(500);
const label = await p.$eval('#sheetRows .srow[data-sid="s1"] svg', s => s.getAttribute('aria-label'));
ok('Conway\'s trend is the average of its last two rounds: 1.4375 then 1.5', /last 2 rounds, now 1\.50 inches/.test(label), label);
ok('drawn as a line with an end point', !!(await p.$('#sheetRows .srow[data-sid="s1"] polyline')) && !!(await p.$('#sheetRows .srow[data-sid="s1"] circle')));
const trend = await p.evaluate(() => Records.trendOf(Shell.data().sessions, 's1', 10).map(t => +t.avg.toFixed(4)));
ok('the numbers are the real averages, oldest first', JSON.stringify(trend) === '[1.4375,1.5]', JSON.stringify(trend));
ok('the size and last round are on the row', /200′ × 85′/.test(await text(p, '#sheetRows .srow')) && /2 days ago/.test(await text(p, '#sheetRows .srow')));
await p.goto(B + '/index.html#/f/f2'); await p.waitForSelector('#page .screen'); await sleep(500);
ok('Standard has one round, so one point and no line', !!(await p.$('.srow[data-sid="s2"] circle')) && !(await p.$('.srow[data-sid="s2"] polyline')));
ok('Mini says No rounds yet, in its own box', /No rounds yet/.test(await text(p, '.srow[data-sid="s3"] .trend .empty')));
ok('Mini\'s size is its own', /120′ × 60′/.test(await text(p, '.srow[data-sid="s3"]')));

/* ---- adding ---------------------------------------------------------------------------------------------------- */
await p.goto(B + '/index.html#/'); await p.waitForSelector('#page .screen'); await sleep(500);
await p.click('#addFac'); await sleep(400);
ok('Add facility opens a form in the page, not a browser dialog', !!(await p.$('#addForm #addName')) && !!(await p.$('#addSize')));
await p.click('#addGo'); await sleep(300);
ok('an empty name is refused, and says so', /Name the facility first/.test(await text(p, '#addNote')) && (await p.$$('#facRows .frow')).length === 2);
await p.fill('#addName', '<b id="boom">Hartford</b> Rink'); await p.fill('#addSheetName', 'Rink 1'); await p.selectOption('#addSize', 'olympic').catch(() => {});
const before = await stamps();
await p.click('#addGo'); await sleep(2500);
ok('the facility appears', (await p.$$('#facRows .frow')).length === 3 && /Hartford/.test(await text(p, '#facRows')));
ok('and what was typed is text, whatever it looks like', !(await p.$('#boom')) && (await text(p, '#facRows')).includes('<b id="boom">Hartford</b> Rink'));
const srv = await rows();
const nf = srv.find(r => r.kind === 'facility' && /Hartford/.test(r.body.name));
ok('it reached the server with its sheet and first round, all tagged with it', !!nf && srv.some(r => r.kind === 'sheet' && r.body.facilityId === nf.id && r.body.fac === nf.id && r.body.name === 'Rink 1')
   && srv.some(r => r.kind === 'session' && r.body.fac === nf.id), JSON.stringify(srv.filter(r => r.body.fac === (nf && nf.id)).map(r => r.kind)));
const after = JSON.parse(await stamps()), was = JSON.parse(before);
ok('and nothing else was restamped', after.filter(r => was.some(w => w[0] === r[0] && w[1] === r[1] && w[2] !== r[2])).length === 0);
await p.click('#facRows .frow:nth-child(3)'); await sleep(600);
await p.click('#addSheet'); await p.fill('#addName', 'Practice'); await p.click('#addGo'); await sleep(2500);
ok('Add sheet adds one to the facility you are in', (await p.$$('#sheetRows .srow')).length === 2 && /Practice/.test(await text(p, '#sheetRows')));
ok('and the count says so', (await text(p, '#sheetCount')).trim() === '2 sheets');
const srv2 = await rows();
ok('that sheet is tagged with its facility on the server', srv2.some(r => r.kind === 'sheet' && r.body.name === 'Practice' && r.body.facilityId === nf.id && r.body.fac === nf.id));

/* ---- looking writes nothing --------------------------------------------------------------------------------------- */
const s0 = await stamps();
for (const h of ['#/', '#/f/f1', '#/f/f2', '#/f/f2/s/s3', '#/']) { await p.goto(B + '/index.html' + h); await p.waitForSelector('#page .screen'); await sleep(500); }
await p.evaluate(() => Sync.sync('t')); await sleep(2000);
ok('opening every page, and syncing, restamps nothing on a device that holds records', s0 === await stamps());
await D.ctx.close();

/* ---- a device with nothing ------------------------------------------------------------------------------------------ */
await fetch(B + '/__reset');
const E = await k.device(b, 1280);
await E.p.goto(B + '/index.html'); await k.signIn(E.p);
ok('an empty device shows an empty Facilities page, and says why', !!(await E.p.$('#noFacilities')) && /No facilities on this device yet/.test(await text(E.p, '#noFacilities')));
ok('it invents no facility', !(await E.p.evaluate(() => localStorage.getItem('ice_v4_facilities'))) || (await E.p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}')).length)) === 0);
await E.p.evaluate(() => Sync.sync('t')); await sleep(1500);
ok('and sends nothing', (await rows()).length === 0);
await E.p.goto(B + '/index.html#/f/anything'); await E.p.waitForSelector('#page .screen'); await sleep(500);
ok('an address on an empty device is just the unavailable message', /That page is not available/.test(await text(E.p, '#page .notice')));
await E.p.click('#addFac'); await E.p.fill('#addName', 'First Rink'); await E.p.click('#addGo'); await sleep(2500);
ok('but the first facility can be added from it (nothing has to arrive first)', /First Rink/.test(await text(E.p, '#facRows')) && (await rows()).some(r => r.kind === 'facility' && r.body.name === 'First Rink'));
await E.ctx.close();

/* ---- people --------------------------------------------------------------------------------------------------------- */
await fetch(B + '/__reset');
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await k.addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['f2'] });
await k.ctl('tight=1');
await k.seed(k.PETE);
const S = await k.device(b, 1280);
await S.p.goto(B + '/index.html'); await k.signInAs(S.p, 'flo', 'flo-code-1');
ok('a Staff person sees only their facility', (await S.p.$$eval('#facRows .frow', r => r.map(x => x.dataset.fid))).join() === 'f2' && (await text(S.p, '#facCount')).trim() === '1 facility');
ok('and has no add buttons', !(await S.p.$('#addFac')));
await S.p.goto(B + '/index.html#/f/f2'); await S.p.waitForSelector('#page .screen'); await sleep(500);
ok('nor on the sheets page', !(await S.p.$('#addSheet')));
ok('but can open an app on any of the sheets', (await S.p.$$('#sheetRows [data-open="ice"]')).length === 2);
await S.ctx.close();

const M = await k.device(b, 1280);
await M.p.goto(B + '/index.html'); await k.signInAs(M.p, 'pete', 'pete-code-1');
ok('Management sees every facility and the add button', (await M.p.$$('#facRows .frow')).length === 2 && !!(await M.p.$('#addFac')));
ok('which is greyed until they unlock, as every edit control is', await M.p.evaluate(() => document.body.classList.contains('sync-locked')));
await M.p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(600);
ok('and live once they have', !(await M.p.evaluate(() => document.body.classList.contains('sync-locked'))));
await M.p.click('#addFac'); await M.p.fill('#addName', 'Hartford'); await M.p.click('#addGo'); await sleep(2800);
ok('Management adds a facility, which the server accepts under their name', (await rows()).some(r => r.kind === 'facility' && r.body.name === 'Hartford' && r.changed_by_name === 'Pete'));
await M.ctx.close();

await k.done(b);
})();
