/* Spare glass: stock per facility, kept as movements.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/sparestest.js

   Two claims carry this feature and both are checked here.

   Spares hang off the facility, deliberately the opposite way round from the
   panels. G1 moved glass onto sheets because a two-surface arena has two sets
   of glass; stock is not like that - it sits on one rack in one building and
   gets fitted to whichever surface breaks.

   And stock is the sum of movements rather than a number. A quantity is the
   one shape this record model merges badly: newest-wins on a count means two
   devices each taking 3 to 2 merge to 2 rather than 1, silently. The check
   below drives exactly that - two devices, each fitting a pane, no reload
   between - and asserts the shelf ends on 1. It is the reason for the whole
   design, so if it ever goes red the design has been undone rather than a
   detail broken.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const CFG = { url: B, anon: 'test', email: 'operations@conwayarena.local' };
const CODE = 'test-access-code';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

async function device(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 1000 } }, opts || {}));
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, CFG);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  return { ctx, p };
}
async function signIn(p) {
  await p.waitForSelector('.sync-gate #sg-code', { timeout: 8000 });
  await p.fill('.sync-gate #sg-code', CODE);
  await p.click('.sync-gate button');
  await sleep(4000);
}
/* Record a movement through the page, the way the card does. Material defaults
   to tempered, which is both what the shelf mostly holds and what a movement
   written before materials existed is read as. */
const move = (p, w, h, thk, qty, note, mat) =>
  p.evaluate(a => { addMovement(a.w, a.h, a.thk, a.m, a.q, a.n || ''); store(); spares(); table(); },
             { w, h, thk, q: qty, n: note, m: mat || 'tempered' });
const stock = (p, w, h, thk, mat) =>
  p.evaluate(a => (stockOf(activeFacilityId())[[a.w, a.h, a.thk, a.m].join('|')] || { qty: 0 }).qty,
             { w, h, thk, m: mat || 'tempered' });

(async () => {
await fetch(B + '/__reset');
const b = await chromium.launch();

/* ---------------- a device that does not know the arena yet ---------------- */
/* Stock has to hang off a building. Before the binding has arrived there is no
   building to hang it on, and the card says so rather than inventing one - a
   movement written against a guessed facility would be wrong everywhere else. */
{
  const D = await device(b);
  await D.p.goto(B + '/glass.html'); await sleep(1600);
  await D.p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));
  await sleep(400);
  const s = await D.p.evaluate(() => ({
    fac: activeFacilityId(),
    where: (document.getElementById('spWhere') || {}).textContent || '',
    /* offsetParent, not .hidden: a class carrying its own display outranks the
       browser's [hidden]{display:none}, so the attribute can be set on
       something still plainly on screen. That is exactly what went wrong with
       the custom-size boxes, and twice before that elsewhere in this file. */
    formShown: document.getElementById('spAddBox').offsetParent !== null
  }));
  ok('with no arena known, there is no shelf', s.fac === null, String(s.fac));
  ok('and the card says why', /does not know which arena/i.test(s.where), s.where);
  ok('and offers no way to record stock', s.formShown === false);
  await D.ctx.close();
}

/* ---------------- give it an arena ---------------- */
const I = await device(b);
await I.p.goto(B + '/ice.html'); await signIn(I.p);
await I.p.evaluate(() => { facility().name = 'Conway Arena'; persist(); });
await sleep(4000);

const A = await device(b);
await A.p.goto(B + '/glass.html'); await signIn(A.p);
await sleep(2000);

{
  const s = await A.p.evaluate(() => ({
    fac: activeFacilityId(),
    where: (document.getElementById('spWhere') || {}).textContent || '',
    /* offsetParent, not .hidden: a class carrying its own display outranks the
       browser's [hidden]{display:none}, so the attribute can be set on
       something still plainly on screen. That is exactly what went wrong with
       the custom-size boxes, and twice before that elsewhere in this file. */
    formShown: document.getElementById('spAddBox').offsetParent !== null
  }));
  ok('once the binding lands, the shelf has a building', !!s.fac, String(s.fac));
  ok('and the card names it', /Conway Arena/.test(s.where), s.where);
  ok('and the form is available', s.formShown === true);
}

/* The custom-size boxes stay shut until asked for. They sat open permanently
   at first, because .sp-other carries display:grid and that beats the
   browser's [hidden]{display:none} - the third time this file has met that. */
{
  await A.p.evaluate(() => { document.getElementById('spAddBox').open = true; });
  await sleep(200);
  const shut = await A.p.evaluate(() => document.getElementById('spOther').offsetParent !== null);
  ok('the custom-size boxes start shut', shut === false);
  await A.p.selectOption('#spSize', '__other'); await sleep(250);
  const open = await A.p.evaluate(() => document.getElementById('spOther').offsetParent !== null);
  ok('and open when another size is asked for', open === true);
  /* A size the rink does not use can still be stocked - other surfaces in the
     same building are not loaded here, and the shelf serves them too. */
  await A.p.fill('#spW', '60'); await A.p.fill('#spH', '72'); await A.p.fill('#spT', '3/8"');
  await A.p.fill('#spQty', '2'); await A.p.click('#spAdd'); await sleep(500);
  ok('and a size off this rink can be stocked', await stock(A.p, 60, 72, '3/8"') === 2,
     String(await stock(A.p, 60, 72, '3/8"')));
  await A.p.evaluate(() => {
    const id = Object.keys(SPARES).find(k => SPARES[k] && SPARES[k].w === 60);
    dropMovement(id); store(); spares(); table();
  });
  await sleep(300);
}

/* ---------------- stock is the sum of movements ---------------- */
await move(A.p, 43, 75, '5/8"', 4, 'from Binswanger');
ok('receiving four puts four on the shelf', await stock(A.p, 43, 75, '5/8"') === 4);
await move(A.p, 43, 75, '5/8"', -1, 'fitted 082');
ok('fitting one leaves three', await stock(A.p, 43, 75, '5/8"') === 3);
await move(A.p, 48, 75, '1/2"', 2, '');
ok('a second size is kept apart', await stock(A.p, 48, 75, '1/2"') === 2);
/* width alone does not identify a piece - Conway carries 33" in both. */
await move(A.p, 33, 75, '1/2"', 1, '');
const thin = await stock(A.p, 33, 75, '1/2"'), thick = await stock(A.p, 33, 75, '5/8"');
ok('thickness is part of the size', thin === 1 && thick === 0, thin + ' / ' + thick);

/* ---------------- the check the whole design exists for ---------------- */
/* Two devices, each fitting one pane of the same size, neither having seen the
   other. A stored quantity would merge to 3; movements sum to 2. */
await sleep(2500);
const C = await device(b);
await C.p.goto(B + '/glass.html'); await signIn(C.p);
await sleep(2500);
ok('the second device sees the same shelf', await stock(C.p, 43, 75, '5/8"') === 3, String(await stock(C.p, 43, 75, '5/8"')));

await move(A.p, 43, 75, '5/8"', -1, 'fitted on A');
await move(C.p, 43, 75, '5/8"', -1, 'fitted on C');
await sleep(3000);
await A.p.evaluate(() => Sync.sync('test')); await sleep(2500);
await C.p.evaluate(() => Sync.sync('test')); await sleep(2500);
await A.p.evaluate(() => Sync.sync('test')); await sleep(2500);

const endA = await stock(A.p, 43, 75, '5/8"'), endC = await stock(C.p, 43, 75, '5/8"');
ok('two devices fitting a pane each take two off, not one', endA === 1, 'A has ' + endA);
ok('and both devices agree', endA === endC, endA + ' vs ' + endC);

/* ---------------- retracting ---------------- */
const before = await stock(A.p, 48, 75, '1/2"');
await A.p.evaluate(() => {
  const fac = activeFacilityId();
  const id = Object.keys(SPARES).find(k => SPARES[k] && !SPARES[k].deleted && SPARES[k].fac === fac && SPARES[k].w === 48);
  dropMovement(id); store(); spares();
});
await sleep(500);
ok('retracting a receipt takes it back off the shelf', await stock(A.p, 48, 75, '1/2"') === before - 2,
   before + ' -> ' + (await stock(A.p, 48, 75, '1/2"')));
/* A tombstone, not a deletion, or the next pull hands it straight back. */
await A.p.evaluate(() => Sync.sync('test')); await sleep(2500);
await C.p.evaluate(() => Sync.sync('test')); await sleep(2500);
ok('and it stays gone on the other device', await stock(C.p, 48, 75, '1/2"') === 0,
   String(await stock(C.p, 48, 75, '1/2"')));

/* ---------------- netting off the order list ---------------- */
/* Conway has 49 pieces at 43x75x5/8". Flag two of them against a shelf of one. */
await A.p.evaluate(() => {
  const ids = GLASS.filter(p => p.width_in === 43 && p.thickness === '5/8"').slice(0, 2).map(p => p.id);
  ids.forEach(id => set(id, { status: 'replace' }, true));
});
await sleep(800);
const cov = await A.p.evaluate(() => {
  const c = coverage();
  return { flagged: c.flagged, fromStock: c.fromStock, toOrder: c.toOrder,
           scope: (document.getElementById('scopeText') || {}).textContent || '' };
});
ok('both flagged pieces are counted', cov.flagged >= 2, String(cov.flagged));
ok('one comes off the shelf', cov.fromStock === 1, String(cov.fromStock));
ok('and the rest have to be bought', cov.toOrder === cov.flagged - 1, String(cov.toOrder));
ok('the scope line says so beside the order button', /from stock/.test(cov.scope), cov.scope);

/* ---------------- fitting a pane takes it off the shelf ---------------- */
/* The event is a transition, not a status: `replace` means needs replacing, so
   the fitting is the moment a flagged panel goes back to good. */
{
  const pid = await A.p.evaluate(() => {
    const p = GLASS.find(x => x.width_in === 42 && x.thickness === '5/8"');
    set(p.id, { status: 'replace' }, true);
    return p.id;
  });
  await sleep(400);
  await move(A.p, 42, 75, '5/8"', 3, 'for the 42s');
  const before = await stock(A.p, 42, 75, '5/8"');

  /* flagging is not a fitting */
  ok('flagging a panel deducts nothing', before === 3, String(before));

  await A.p.evaluate(id => set(id, { status: 'ok' }, true), pid);
  await sleep(500);
  ok('clearing the flag takes one off the shelf', await stock(A.p, 42, 75, '5/8"') === 2,
     String(await stock(A.p, 42, 75, '5/8"')));

  const mv = await A.p.evaluate(i => {
    const m = Object.values(SPARES).find(x => x && !x.deleted && x.forPanel === i);
    return m ? { auto: !!m.auto, qty: m.qty, note: m.note } : null;
  }, pid);
  ok('the deduction is marked as the app’s, not somebody’s', mv && mv.auto === true && mv.qty === -1, JSON.stringify(mv));
  ok('and says which panel it was for', mv && /fitted panel/.test(mv.note), mv && mv.note);

  /* Never twice for the same panel on the same day - the realistic double is
     somebody clearing a flag, re-flagging, and clearing it again. */
  await A.p.evaluate(id => { set(id, { status: 'replace' }, true); set(id, { status: 'ok' }, true); }, pid);
  await sleep(500);
  ok('and not again for the same panel the same day', await stock(A.p, 42, 75, '5/8"') === 2,
     String(await stock(A.p, 42, 75, '5/8"')));

  /* Editing a good panel's note is not a fitting either. */
  await A.p.evaluate(id => set(id, { note: 'looks fine' }, true), pid);
  await sleep(400);
  ok('editing a note deducts nothing', await stock(A.p, 42, 75, '5/8"') === 2,
     String(await stock(A.p, 42, 75, '5/8"')));

  /* An empty shelf is not taken negative: the glass came from somewhere other
     than the rack, so the ledger stays true to the rack. */
  const p57 = await A.p.evaluate(() => {
    const p = GLASS.find(x => x.width_in === 57.5);
    set(p.id, { status: 'replace' }, true);
    return p.id;
  });
  await sleep(400);
  ok('a size with no stock starts at nothing', await stock(A.p, 57.5, 75, '5/8"') === 0);
  await A.p.evaluate(id => set(id, { status: 'ok' }, true), p57);
  await sleep(500);
  ok('and clearing it does not go negative', await stock(A.p, 57.5, 75, '5/8"') === 0,
     String(await stock(A.p, 57.5, 75, '5/8"')));

  /* Retracting is one click, because a flag cleared in error is a movement to
     take back rather than a number to go hunting for. */
  await A.p.evaluate(i => {
    const m = Object.values(SPARES).find(x => x && !x.deleted && x.forPanel === i);
    dropMovement(m.id); store(); spares();
  }, pid);
  await sleep(400);
  ok('retracting an automatic deduction puts it back', await stock(A.p, 42, 75, '5/8"') === 3,
     String(await stock(A.p, 42, 75, '5/8"')));
}

/* ---------------- tempered and plexi are different things ---------------- */
/* The shelf carries both and they are not interchangeable: plexi is what goes
   in to keep the game on while the real pane is on order. */
{
  await move(A.p, 50, 75, '5/8"', 2, 'glass', 'tempered');
  await move(A.p, 50, 75, '5/8"', 3, 'sheet stock', 'plexi');
  const t = await stock(A.p, 50, 75, '5/8"', 'tempered');
  const x = await stock(A.p, 50, 75, '5/8"', 'plexi');
  ok('the same size in two materials is two piles', t === 2 && x === 3, t + ' / ' + x);

  /* A movement written before materials existed is read as tempered - that is
     what the shelf held - and nothing had to be rewritten to make it so. */
  await A.p.evaluate(() => {
    SPARES['legacymv'] = { id:'legacymv', fac:activeFacilityId(), w:50, h:75, thk:'5/8"',
                           qty:1, note:'before materials', by:'', at:'2026-09-01',
                           updatedAt:'2026-09-01T00:00:00.000Z' };
    store(); spares(); table();
  });
  await sleep(300);
  ok('a movement with no material counts as tempered',
     await stock(A.p, 50, 75, '5/8"', 'tempered') === 3 && await stock(A.p, 50, 75, '5/8"', 'plexi') === 3,
     (await stock(A.p, 50, 75, '5/8"', 'tempered')) + ' / ' + (await stock(A.p, 50, 75, '5/8"', 'plexi')));

  /* The toggle points the form at a pile. */
  await A.p.evaluate(() => { document.getElementById('spAddBox').open = true; });
  await A.p.click('.sp-mat button[data-m="plexi"]');
  await sleep(250);
  const pressed = await A.p.evaluate(() => ({
    mat: spMat,
    plexiOn: document.querySelector('.sp-mat button[data-m="plexi"]').getAttribute('aria-pressed'),
    tempOn: document.querySelector('.sp-mat button[data-m="tempered"]').getAttribute('aria-pressed')
  }));
  ok('the toggle picks the pile', pressed.mat === 'plexi' && pressed.plexiOn === 'true' && pressed.tempOn === 'false',
     JSON.stringify(pressed));
  /* and the size list is shapes, not shapes doubled per material */
  const opts = await A.p.evaluate(() => [...document.querySelectorAll('#spSize option')].map(o => o.value));
  ok('the size list is not doubled by material', opts.every(v => v === '__other' || v.split('|').length === 3),
     JSON.stringify(opts.slice(0, 3)));
  await A.p.click('.sp-mat button[data-m="tempered"]');
  await sleep(200);
}

/* ---------------- plexi patches, it does not cover ---------------- */
{
  /* A 57.5" pane with plexi on the shelf but no glass: still to order, and the
     card says a patch is possible rather than pretending it is covered. */
  await move(A.p, 57.5, 75, '5/8"', 2, '', 'plexi');
  const pid = await A.p.evaluate(() => {
    const p = GLASS.find(x => x.width_in === 57.5);
    set(p.id, { status: 'replace' }, true);
    return p.id;
  });
  await sleep(500);
  const cov = await A.p.evaluate(i => {
    const c = coverage(), r = c.rows.find(x => x.p.id === i);
    return { covered: r.covered, patch: r.patch, toOrder: c.toOrder, patchable: c.patchable };
  }, pid);
  ok('plexi does not count as cover', cov.covered === false, JSON.stringify(cov));
  ok('but it is reported as a patch', cov.patch === true, JSON.stringify(cov));
  ok('and the pane still has to be ordered', cov.toOrder >= 1, String(cov.toOrder));

  /* Fitting the plexi takes a plexi sheet, not a pane of glass. */
  const before = { t: await stock(A.p, 57.5, 75, '5/8"', 'tempered'),
                   x: await stock(A.p, 57.5, 75, '5/8"', 'plexi') };
  await A.p.evaluate(i => set(i, { status: 'plexi' }, true), pid);
  await sleep(500);
  const afterPlexi = { t: await stock(A.p, 57.5, 75, '5/8"', 'tempered'),
                       x: await stock(A.p, 57.5, 75, '5/8"', 'plexi') };
  ok('marking a pane as plexi takes a plexi sheet', afterPlexi.x === before.x - 1, JSON.stringify(afterPlexi));
  ok('and leaves the glass alone', afterPlexi.t === before.t, JSON.stringify(afterPlexi));

  /* Then the real pane arrives and goes in: that is the tempered one. */
  await move(A.p, 57.5, 75, '5/8"', 1, 'the real one', 'tempered');
  await A.p.evaluate(i => set(i, { status: 'ok' }, true), pid);
  await sleep(500);
  const done = { t: await stock(A.p, 57.5, 75, '5/8"', 'tempered'),
                 x: await stock(A.p, 57.5, 75, '5/8"', 'plexi') };
  ok('and putting glass back takes the tempered one', done.t === 0, JSON.stringify(done));
  ok('leaving the plexi where it was', done.x === afterPlexi.x, JSON.stringify(done));
}

/* ---------------- and the order list itself ---------------- */
{
  const D = await device(b, { acceptDownloads: true });
  await D.p.goto(B + '/glass.html'); await signIn(D.p); await sleep(3000);
  const dl = D.p.waitForEvent('download', { timeout: 8000 });
  await D.p.click('#csv');
  const file = await dl;
  const fs = require('fs');
  const path = await file.path();
  const csv = fs.readFileSync(path, 'utf8');
  ok('the order list says where each piece comes from', /"Source"/.test(csv), csv.split('\r\n')[0]);
  ok('and marks one as coming off the shelf', /"From stock"/.test(csv));
  ok('and finishes with the per-size arithmetic', /"To order"/.test(csv) && /"In stock"/.test(csv));
  await D.ctx.close();
}

/* ---------------- stock belongs to the building, not the sheet ---------------- */
/* Conway's panels are bound to a sheet; its spares are not. Adding a second
   surface to the same facility must not split the shelf. */
{
  const sheets2 = await A.p.evaluate(() => Object.keys(sheets).length);
  const fac = await A.p.evaluate(() => activeFacilityId());
  ok('the shelf is keyed by facility, not by sheet',
     await A.p.evaluate(f => Object.values(SPARES).filter(m => m && !m.deleted).every(m => m.fac === f), fac),
     'sheets seen: ' + sheets2);
}

await b.close();
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
