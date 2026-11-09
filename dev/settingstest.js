/* The Sheet settings page.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/settingstest.js

   It writes the name and shape through the store and nothing else: one sheet is
   restamped, no round is touched, an idle device afterwards restamps nothing, and
   Ice then draws the new outline. Nothing is written while you step the numbers; a
   bad corner or an empty name stops the whole save; Staff and a locked session see
   it read-only; and removing a sheet hides it without losing its readings, and can
   be undone. */
const k = require('./shellkit');
const { ok, sleep, B, text, rows, stamps } = k;

const SET = '#/f/f2/s/s2/settings';
const val = (p, key) => p.evaluate(x => document.querySelector('[data-v="' + x + '"]').textContent, key);
const click = async (p, sel, n) => { for (let i = 0; i < (n || 1); i++) await p.click(sel); await sleep(120); };
const localSheet = (p, id) => p.evaluate(i => JSON.parse(localStorage.getItem('ice_v4_sheets') || '{}')[i], id);
const open = async (p, hash) => { await p.goto(B + '/index.html' + (hash || SET)); await p.waitForSelector('#page .screen'); await sleep(500); };

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();
const D = await k.device(b, 1280);
const p = D.p;
await p.goto(B + '/index.html'); await k.signIn(p);

/* ---- what it shows ----------------------------------------------------------------------- */
await open(p);
ok('the page is the sheet\'s settings, under its facility', /Sheet settings/.test(await text(p, '#pageSettings h2')) && /Flynn Rink/.test(await text(p, '#pageSettings .crumb')) && /Standard/.test(await text(p, '#pageSettings .crumb')));
ok('with the sheet\'s name', await p.inputValue('#sname') === 'Standard');
ok('and its size, read as a shape: 200 by 85 with the standard 27′ 2″ corner', await val(p, 'L') === '200′' && await val(p, 'W') === '85′' && await val(p, 'Rft') === '27′' && await val(p, 'Rin') === '2″');
ok('the NHL size is the one marked', await p.getAttribute('[data-pre="nhl"]', 'aria-pressed') === 'true' && await p.getAttribute('[data-pre="custom"]', 'aria-pressed') === 'false');
ok('the readouts say how far the boards go, the corner and the ice', /523\.4/.test(await text(p, '#rdPer')) && /27.\s?2/.test(await text(p, '#rdCorner')) && +(await text(p, '#rdArea')) > 16000);
ok('and the outline is drawn', !!(await p.$('.outline svg rect')));
ok('Glass has not been opened here, and it says it cannot check', /cannot be checked here/.test(await text(p, '#glassNote')));
ok('an unlocked, signed-in-as-nobody session can edit', !(await p.$('#viewOnly')) && !(await p.$eval('#ssave', e => e.disabled)));

/* ---- opening it writes nothing ------------------------------------------------------------- */
const s0 = await stamps();
await open(p, '#/f/f2/s/s3/settings'); await open(p);
await p.evaluate(() => Sync.sync('t')); await sleep(1500);
ok('looking at it restamps nothing', s0 === await stamps());

/* ---- the draft: stepping writes nothing ----------------------------------------------------- */
const before = JSON.stringify(await localSheet(p, 's2'));
await click(p, '[data-s="L"][data-d="1"]', 2);
ok('the length steps by half a foot', await val(p, 'L') === '201′');
await click(p, '[data-s="Rin"][data-d="1"]');
ok('the corner steps by half an inch', await val(p, 'Rin') === '2.5″');
ok('the readouts follow', /524\./.test(await text(p, '#rdPer')) || /52[5-9]\./.test(await text(p, '#rdPer')), await text(p, '#rdPer'));
ok('stepping marks the size Custom', await p.getAttribute('[data-pre="custom"]', 'aria-pressed') === 'true' && await p.getAttribute('[data-pre="nhl"]', 'aria-pressed') === 'false');
ok('and nothing has been written', before === JSON.stringify(await localSheet(p, 's2')) && s0 === await stamps());
await click(p, '[data-s="Rin"][data-d="1"]', 30);
ok('inches stop at 11½', await val(p, 'Rin') === '11.5″');
await click(p, '[data-s="L"][data-d="-1"]', 3);
await p.click('[data-pre="intl"]'); await sleep(200);
ok('a starting size fills in the numbers: Olympic is 200 by 100', await val(p, 'L') === '200′' && await val(p, 'W') === '100′' && await val(p, 'Rft') === '27′' && await val(p, 'Rin') === '2″');
ok('and is the one marked', await p.getAttribute('[data-pre="intl"]', 'aria-pressed') === 'true');
await p.click('[data-pre="nhl"]'); await sleep(200);

/* ---- a corner that cannot fit -------------------------------------------------------------------- */
await click(p, '[data-s="Rft"][data-d="1"]', 17);
ok('a corner too big for the sheet says so, in the page', /too big for this sheet/.test(await text(p, '#shapeProblem')), await text(p, '#pageSettings'));
ok('the readouts dash out and the outline is withheld', (await text(p, '#rdPer')).trim() === '—' && !(await p.$('.outline svg')));
ok('Save is off', await p.$eval('#ssave', e => e.disabled));
await click(p, '[data-s="Rft"][data-d="-1"]', 17);
ok('and comes back with the corner', !(await p.$('#shapeProblem')) && !(await p.$eval('#ssave', e => e.disabled)));

/* ---- an empty name -------------------------------------------------------------------------------- */
await p.fill('#sname', '   '); await click(p, '#ssave'); await sleep(400);
ok('an empty name is refused, with the reason', /needs a name/.test(await text(p, '#saveMsg')), await text(p, '#saveMsg'));
ok('and nothing was written, not even the shape', before === JSON.stringify(await localSheet(p, 's2')) && s0 === await stamps());

/* ---- save ------------------------------------------------------------------------------------------ */
await open(p);
await p.fill('#sname', 'Rink One');
await click(p, '[data-s="W"][data-d="1"]', 10);        // 90 wide
await p.click('[data-opt="red"]'); await p.click('[data-opt="flip"]');
const bs = JSON.parse(await stamps());
const roundsBefore = JSON.stringify((await rows()).filter(r => r.kind === 'session').map(r => [r.id, r.updated_at]));
await click(p, '#ssave'); await sleep(2500);
ok('Save says it saved', /^Saved/.test(await text(p, '#saveMsg')), await text(p, '#saveMsg'));
const sh = await localSheet(p, 's2');
ok('the name and the shape are on the sheet', sh.name === 'Rink One' && sh.shape.W === 90 && sh.shape.start === 'red' && sh.shape.flip === true && sh.shape.L === 200, JSON.stringify(sh));
ok('the older size is kept in step for a device on the older build', sh.size.W === 90);
const srv = (await rows()).find(r => r.kind === 'sheet' && r.id === 's2');
ok('they reached the server in one record, still tagged', srv.body.name === 'Rink One' && srv.body.shape.W === 90 && srv.body.fac === 'f2', JSON.stringify(srv.body));
const as = JSON.parse(await stamps());
const moved = as.filter(r => { const w = bs.find(x => x[0] === r[0] && x[1] === r[1]); return !w || w[2] !== r[2]; });
ok('only that sheet was restamped: no round, no facility, no other sheet', moved.length === 1 && moved[0][0] === 'sheet' && moved[0][1] === 's2', JSON.stringify(moved));
ok('and no round\'s readings moved', roundsBefore === JSON.stringify((await rows()).filter(r => r.kind === 'session').map(r => [r.id, r.updated_at])));
const idle = await stamps();
await p.evaluate(() => Sync.sync('t')); await sleep(1500);
ok('an idle device afterwards restamps nothing', idle === await stamps());
ok('the sheet menu shows the new name', /Rink One/.test(await text(p, '#sheetMenu')) && /Rink One/.test(await text(p, '#rail')));
ok('and the page now shows it as saved (no draft left behind)', await p.inputValue('#sname') === 'Rink One' && await val(p, 'W') === '90′');

/* ---- Ice draws the new outline ------------------------------------------------------------------------- */
await p.goto(B + '/ice.html'); await sleep(2500);
ok('Ice draws the sheet from its shape: 90 wide', await p.evaluate(() => W) === 90 && await p.evaluate(() => sheet().name) === 'Rink One');
ok('with the same corner', Math.abs((await p.evaluate(() => CORNER)) - (27 + 2 / 12)) < 1e-6);
await p.evaluate(() => { /* nothing else changed in Ice's readings */ });
const rd = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('ice_v4_sessions'))).find(s => s.id === 'z3').data);
ok('and the round on that sheet still has its reading', JSON.stringify(rd) === '{"1":"1 1/4\\""}', JSON.stringify(rd));

/* ---- another device ----------------------------------------------------------------------------------------- */
const E = await k.device(b, 1280);
await E.p.goto(B + '/index.html#/f/f2/s/s2/settings'); await k.signIn(E.p); await E.p.waitForSelector('#pageSettings'); await sleep(600);
ok('another device gets the new name and shape', await E.p.inputValue('#sname') === 'Rink One' && await val(E.p, 'W') === '90′' && await E.p.getAttribute('[data-opt="red"]', 'aria-pressed') === 'true');
await E.ctx.close();

/* ---- the glass check ------------------------------------------------------------------------------------------ */
await open(p, '#/f/f2/s/s3/settings');
const reopen = async () => { await p.reload(); await p.waitForSelector('#pageSettings'); await sleep(600); };
await p.evaluate(() => localStorage.setItem('glass_record_v2', JSON.stringify({ records: {}, boundSheetId: null, specs: { s3: { L: 120, W: 60, R: 20 } }, built: {} })));
await reopen();
const verified = await p.evaluate(() => Records.perimeterOf(120, 60, 20));
ok('with glass built for Mini the page says the glass matches', (await p.getAttribute('#glassNote', 'data-state')) === 'ok' && new RegExp(verified.toFixed(1)).test(await text(p, '#glassNote')), await text(p, '#glassNote'));
await click(p, '[data-s="L"][data-d="1"]', 2);
ok('step the length and it says a glass check is needed, with both numbers', (await p.getAttribute('#glassNote', 'data-state')) === 'needed'
   && new RegExp(verified.toFixed(1)).test(await text(p, '#glassNote')) && /not affected/.test(await text(p, '#glassNote')), await text(p, '#glassNote'));
await click(p, '[data-s="L"][data-d="-1"]', 2);
ok('and clears when the size matches again', (await p.getAttribute('#glassNote', 'data-state')) === 'ok');
await p.evaluate(() => localStorage.setItem('glass_record_v2', JSON.stringify({ records: {}, boundSheetId: 's3', specs: {}, built: {} })));
await reopen();
ok('Conway\'s own glass is checked against its survey, 523.4′', /523\.4/.test(await text(p, '#glassNote')) && (await p.getAttribute('#glassNote', 'data-state')) === 'needed');
await p.evaluate(() => localStorage.setItem('glass_record_v2', JSON.stringify({ records: {}, boundSheetId: null, specs: {}, built: {} })));
await reopen();
ok('a sheet with no glass says so', /No glass has been built/.test(await text(p, '#glassNote')));
await p.evaluate(() => localStorage.removeItem('glass_record_v2'));

/* ---- the name is text -------------------------------------------------------------------------------------------- */
await open(p, '#/f/f2/s/s3/settings');
await p.fill('#sname', '<img id="boom" src=x> Mini'); await click(p, '#ssave'); await sleep(2000);
ok('a name that looks like markup is shown as text everywhere', !(await p.$('#boom')) && (await text(p, '#sheetMenu')).includes('<img id="boom" src=x> Mini') && (await text(p, '#rail')).includes('<img id="boom"'));
await p.fill('#sname', 'Mini'); await click(p, '#ssave'); await sleep(1500);

/* ---- remove, and undo ------------------------------------------------------------------------------------------------ */
await open(p, '#/f/f1/s/s1/settings');
ok('a facility\'s only sheet cannot be removed, and the page says why', await p.$eval('#dask', e => e.disabled) && /at least one sheet/.test(await text(p, '#removeNote')));
await open(p, '#/f/f2/s/s3/settings');
ok('a sheet that has company can', !(await p.$eval('#dask', e => e.disabled)));
await click(p, '#dask');
ok('asking is done in the page, and names the sheet', /Hide.*Mini.*kept/s.test(await text(p, '#removeZone')) && !!(await p.$('#dyes')));
await click(p, '#dno');
ok('Keep it changes nothing', !!(await p.$('#dask')) && (await rows()).some(r => r.id === 's3' && !r.deleted));
await click(p, '#dask');
const bm = JSON.parse(await stamps());
await click(p, '#dyes'); await sleep(2500);
ok('removing lands on the facility\'s sheets with a note and an undo', (await p.evaluate(() => location.hash)) === '#/f/f2' && /Mini has been hidden/.test(await text(p, '#removedBanner')) && !!(await p.$('#undoRemove')));
ok('the sheet is gone from the list, the menu and the rail', (await p.$$('#sheetRows .srow')).length === 1 && !/Mini/.test(await text(p, '#rail')));
const tomb = (await rows()).find(r => r.kind === 'sheet' && r.id === 's3');
ok('on the server it is a tombstone that keeps its whole record, so it can come back', tomb.deleted === true && tomb.body.name === 'Mini' && tomb.body.facilityId === 'f2' && tomb.body.fac === 'f2' && tomb.body.shape && tomb.body.size, JSON.stringify(tomb));
ok('and nothing else was restamped or removed', JSON.parse(await stamps()).filter(r => { const w = bm.find(x => x[0] === r[0] && x[1] === r[1]); return w && w[2] !== r[2]; }).length === 1);
await open(p, '#/f/f2/s/s3/settings');
ok('its address is gone too', /That page is not available/.test(await text(p, '#page .notice')));

/* undo brings Mini back */
await open(p, '#/f/f2');
await click(p, '#undoRemove'); await sleep(500);
await open(p, '#/f/f2'); await sleep(1500);
ok('(Mini is back after undo)', (await p.$$('#sheetRows .srow')).length === 2 && (await rows()).some(r => r.id === 's3' && !r.deleted));

/* Rink One has a round with a reading in it: removing the sheet must not lose it */
await open(p, '#/f/f2/s/s2/settings');
await click(p, '#dask'); await click(p, '#dyes'); await sleep(2500);
const sessions = (await rows()).filter(r => r.kind === 'session' && r.body.sheetId === 's2');
ok('removing Rink One kept its round, live and with its reading', sessions.length === 1 && !sessions[0].deleted && sessions[0].body.data['1'] === '1 1/4"', JSON.stringify(sessions));
await p.goto(B + '/ice.html'); await sleep(2500);
ok('Ice, opened after, is on the sheet that is left and has not crashed', (await p.evaluate(() => facility().sheets.map(s => s.name))).join() === 'Mini', await p.evaluate(() => facility().sheets.map(s => s.name).join()));
await p.evaluate(() => { state.facilities[0].sheets[0].sessions[0].notes = Object.assign({}, state.facilities[0].sheets[0].sessions[0].notes, { '1': 'a note' }); persist(); }); await sleep(2500);
const kept = (await rows()).filter(r => r.kind === 'session' && r.body.sheetId === 's2');
ok('and when Ice saves, the round of a hidden sheet is left alone: still live, reading intact', kept.length === 1 && !kept[0].deleted && kept[0].body.data['1'] === '1 1/4"', JSON.stringify(kept));
await open(p, '#/f/f2');
ok('with one sheet left, that one cannot be removed in turn', await (async () => { await open(p, '#/f/f2/s/s3/settings'); return p.$eval('#dask', e => e.disabled); })());
await open(p, '#/f/f2');
ok('a removed sheet stays on offer after the page is left: a list of them, for Management', /Rink One/.test(await text(p, '#removedList')) && !!(await p.$('#removedList [data-restore="s2"]')) && !(await p.$('#removedBanner')));
await click(p, '#removedList [data-restore="s2"]'); await sleep(2500);
ok('Bring back brings Rink One back, with its round and trend', (await p.$$('#sheetRows .srow[data-sid="s2"]')).length === 1 && !!(await p.$('.srow[data-sid="s2"] circle')) && /Rink One/.test(await text(p, '#sheetRows')),
   JSON.stringify([(await p.$$('#sheetRows .srow')).length, await text(p, '#sheetRows'), await p.evaluate(() => Records.trendOf(Shell.data().sessions, 's2', 10).length)]));
const back = (await rows()).find(r => r.kind === 'sheet' && r.id === 's2');
ok('on the server it is live again, with its settings', !back.deleted && back.body.name === 'Rink One' && back.body.shape.W === 90);
await open(p, '#/f/f2');
ok('the undo note does not linger', !(await p.$('#removedBanner')));

/* ---- the Sheets page leads here ------------------------------------------------------------------------------------------ */
await p.click('.srow[data-sid="s2"] [data-open="settings"]'); await sleep(600);
ok('a Sheet settings button on each row opens it', (await p.evaluate(() => location.hash)) === '#/f/f2/s/s2/settings');
await D.ctx.close();

/* ---- people: locked, unlocked and Staff ----------------------------------------------------------------------------------------- */
await fetch(B + '/__reset');
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
await k.addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['f2'] });
await k.ctl('tight=1');
await k.seed(k.PETE);
const M = await k.device(b, 1280);
await M.p.goto(B + '/index.html' + SET); await k.signInAs(M.p, 'pete', 'pete-code-1'); await M.p.waitForSelector('#pageSettings'); await sleep(600);
ok('Management with the editing window shut sees it read-only, and is told how to change that', /Unlock to edit/.test(await text(M.p, '#viewOnly')) && await M.p.$eval('#ssave', e => e.disabled) && await M.p.$eval('#sname', e => e.disabled));
ok('every stepper and tile is off', await M.p.$$eval('#pageSettings .stpb, #pageSettings .tile, #pageSettings [data-opt]', b => b.every(x => x.disabled)));
await M.p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(800);
ok('unlocking turns the page live without a reload', !(await M.p.$('#viewOnly')) && !(await M.p.$eval('#sname', e => e.disabled)) && !(await M.p.$eval('#ssave', e => e.disabled)));
await M.p.fill('#sname', 'Pete\'s Standard'); await click(M.p, '#ssave'); await sleep(2500);
const mrow = (await rows()).find(r => r.kind === 'sheet' && r.id === 's2');
ok('and the save is accepted by the server under his name', mrow.body.name === 'Pete\'s Standard' && mrow.changed_by_name === 'Pete', JSON.stringify(mrow));
await M.ctx.close();

const S = await k.device(b, 1280);
await S.p.goto(B + '/index.html' + SET); await k.signInAs(S.p, 'flo', 'flo-code-1'); await S.p.waitForSelector('#pageSettings'); await sleep(600);
ok('Staff can look: the page and its values are there', await S.p.inputValue('#sname') === 'Pete\'s Standard' && await val(S.p, 'L') === '200′');
ok('but are told only Management can change it', /Only a Manager or Admin can change/.test(await text(S.p, '#viewOnly')));
await S.p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(800);
ok('even with the editing window open, everything stays off', await S.p.$eval('#ssave', e => e.disabled) && await S.p.$eval('#sname', e => e.disabled) && !(await S.p.$('#removeZone')));
await S.ctx.close();

await k.done(b);
})();
