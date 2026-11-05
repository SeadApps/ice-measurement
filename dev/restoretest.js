/* Restoring a backup is Management's.

   A backup file can hold any facility's records, and merging one writes them all.
   The server refuses a Staff person's write to a facility they were not given, so
   a Staff restore would half-work and then be refused record by record. The pages
   say so up front instead: Staff get a short message and nothing is merged.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/restoretest.js

   Before anybody signs in as a person (rollout step 3) the shared account carries
   the data, and restore stays as open as it was. */
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const EDIT = 'test-editing-code', MSG = 'Only Management can restore a backup.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };
const ctl = q => fetch(B + '/__ctl?' + q);
const addStaff = p => fetch(B + '/__staff', { method: 'POST', body: JSON.stringify(p) });
const T = '2026-09-01T10:00:00.000Z';

async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! ' + name + ' pageerror: ' + String(e).split('\n')[0]));
  p.on('dialog', d => d.accept());
  return { ctx, p, name };
}
async function access(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', 'test-access-code'); await p.click('.sync-gate button'); await sleep(2200);
}
async function signInAs(p, id, code) {
  await access(p);
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + id + '"]', { timeout: 8000 });
  await p.click('.sync-gate .sync-name[data-id="' + id + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go'); await sleep(2800);
}
const unlock = p => p.evaluate(c => window.Sync.unlockEditing(c), EDIT);
const file = (name, obj) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });
const iceBackup = file('backup.json', { format: 'rink-ice-v4',
  facilities: { bk: { id: 'bk', name: 'Backup Rink', ord: 9, settings: { target: 1.5, edges: [0.6875, 1.4375, 1.5625, 1.9375] }, updatedAt: T } },
  sheets: { bks: { id: 'bks', facilityId: 'bk', name: 'Backup sheet', ord: 0, size: { L: 200, W: 85, corner: 28 }, updatedAt: T } },
  sessions: { bkz: { id: 'bkz', sheetId: 'bks', ord: 0, date: T, mode: 'moderate', data: { '1': '1 1/2"' }, notes: {}, updatedAt: T } } });
const glassRecord = file('rec.json', { rink: 'Conway', panels: { '045': { status: 'replace', note: 'from the file', updatedAt: '2030-01-01T00:00:00.000Z' } } });
const names = p => p.evaluate(() => state.facilities.map(f => f.name));
const note = p => p.evaluate(() => document.getElementById('savedNote').textContent);
const panel = p => p.evaluate(() => (state['045'] || {}).status || '');

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();

/* ---- before people exist ---------------------------------------------------- */
const L = await device(b, 'L');
await L.p.goto(B + '/ice.html'); await access(L.p);
ok('with nobody signed in as a person, restore is allowed as it always was', await L.p.evaluate(() => Sync.canRestore()) === true);
await L.p.setInputFiles('#backupFile', iceBackup); await sleep(1500); await L.p.click('#sureScrim.on #sureYes'); await sleep(800);
ok('and the backup merges', (await names(L.p)).includes('Backup Rink'), JSON.stringify(await names(L.p)));
await L.ctx.close();

/* ---- once people exist -------------------------------------------------------- */
await fetch(B + '/__reset');
await addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await addStaff({ id: 'flo', name: 'Flo', role: 'staff', code: 'flo-code-1', facilities: ['flynn'] });
await ctl('tight=1');

const S = await device(b, 'S');
await S.p.goto(B + '/ice.html'); await signInAs(S.p, 'flo', 'flo-code-1'); await unlock(S.p); await sleep(800);
const before = JSON.stringify(await names(S.p));
ok('a Staff person cannot restore', await S.p.evaluate(() => Sync.canRestore()) === false);
await S.p.evaluate(() => document.getElementById('backupImport').click());
ok('the button says why', (await note(S.p)) === MSG, await note(S.p));
await S.p.setInputFiles('#backupFile', iceBackup); await sleep(1500);
ok('a file chosen anyway is not merged', JSON.stringify(await names(S.p)) === before && !(await names(S.p)).includes('Backup Rink'), JSON.stringify(await names(S.p)));
ok('and nothing of it is on the device', !(await S.p.evaluate(() => localStorage.getItem('ice_v4_facilities') || '')).includes('Backup Rink'));
ok('with the same message', (await note(S.p)) === MSG, await note(S.p));

const M = await device(b, 'M');
await M.p.goto(B + '/ice.html'); await signInAs(M.p, 'pete', 'pete-code-1'); await unlock(M.p); await sleep(800);
ok('Management can', await M.p.evaluate(() => Sync.canRestore()) === true);
await M.p.setInputFiles('#backupFile', iceBackup); await sleep(1800); await M.p.click('#sureScrim.on #sureYes'); await sleep(800);
ok('and the backup merges for them', (await names(M.p)).includes('Backup Rink'), JSON.stringify(await names(M.p)));

/* ---- Glass's own record file ------------------------------------------------------ */
const GS = await device(b, 'GS');
await GS.p.goto(B + '/glass.html'); await signInAs(GS.p, 'flo', 'flo-code-1'); await unlock(GS.p); await sleep(1500);
await GS.p.evaluate(() => document.getElementById('load').click());
ok('Glass tells Staff the same', (await GS.p.evaluate(() => document.getElementById('toolNote').textContent)) === MSG);
await GS.p.setInputFiles('#file', glassRecord); await sleep(1200);
ok('and merges nothing from a file chosen anyway', (await panel(GS.p)) !== 'replace', await panel(GS.p));

const GM = await device(b, 'GM');
await GM.p.goto(B + '/glass.html'); await signInAs(GM.p, 'pete', 'pete-code-1'); await unlock(GM.p); await sleep(1500);
await GM.p.setInputFiles('#file', glassRecord); await sleep(1200);
ok('Management can load a Glass record file', (await panel(GM.p)) === 'replace', await panel(GM.p));

await b.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
