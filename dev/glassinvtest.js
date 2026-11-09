/* Glass Inventory page.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/glassinvtest.js

   The spare-glass card is the Inventory page: #/f/FID/s/SID/inventory, reached from the page tabs. A
   quantity on it can be edited, and editing it writes ONE signed correction movement for the
   difference ("Count corrected from 4 to 5"), never a new total, so two devices that each correct the
   same shelf add up instead of one overwriting the other. Stock is never stored. */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
const b = await k.chromium.launch();
const errs = [];

const open = async (hash) => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '/glass.html#/f/f1/s/s1' + (hash || ''));
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="pete"]'); await p.click('.sync-gate .sync-name[data-id="pete"]');
  await p.fill('.sync-gate #sg-personal', 'pete-code-1'); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('#shellbar .nav'); await sleep(2500);
  await p.evaluate(c => Sync.unlockEditing(c), k.EDIT); await sleep(1500);
  return { ctx, p };
};
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);

/* ---------------- the page tabs ---------------- */
const A = await open(), a = A.p;
ok('Glass has three pages: Rink view, Builder and Inventory', JSON.stringify(await a.$$eval('#glassTabs [data-page]', e => e.map(x => x.dataset.page))) === '["rink","build","inventory"]');
ok('it opens on the Rink view', await a.evaluate(() => document.querySelector('#glassTabs [aria-current=page]').dataset.page) === 'rink');
ok('where the plan is and the spare glass is not', await vis(a, '#plan') && !(await vis(a, '#spares')));
await a.click('#glassTabs [data-page=inventory]'); await sleep(500);
ok('Inventory shows the spare glass and not the plan', await vis(a, '#spares') && !(await vis(a, '#plan')) && !(await vis(a, '#tb')));
ok('and the address says so', /#\/f\/f1\/s\/s1\/inventory$/.test(await a.evaluate(() => location.hash)), await a.evaluate(() => location.hash));
await a.click('#glassTabs [data-page=rink]'); await sleep(300);
ok('back on the Rink view the address says rink', /\/rink$/.test(await a.evaluate(() => location.hash)) && await vis(a, '#plan'));

/* a page opened on the inventory address lands there */
const A2 = await open('/inventory'), a2 = A2.p;
ok('an address that names Inventory opens it', await vis(a2, '#spares') && !(await vis(a2, '#plan')));
await A2.ctx.close();

/* ---------------- editing a quantity ---------------- */
await a.click('#glassTabs [data-page=inventory]'); await sleep(300);
const sz = { w: 43, h: 75, thk: '1/2"' };
await a.evaluate(s => { addMovement(s.w, s.h, s.thk, 'tempered', 4, 'count'); store(); spares(); }, sz);
await sleep(300);
const keyOfSz = sz.w + '|' + sz.h + '|' + sz.thk + '|tempered';
const qsel = key => '#spStock input.sp-qty-in[data-k="' + key.replace(/"/g, '\\"') + '"]';
const level = p => p.evaluate(a2 => (stockOf(activeFacilityId())[a2] || { qty: 0 }).qty, keyOfSz);
const moves = p => p.evaluate(() => Object.values(SPARES).filter(m => !m.deleted && m.fac === activeFacilityId()).map(m => [m.qty, m.note]));
ok('each size on the shelf has a quantity that can be edited', await vis(a, qsel(keyOfSz)));
const before = (await moves(a)).length;
const qin = qsel(keyOfSz);
await a.fill(qin, '5'); await a.press(qin, 'Enter'); await sleep(500);
ok('editing 4 to 5 writes one movement of +1', (await moves(a)).length === before + 1 && (await moves(a)).some(m => m[0] === 1 && m[1] === 'Count corrected from 4 to 5'), JSON.stringify(await moves(a)));
ok('and the level is 5', await level(a) === 5);
await a.fill(qin, '2'); await a.press(qin, 'Enter'); await sleep(500);
ok('editing 5 to 2 writes one movement of -3', (await moves(a)).some(m => m[0] === -3 && m[1] === 'Count corrected from 5 to 2') && await level(a) === 2);
const n1 = (await moves(a)).length;
await a.fill(qin, '2'); await a.press(qin, 'Enter'); await sleep(300);
ok('editing to the same number writes nothing', (await moves(a)).length === n1);
await a.fill(qin, '-3'); await a.press(qin, 'Enter'); await sleep(300);
ok('a negative count is refused', await level(a) === 2 && (await moves(a)).length === n1);
ok('and the box goes back to the real level', await a.inputValue(qin) === '2');

/* ---------------- two devices, each correcting the same shelf ---------------- */
await a.fill(qin, '4'); await a.press(qin, 'Enter'); await sleep(2500);        // level 4 on A, sent
const B1 = await open('/inventory'), b1 = B1.p;                               // B pulls the 4
await sleep(2000);
ok('a second device has the same 4', await level(b1) === 4, String(await level(b1)));
await B1.ctx.setOffline(true); await A.ctx.setOffline(true); await sleep(300);
await a.fill(qin, '5'); await a.press(qin, 'Enter'); await sleep(400);          // +1 on A
await b1.fill(qin, '3'); await b1.press(qin, 'Enter'); await sleep(400);        // -1 on B
await B1.ctx.setOffline(false); await A.ctx.setOffline(false); await sleep(300);
await a.evaluate(() => Sync.sync('t')); await b1.evaluate(() => Sync.sync('t')); await sleep(3000);
await a.evaluate(() => Sync.sync('t')); await b1.evaluate(() => Sync.sync('t')); await sleep(3000);
ok('after both correct it, both add up: 4 + 1 - 1', await level(a) === 4 && await level(b1) === 4, JSON.stringify([await level(a), await level(b1)]));

/* ---------------- a size not on the shelf, and dropping a movement ---------------- */
await a.click('#spAddBox summary'); await sleep(200);
await a.selectOption('#spSize', '__other'); await sleep(200);
await a.fill('#spW', '48'); await a.fill('#spH', '75'); await a.fill('#spT', '5/8"'); await a.fill('#spQty', '6'); await a.fill('#spNote', 'new size');
await a.click('#spAdd'); await sleep(500);
const k2 = '48|75|5/8"|tempered';
ok('a new size is its first movement, with its own editable quantity', await a.evaluate(q => (stockOf(activeFacilityId())[q] || { qty: 0 }).qty, k2) === 6 && await vis(a, qsel(k2)));
await a.click('#spMoves .sp-undo >> nth=0'); await sleep(500);
ok('retracting that movement takes it off the shelf again', await a.evaluate(q => (stockOf(activeFacilityId())[q] || { qty: 0 }).qty, k2) === 0);

/* ---------------- stock is never stored ---------------- */
await sleep(3000);
const spareRows = (await k.rows()).filter(r => r.kind === 'glass_spare');
ok('the server holds movements only: no record carries a total', spareRows.length > 0 && spareRows.every(r => (r.deleted || 'qty' in r.body) && !('total' in r.body) && !('stock' in r.body) && !('level' in r.body)));
ok('the movements are the shelf: their sum is the level', spareRows.filter(r => !r.deleted && r.body.w === 43 && r.body.thk === '1/2"').reduce((s, r) => s + r.body.qty, 0) === 4);
ok('they say who made them, from the server', spareRows.every(r => r.changed_by === 'pete'));

/* ---------------- a device that only looks writes nothing ---------------- */
const snap = async () => JSON.stringify((await k.rows()).map(r => [r.kind, r.id, r.updated_at]).sort());
const s0 = await snap();
await a.reload(); await sleep(3500);
await a.evaluate(c => Sync.unlockEditing(c), k.EDIT).catch(() => {});
await sleep(1500);
ok('reloading and looking restamps nothing', (await snap()) === s0);
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await B1.ctx.close();
await k.done(b);
})();
