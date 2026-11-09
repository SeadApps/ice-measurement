/* Glass Builder.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/glassbuildtest.js

   The Builder walks the sheet the address names. It asks the size again, starting from the sheet's own,
   and never writes the sheet silently: step 4 shows what differs and offers Update the sheet or Keep the
   sheet's size. The walk is kept on the device as it goes (never synced), so a reload or a locked phone
   returns to the same stretch with every piece; a draft started against a sheet whose size has since
   changed says so. A sheet that already has glass cannot be walked again, but its layout can be removed,
   and that asks in the page. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
/* two more surfaces with no glass: s4 (150 x 70) and s5 (a regulation 200 x 85) */
{
  const tok = await k.login('operations@conwayarena.local', k.ACCESS);
  const rec = (id, body) => ({ kind: 'sheet', id, deleted: false, body: Object.assign({ id, fac: 'f2', facilityId: 'f2', updatedAt: k.ago(30) }, body) });
  await fetch(B + '/rest/v1/records?on_conflict=kind,id', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify([rec('s4', { name: 'Practice', ord: 2, size: { L: 150, W: 70, corner: 20 } }), rec('s5', { name: 'Third', ord: 3, size: { L: 200, W: 85, corner: 28 } })]) });
}
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
const b = await k.chromium.launch();
const errs = [];
let native = 0;

const open = async (hash, fid) => {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
  p.on('dialog', d => { native++; d.dismiss(); });
  await p.goto(B + '/glass.html#/f/' + (fid || 'f2') + '/s/' + hash);
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="pete"]'); await p.click('.sync-gate .sync-name[data-id="pete"]');
  await p.fill('.sync-gate #sg-personal', 'pete-code-1'); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('#shellbar .nav'); await sleep(2500);
  await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1500);
  return { ctx, p };
};
const sheetRow = async id => (await k.rows()).find(r => r.kind === 'sheet' && r.id === id);
const quick = (p, w) => p.evaluate(() => {          // a plain walk of the measured size, glass only
  bldEnsureWalls();
  const spans = bldWalls().spans;
  BLD.walls.forEach((wl, i) => {
    const count = Math.max(1, Math.round(spans[i] * 12 / 48));
    const each = Math.floor(spans[i] * 12 / count);
    wl.items = Array.from({ length: count }, () => ({ kind: 'glass', width_in: each, label: null, height_in: null }));
  });
  BLD.step = 4; bldRender();
});

/* Conway's own glass binds to the first sheet a Glass device is standing on, so that device stands on Conway's. */
{ const C = await open('s1', 'f1'); await sleep(1500); await C.ctx.close(); }

/* ---------------- the sheet's own size is where it starts ---------------- */
let D = await open('s3/build'), p = D.p;
ok('the Builder tab opens the builder for the sheet in the address', await p.isVisible('#builder') && await p.evaluate(() => BLD.sheet) === 's3');
ok('the size boxes start from that sheet\'s size, not a default', JSON.stringify(await p.evaluate(() => [+$b('bL').value, +$b('bW').value, +$b('bRf').value, +$b('bRi').value])) === '[120,60,20,0]', JSON.stringify(await p.evaluate(() => [+$b('bL').value, +$b('bW').value, +$b('bRf').value, +$b('bRi').value])));
await p.selectOption('#bSheet', 's5'); await sleep(250);
ok('picking another surface starts from that one\'s size', JSON.stringify(await p.evaluate(() => [+$b('bL').value, +$b('bW').value, +$b('bRf').value, +$b('bRi').value])) === '[200,85,27,2]');
await p.selectOption('#bSheet', 's3'); await sleep(250);

/* ---------------- measured the same: nothing to ask ---------------- */
await quick(p);
ok('measured the same as the sheet, step 4 has nothing to ask', !(await p.$('#bShapeCmp')));

/* ---------------- measured differently: Update or Keep ---------------- */
await p.evaluate(() => { BLD.step = 1; bldRender(); });
await p.fill('#bL', '118'); await sleep(200);
await quick(p);
const cmp = await p.textContent('#bShapeCmp').catch(() => '');
ok('step 4 shows what differs from the sheet', /120/.test(cmp) && /118/.test(cmp), cmp.slice(0, 120));
ok('with Update the sheet and Keep the sheet\'s size', await p.isVisible('#bShapeUpdate') && await p.isVisible('#bShapeKeep'));
ok('Keep is the one chosen until somebody chooses', await p.evaluate(() => document.getElementById('bShapeKeep').getAttribute('aria-pressed')) === 'true');
const stamp0 = (await sheetRow('s3')).updated_at;
await p.click('#bShapeUpdate'); await sleep(200);
await p.click('#bldNext'); await sleep(3500);
const s3 = await sheetRow('s3');
ok('Update the sheet writes the new size to the sheet', s3.body.shape && s3.body.shape.L === 118 && s3.body.shape.W === 60 && s3.updated_at !== stamp0, JSON.stringify(s3.body.shape));
ok('and by the person signed in', s3.changed_by === 'pete');
const rounds = (await k.rows()).filter(r => r.kind === 'session' && r.body.sheetId === 's3');
ok('Ice\'s readings are not touched', rounds.length === 1 && Object.keys(rounds[0].body.data).length === 0);
ok('the glass is built for that sheet', await p.evaluate(() => !!LAYOUTS['s3'] && activeBucket === 's3'));

/* ---------------- Keep leaves the sheet alone ---------------- */
await D.ctx.close();
D = await open('s4/build'); p = D.p;
const s4before = (await sheetRow('s4')).updated_at;
await p.fill('#bL', '149'); await sleep(200);
await quick(p);
ok('measured differently on another sheet: Keep is offered', await p.isVisible('#bShapeKeep'));
await p.click('#bldNext'); await sleep(3500);
const s4 = await sheetRow('s4');
ok('Keep builds the glass and leaves the sheet\'s size as it was', s4.updated_at === s4before && !(s4.body.shape && s4.body.shape.L === 149), JSON.stringify([s4before, s4.updated_at, s4.body.shape, s4.changed_by]));
ok('the glass uses what was measured', await p.evaluate(() => LAYOUTS['s4'] && LAYOUTS['s4'].rink.L === 149));

/* ---------------- the draft survives a reload ---------------- */
await D.ctx.close();
D = await open('s5/build'); p = D.p;
await p.evaluate(() => {
  BLD.height = 72; BLD.thickness = '1/2"';
  bldEnsureWalls();
  const spans = bldWalls().spans;
  BLD.walls.forEach((w, i) => { w.items = Array.from({ length: 3 }, () => ({ kind: 'glass', width_in: 40 + i, label: null, height_in: null })); });
  BLD.step = 3; BLD.wi = 2; bldRender();
});
await sleep(400);
const walked = await p.evaluate(() => JSON.stringify(BLD.walls.map(w => w.items.length)));
await p.reload(); await sleep(3500);
await p.evaluate(c => Sync.unlockEditing(c), k.EDIT).catch(() => {}); await sleep(1000);
ok('a reload comes back to the builder on the same sheet', await p.isVisible('#builder') && await p.evaluate(() => BLD.sheet) === 's5');
ok('on the same stretch, with every piece', await p.evaluate(() => BLD.step === 3 && BLD.wi === 2) && await p.evaluate(() => JSON.stringify(BLD.walls.map(w => w.items.length))) === walked);
ok('and it says it is continuing a walk, with a way to discard it', await p.isVisible('#bDraft') && await p.isVisible('#bDraftDiscard'));
ok('the draft is on this device only: nothing about it is on the server', !(await k.rows()).some(r => /draft/i.test(r.kind) || /draft/i.test(JSON.stringify(r.body).slice(0, 4000))));
ok('and is not part of what syncs', await p.evaluate(() => !/draft/i.test(snapshot())));

/* a sheet whose size changed under the draft says so */
await p.evaluate(async () => { await Records.Repo.updateSheet('s5', { shape: { L: 199 } }); });
await p.reload(); await sleep(3500);
await p.evaluate(c => Sync.unlockEditing(c), k.EDIT).catch(() => {}); await sleep(1000);
ok('a draft started before the sheet\'s size changed says so and asks', await p.isVisible('#bDraftChanged') && await p.isVisible('#bDraftContinue') && await p.isVisible('#bDraftDiscard'), await p.textContent('#bldBody').then(t => t.slice(0, 80)));
await p.click('#bDraftDiscard'); await sleep(400);
ok('discarding it starts the walk afresh from the sheet\'s size', await p.evaluate(() => BLD.step === 1 && BLD.walls.length === 0 && +$b('bL').value === 199));
await p.reload(); await sleep(3500);
ok('and it is gone after a reload', !(await p.isVisible('#bDraft')) && await p.evaluate(() => BLD.step === 1));

/* a draft is cleared when the layout is saved */
await quick(p);
await p.click('#bldNext'); await sleep(3000);
ok('saving the layout clears the draft', await p.evaluate(() => !localStorage.getItem('glass_build_draft_v1') && !/glass_build_draft/.test(Object.keys(localStorage).join())));

/* ---------------- remove this layout, in the page ---------------- */
await D.ctx.close();
D = await open('s3/build'); p = D.p;
ok('a sheet that already has glass cannot be walked again: the page says so', await p.isVisible('#bldHasGlass') && !(await p.isVisible('#bldBody')));
ok('and offers Remove this layout', await p.isVisible('#bldRemove'), JSON.stringify(await p.evaluate(() => { const e = document.getElementById('bldRemove'), r = e.getBoundingClientRect(); return [e.hidden, e.disabled, r.width, r.height, getComputedStyle(e).display, getComputedStyle(e.parentElement).display, document.getElementById('glassWrap').dataset.page, document.getElementById('bldHasGlassText').textContent.slice(0,60)]; })));
await p.click('#bldRemove'); await sleep(300);
ok('which asks in the page', await p.isVisible('#sureScrim.on') && /Remove/.test(await p.textContent('#sureTitle')));
await p.click('#sureNo'); await sleep(300);
ok('Cancel keeps the layout', await p.evaluate(() => !!LAYOUTS['s3']));
await p.click('#bldRemove'); await sleep(300); await p.click('#sureYes'); await sleep(1500);
ok('OK removes it, and the sheet can be walked again', await p.evaluate(() => !LAYOUTS['s3']) && await p.isVisible('#bldBody'));
ok('no browser dialog appeared at any point', native === 0, String(native));
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
