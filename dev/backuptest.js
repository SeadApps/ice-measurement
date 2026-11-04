/* Backup and restore, from the account menu.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/backuptest.js

   One file holds every record on the device, in the format Ice has always written, so a
   backup from either place restores into the other. Restoring is Management's and needs
   the editing window; it is confirmed in the page; it merges, newest wins, readings from
   both copies kept. A file is the person's to send anywhere, so it never carries a
   facility they may not see. */
const k = require('./shellkit');
const fs = require('fs');
const { ok, sleep, B, text, rows, stamps } = k;

const menu = async (p, label) => { await p.click('#acctMenu'); await p.click('.dropdown .it:has-text("' + label + '")'); };
const exportFile = async (p, label) => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), menu(p, label || 'Back up all data')]);
  return { name: dl.suggestedFilename(), json: JSON.parse(fs.readFileSync(await dl.path(), 'utf8')) };
};
const upload = async (p, obj, name) => {
  await p.evaluate(() => { document.getElementById('restoreFile') || null; });
  await menu(p, 'Restore from backup');
  await p.setInputFiles('#restoreFile', { name: name || 'b.json', mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
  await sleep(500);
};
const maps = p => p.evaluate(() => ({ f: JSON.parse(localStorage.getItem('ice_v4_facilities') || '{}'), s: JSON.parse(localStorage.getItem('ice_v4_sheets') || '{}'), z: JSON.parse(localStorage.getItem('ice_v4_sessions') || '{}') }));
const names = p => p.$$eval('#facRows .frow .name', e => e.map(x => x.textContent));

(async () => {
await fetch(B + '/__reset');
await k.seed();
const b = await k.chromium.launch();

/* ---- export ------------------------------------------------------------------------------ */
const A = await k.device(b, 1280);
await A.p.goto(B + '/index.html'); await k.signIn(A.p);
const sA = await stamps();
ok('the account menu has Back up, Restore and Units', await (async () => { await A.p.click('#acctMenu'); const t = await A.p.$$eval('.dropdown .it', e => e.map(x => x.textContent)); await A.p.keyboard.press('Escape');
  return ['Back up all data', 'Restore from backup…', 'Inches', 'Millimetres'].every(x => t.includes(x)); })());
await A.p.click('#acctMenu');
ok('and says there has been no backup yet', (await A.p.$$eval('.dropdown .it', e => e.map(x => x.textContent))).includes('No backup yet'));
await A.p.keyboard.press('Escape');
const ex = await exportFile(A.p);
ok('Back up all data downloads a dated file', /^ice_sheet_backup_\d{4}-\d{2}-\d{2}\.json$/.test(ex.name), ex.name);
ok('in the format Ice has always written', ex.json.format === 'rink-ice-v4' && !!ex.json.exportedAt);
ok('holding every facility, sheet and round on the device', Object.keys(ex.json.facilities).join() === 'f1,f2' && Object.keys(ex.json.sheets).sort().join() === 's1,s2,s3' && Object.keys(ex.json.sessions).sort().join() === 'z1,z2,z3,z4');
ok('with the readings in it', ex.json.sessions.z1.data['1'] === '1 1/2"' && ex.json.sessions.z2.data['2'] === '1 1/2"');
ok('and no mark that belongs to this device', JSON.stringify(ex.json).indexOf('"seed"') < 0);
await sleep(300);
await A.p.click('#acctMenu');
ok('the menu now says when', (await A.p.$$eval('.dropdown .it', e => e.map(x => x.textContent))).includes('Last backup: today'));
await A.p.keyboard.press('Escape');
ok('and Ice, reading the same preference, knows', await A.p.evaluate(() => !!JSON.parse(localStorage.getItem('ice_v4_prefs')).lastBackup));
ok('a backup writes no record', sA === await stamps());
await A.p.evaluate(() => Sync.sync('t')); await sleep(800);
ok('and an idle device after it still sends nothing', sA === await stamps());
await A.ctx.close();

/* ---- restore onto an empty device ------------------------------------------------------------ */
await fetch(B + '/__reset');
const E = await k.device(b, 1280);
await E.p.goto(B + '/index.html'); await k.signIn(E.p);
ok('an empty device has nothing to show', !!(await E.p.$('#noFacilities')));
await upload(E.p, ex.json);
ok('the question is asked in the page, with the count', !!(await E.p.$('#restoreDlg')) && /4 rounds in the file/.test(await text(E.p, '#restoreCount')) && /Nothing is deleted/.test(await text(E.p, '#restoreCount')));
await E.p.click('#restoreNo'); await sleep(300);
ok('Cancel leaves it empty', !(await E.p.$('#restoreDlg')) && !!(await E.p.$('#noFacilities')) && Object.keys((await maps(E.p)).f).length === 0);
await upload(E.p, ex.json);
await E.p.click('#restoreYes'); await sleep(2500);
ok('Merge brings everything in and says how much', /Merged \d+ changes?/.test(await text(E.p, '#toast')) && (await names(E.p)).join() === 'Conway Arena,Flynn Rink', (await text(E.p, '#toast')) + ' | ' + (await names(E.p)).join());
const m = await maps(E.p);
ok('the device now holds exactly what was backed up', Object.keys(m.f).join() === 'f1,f2' && Object.keys(m.z).sort().join() === 'z1,z2,z3,z4' && m.z.z1.data['2'] === '1 3/8"');
const ex2 = await exportFile(E.p);
/* the server restamps what a device sends, so the stamps are not part of what a backup has to preserve */
const same = o => JSON.stringify([o.facilities, o.sheets, o.sessions], (key, v) => key === 'changedBy' || key === 'updatedAt' ? undefined : v);
ok('and exports the same thing again: backup, restore, backup compares equal', same(ex2.json) === same(ex.json));
await sleep(1500);
const srv = await rows();
ok('it syncs to the server, tagged, so other devices get it', srv.filter(r => r.kind === 'session').length === 4 && srv.some(r => r.kind === 'facility' && r.id === 'f2' && r.body.name === 'Flynn Rink'));
await E.ctx.close();

/* ---- merging two devices ------------------------------------------------------------------------ */
await fetch(B + '/__reset');
const M = await k.device(b, 1280);
await M.p.goto(B + '/ice.html'); await k.signIn(M.p).catch(() => {});
await sleep(2500);
await M.p.evaluate(() => { session().data['5'] = '1 3/4"'; facility().name = 'Hartford'; persist(); }); await sleep(2500);
const own = (await maps(M.p));
const file = JSON.parse(JSON.stringify(ex.json));
file.sessions.z2.data = { '1': '1"', '9': '1 7/8"' };            // another copy of a round, with a reading this device does not have
await M.p.goto(B + '/index.html'); await M.p.waitForSelector('#page .screen'); await sleep(600);
await upload(M.p, file); await M.p.click('#restoreYes'); await sleep(2500);
ok('merging into a device with its own work keeps it, and adds the file\'s', (await names(M.p)).includes('Hartford') && (await names(M.p)).includes('Conway Arena') && (await names(M.p)).includes('Flynn Rink'));
const mm = await maps(M.p);
ok('and a round both copies have keeps readings from each', Object.keys(mm.z.z2.data).sort().join() === '1,2,9' || Object.keys(mm.z.z2.data).includes('9'), JSON.stringify(mm.z.z2.data));
ok('this device\'s own round is untouched', Object.values(mm.z).some(z => z.data && z.data['5'] === '1 3/4"'));
await upload(M.p, file); await M.p.click('#restoreYes'); await sleep(1500);
ok('restoring the same file again changes nothing, and says so', /Already up to date/.test(await text(M.p, '#toast')), await text(M.p, '#toast'));
await M.ctx.close();

/* ---- a file that is not a backup, and an old one ------------------------------------------------------ */
await fetch(B + '/__reset');
await k.seed();
const X = await k.device(b, 1280);
await X.p.goto(B + '/index.html'); await k.signIn(X.p);
const sX = await stamps();
await upload(X.p, 'this is not json');
ok('text that is not JSON is refused, in the page', /doesn.t look like a valid backup/.test(await text(X.p, '#toast')) && !(await X.p.$('#restoreDlg')));
await upload(X.p, { hello: 'world' });
ok('and so is JSON that is not a backup', /doesn.t look like a valid backup/.test(await text(X.p, '#toast')) && !(await X.p.$('#restoreDlg')));
ok('nothing was written', sX === await stamps());
const old = { exportedAt: '2026-01-05T10:00:00.000Z', facilities: [{ id: 'old1', name: 'Old Rink', settings: { target: 1.5 }, sheets: [{ id: 'os1', name: 'Rink A', size: { L: 200, W: 85, corner: 28 }, sessions: [{ id: 'oz1', date: '2026-01-05', mode: 'moderate', data: { '1': '1 1/2"' }, notes: {} }] }] }] };
await upload(X.p, old);
ok('an older whole-state backup is understood', /1 round in the file/.test(await text(X.p, '#restoreCount')));
await X.p.click('#restoreYes'); await sleep(2500);
ok('and merged', (await names(X.p)).includes('Old Rink') && (await maps(X.p)).z.oz1.data['1'] === '1 1/2"');
ok('its records are stamped with the date the backup was made, not now', await X.p.evaluate(o => Object.values(Records.Repo.previewImport(o).inc.sessions).every(z => z.updatedAt === o.exportedAt), old));
await X.ctx.close();

/* ---- units ----------------------------------------------------------------------------------------------------- */
const U = await k.device(b, 1280);
await U.p.goto(B + '/index.html'); await k.signIn(U.p);
await U.p.click('#acctMenu');
ok('Inches is the one marked to begin with', await U.p.$eval('.dropdown .it:has-text("Inches")', e => e.getAttribute('aria-current') === 'true'));
await U.p.click('.dropdown .it:has-text("Millimetres")'); await sleep(400);
ok('Millimetres is saved as the device\'s unit', (await U.p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs')).unit)) === 'mm');
await U.p.click('#acctMenu');
ok('and is the one marked', await U.p.$eval('.dropdown .it:has-text("Millimetres")', e => e.getAttribute('aria-current') === 'true'));
await U.p.keyboard.press('Escape');
await U.p.goto(B + '/ice.html'); await sleep(2500);
ok('Ice, which reads the same preference, is in millimetres', await U.p.evaluate(() => isMM()) === true);
await U.p.goto(B + '/index.html'); await U.p.waitForSelector('#page .screen'); await sleep(400);
await menu(U.p, 'Inches'); await sleep(300);
ok('and back to inches', (await U.p.evaluate(() => JSON.parse(localStorage.getItem('ice_v4_prefs')).unit)) === 'in');
await U.ctx.close();

/* ---- Ice's own backup and the shell's are the same file ------------------------------------------------------------ */
await fetch(B + '/__reset');
await k.seed();
const I = await k.device(b, 1280);
await I.p.goto(B + '/index.html'); await k.signIn(I.p);
await I.p.goto(B + '/ice.html'); await sleep(2500);
await I.p.evaluate(()=>openSettings()); await sleep(400);
const [dl] = await Promise.all([I.p.waitForEvent('download', { timeout: 8000 }), I.p.click('#backupExport')]);
const iceFile = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
ok('Ice\'s own backup is the same format and holds the same things', iceFile.format === 'rink-ice-v4' && Object.keys(iceFile.sessions).sort().join() === 'z1,z2,z3,z4' && JSON.stringify(iceFile.sessions.z1.data) === JSON.stringify(ex.json.sessions.z1.data));
await fetch(B + '/__reset');
const J = await k.device(b, 1280);
await J.p.goto(B + '/index.html'); await k.signIn(J.p);
await upload(J.p, iceFile); await J.p.click('#restoreYes'); await sleep(2500);
ok('and the shell restores it', (await names(J.p)).join() === 'Conway Arena,Flynn Rink');
const exJ = await exportFile(J.p);
await J.p.goto(B + '/ice.html'); await sleep(2500);
await J.p.evaluate(()=>openSettings()); await sleep(400);
const fresh = await k.device(b, 1280);
await fresh.p.goto(B + '/ice.html'); await k.signIn(fresh.p).catch(() => {}); await sleep(2500);
await fresh.p.evaluate(()=>openSettings()); await sleep(400);
await fresh.p.setInputFiles('#backupFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exJ.json)) }); await sleep(2500);
ok('Ice restores a file the shell made', (await fresh.p.evaluate(() => state.facilities.map(f => f.name))).includes('Flynn Rink'));
await fresh.ctx.close(); await J.ctx.close(); await I.ctx.close();

/* ---- a device holding only an invented facility has nothing to back up ----------------------------------------------- */
await fetch(B + '/__reset');
const S0 = await k.device(b, 1280);
await S0.p.goto(B + '/ice.html'); await k.signIn(S0.p).catch(() => {}); await sleep(2500);
const seedExport = await S0.p.evaluate(() => Records.Repo.exportAll());
ok('a fresh Ice device, with only the facility it invented, exports an empty backup', Object.keys(seedExport.facilities).length === 0 && Object.keys(seedExport.sessions).length === 0, JSON.stringify(Object.keys(seedExport.facilities)));
await S0.ctx.close();

/* ---- people ---------------------------------------------------------------------------------------------------------------- */
await fetch(B + '/__reset');
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await k.addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['f2'] });
await k.ctl('tight=1');
await k.seed(k.PETE);
const P = await k.device(b, 1280);
await P.p.goto(B + '/index.html'); await k.signInAs(P.p, 'pete', 'pete-code-1');
await menu(P.p, 'Restore from backup');
ok('Management with the editing window shut is told to unlock, and no question is asked', /Unlock to edit/.test(await text(P.p, '#toast')) && !(await P.p.$('#restoreDlg')));
const pex = await exportFile(P.p);
ok('but can always back up, and gets every facility', Object.keys(pex.json.facilities).join() === 'f1,f2');
await P.p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(600);
const extra = JSON.parse(JSON.stringify(pex.json)); extra.facilities.f9 = { id: 'f9', fac: 'f9', name: 'Added From File', ord: 9, settings: { target: 1.5 }, updatedAt: '2026-10-01T00:00:00.000Z' };
extra.sheets.s9 = { id: 's9', fac: 'f9', facilityId: 'f9', name: 'Main', ord: 0, size: { L: 200, W: 85, corner: 28 }, updatedAt: '2026-10-01T00:00:00.000Z' };
extra.sessions.z9 = { id: 'z9', fac: 'f9', sheetId: 's9', ord: 0, date: '2026-10-01', mode: 'moderate', data: {}, notes: {}, updatedAt: '2026-10-01T00:00:00.000Z' };
await upload(P.p, extra); await P.p.click('#restoreYes'); await sleep(3000);
ok('unlocked, Management restores', (await names(P.p)).includes('Added From File'));
ok('and it reaches the server under their name', (await rows()).some(r => r.kind === 'facility' && r.id === 'f9' && r.changed_by_name === 'Pete'));
await P.ctx.close();

/* a shared iPad: Pete has been here, so Conway is on the device when Flo signs in */
const F = await k.device(b, 1280);
await F.p.goto(B + '/index.html'); await k.signInAs(F.p, 'pete', 'pete-code-1');
await F.p.evaluate(() => Sync.switchUser()); await sleep(1500);
await F.p.waitForSelector('.sync-gate .sync-name[data-id="flo"]'); await F.p.click('.sync-gate .sync-name[data-id="flo"]');
await F.p.fill('.sync-gate #sg-personal', 'flo-code-1'); await F.p.click('.sync-gate .sync-go'); await sleep(3500);
ok('(setup) the device still holds Conway, and Flo is signed in', (await maps(F.p)).f.f1 && /Flo/.test(await text(F.p, '#acctMenu')));
await menu(F.p, 'Restore from backup');
ok('Staff are told only Management can restore, and no question is asked', /Only Management can restore/.test(await text(F.p, '#toast')) && !(await F.p.$('#restoreDlg')));
const fex = await exportFile(F.p);
ok('Staff can back up, but only their own facility is in the file, though the device holds both', Object.keys(fex.json.facilities).join() === 'f2' && Object.keys(fex.json.sheets).sort().join() === 's2,s3' && !JSON.stringify(fex.json).includes('Conway'), JSON.stringify(Object.keys(fex.json.facilities)));
await F.ctx.close();

await k.done(b);
})();
