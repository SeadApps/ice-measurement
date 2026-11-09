/* Glass in the app-wide backup.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/glassbackuptest.js

   Glass no longer has its own Save record / Load record. What it keeps on a device (panel conditions,
   the binding, the layouts walked, spare-glass movements and the one-tap widths) is part of
   Repo.exportAll() and merged back by Repo.importAll(), newest wins and nothing is deleted. A Glass file
   saved before this ({rink, saved, panels}) still loads once, through the same path. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
const b = await k.chromium.launch();
const errs = [];
const open = async (path) => {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
  await p.goto(B + path);
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="pete"]'); await p.click('.sync-gate .sync-name[data-id="pete"]');
  await p.fill('.sync-gate #sg-personal', 'pete-code-1'); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('.nav'); await sleep(2500);
  await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1200);
  return { ctx, p };
};

/* ---------------- a device holding every Glass record kind ---------------- */
const A = await open('/glass.html#/f/f1/s/s1'), a = A.p;
await a.evaluate(() => { select('045'); set('045', { status: 'replace', note: 'cracked at the corner' }); });
await a.evaluate(() => { addMovement(43, 75, '1/2"', 'tempered', 7, 'received'); setWidths(activeFacilityId(), [43, 48, 36]); store(); spares(); });
await a.evaluate(() => {                                          // a layout walked for another sheet
  BLD.sheet = 's3'; BLD.name = ''; bldTakeShape('s3'); BLD.height = 72; BLD.thickness = '1/2"'; BLD.start = 'end'; BLD.walls = []; BLD.wi = 0;
  bldEnsureWalls(); const sp = bldWalls().spans;
  BLD.walls.forEach((w, i) => { const n = Math.max(1, Math.round(sp[i] * 12 / 48)); const e = Math.floor(sp[i] * 12 / n); w.items = Array.from({ length: n }, () => ({ kind: 'glass', width_in: e, label: null, height_in: null })); });
  return bldSave();
});
await sleep(1500);
const file = await a.evaluate(async () => JSON.parse(JSON.stringify(await Records.Repo.exportAll())));
ok('the backup carries Glass: the panel condition', !!file.glass && JSON.stringify(file.glass.records).includes('cracked at the corner'));
ok('the spare-glass movement', Object.values(file.glass.spares || {}).some(m => m.qty === 7 && m.note === 'received'));
ok('the one-tap widths', Object.values(file.glass.widths || {}).some(w => (w.widths || []).join() === '36,43,48' || (w.widths || []).join() === '43,48,36'));
ok('the layout that was walked, as its walk', !!(file.glass.specs && file.glass.specs.s3 && file.glass.specs.s3.sections));
ok('and the binding', file.glass.boundSheetId === 's1');
ok('the Ice records are still there too', Object.keys(file.sheets).length >= 3 && file.format === 'rink-ice-v4');
await A.ctx.close();
/* the server forgets everything: what comes back below can only have come from the file */
await fetch(B + '/__reset'); await k.seed(); await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });

/* ---------------- onto an empty device ---------------- */
const E = await open('/index.html'), e = E.p;
const before = await e.evaluate(() => localStorage.getItem('glass_record_v2'));
const pv = await e.evaluate(f => Records.Repo.previewImport(f), file);
ok('the file is recognised, and says how many Glass panels and movements it holds', pv.ok === true && pv.glass && pv.glass.panels >= 1 && pv.glass.spares >= 1, JSON.stringify(pv.glass));
const res = await e.evaluate(async f => { const r = await Records.Repo.importAll(f); return { ok: r.ok, taken: r.taken }; }, file);
ok('restoring it takes the changes in', res.ok && res.taken > 0, JSON.stringify(res));
await e.goto(B + '/glass.html#/f/f1/s/s1'); await sleep(3000);
const G = E, g = e;
ok('Glass on that device shows the panel as it was', await g.evaluate(() => state['045'] && state['045'].status === 'replace' && state['045'].note === 'cracked at the corner'));
ok('the stock is back', await g.evaluate(() => (stockOf(activeFacilityId())['43|75|1/2"|tempered'] || { qty: 0 }).qty) === 7);
ok('the widths are back', await g.evaluate(() => widthsOf(activeFacilityId()).length) === 3);
ok('the layout is back and can be drawn', await g.evaluate(() => !!LAYOUTS['s3'] && LAYOUTS['s3'].panels.length > 10));
await G.ctx.close();

/* ---------------- newest wins, nothing is deleted ---------------- */
const N = await open('/glass.html#/f/f1/s/s1'), n = N.p;
await n.evaluate(() => { select('045'); set('045', { status: 'plexi', note: 'patched today' }); addMovement(43, 75, '1/2"', 'tempered', 2, 'local extra'); store(); });
const older = JSON.parse(JSON.stringify(file));
const r2 = await n.evaluate(async f => { const x = await Records.Repo.importAll(f); return x.ok; }, older);
await n.reload(); await sleep(3000);
await n.evaluate(c => Sync.unlockEditing(c), k.EDIT).catch(() => {});
ok('an older backup does not overwrite a newer edit', r2 && await n.evaluate(() => state['045'].status === 'plexi' && state['045'].note === 'patched today'));
ok('and movements add: the backup\'s and this device\'s both count', await n.evaluate(() => (stockOf(activeFacilityId())['43|75|1/2"|tempered'] || { qty: 0 }).qty) === 9);
const again = await n.evaluate(async f => (await Records.Repo.importAll(f)).taken, older);
ok('restoring the same file twice changes nothing the second time', again === 0, String(again));
await N.ctx.close();

/* ---------------- a Glass file saved before this ---------------- */
const O = await open('/index.html'), o = O.p;
const oldFile = { rink: 'Conway Arena', saved: '2026-03-02', by: 'Old Name', panels: { '045': { status: 'replace', note: 'from the old file', at: '2026-03-02', by: 'Old Name' }, '100': { status: 'plexi', note: '', at: '2026-03-02', by: 'Old Name' } } };
const opv = await o.evaluate(f => Records.Repo.previewImport(f), oldFile);
ok('a Glass file saved before this is still recognised', opv.ok === true && opv.glass && opv.glass.panels === 2, JSON.stringify(opv));
await o.evaluate(f => Records.Repo.importAll(f), oldFile);
await o.goto(B + '/glass.html#/f/f1/s/s1'); await sleep(3000);
const P = O, pp = o;
ok('and its panels are on Conway\'s glass, with the name that was typed on them', await pp.evaluate(() => state['100'] && state['100'].status === 'plexi' && state['100'].by === 'Old Name'), JSON.stringify(await pp.evaluate(() => [state['100'], localStorage.getItem('glass_record_v2') && localStorage.getItem('glass_record_v2').slice(0, 200)])));
ok('and the other panel in it', await pp.evaluate(() => state['045'] && state['045'].note === 'from the old file' && state['045'].status === 'replace'));
ok('with nothing to type into and no Save record or Load record buttons left', await pp.evaluate(() => !document.getElementById('save') && !document.getElementById('load') && !document.getElementById('file')));
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await P.ctx.close();
await k.done(b);
})();
