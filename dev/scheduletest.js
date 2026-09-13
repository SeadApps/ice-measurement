/* The panel schedule says what it is for.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/scheduletest.js

   The table is the parts list you order replacement glass from, and it used to
   open on all 127 rows of which 125 said GOOD - so the two that mattered were
   buried and the card read as an inventory dump. It opens on what needs
   attention now, says so, and offers the way back.

   The load-bearing check is the print one. Rows out of view are hidden rather
   than left out of the DOM precisely so the printed sheet can still carry all
   127 - it is the reference document somebody walks the boards with, and a
   printout that quietly followed the screen would have become two rows the day
   this shipped. Nothing on screen would have shown that.
*/
const { chromium } = require('playwright');

const B = 'http://localhost:8200';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x && !c ? '   [' + x + ']' : '')); };

/* What the table is actually showing, as opposed to what it has rendered. */
const VIS = () => {
  const rows = [...document.querySelectorAll('#tb tr[data-id]')];
  const shown = rows.filter(r => r.offsetParent !== null);
  return {
    rendered: rows.length,
    shown: shown.length,
    ids: shown.map(r => r.dataset.id),
    groups: [...document.querySelectorAll('#tb tr.grp')].filter(r => r.offsetParent !== null).length,
    scope: (document.getElementById('scopeText') || {}).textContent || '',
    toggle: (document.getElementById('scopeToggle') || {}).textContent || '',
    dimmed: document.querySelectorAll('.pnl.dim').length,
    none: (document.querySelector('#tb tr.none td') || {}).textContent || null
  };
};

const open = async b => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.__SYNC_CONFIG__ = { url: 'http://localhost:8200', anon: 'test', email: 'x@y.z' }; });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
  await p.goto(B + '/glass.html');
  await sleep(1700);
  await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));
  await sleep(400);
  return { ctx, p, errs };
};

(async () => {
const b = await chromium.launch();

/* ---------------- it says what it is ---------------- */
{
  const { ctx, p, errs } = await open(b);

  const hd = await p.evaluate(() => ({
    sub: (document.querySelector('.sched-sub') || {}).textContent || null,
    csvInScope: !!document.querySelector('.scopebar #csv'),
    csvInTools: !!document.querySelector('.tools #csv'),
    recordBtns: ['save', 'load', 'print'].every(id => !!document.querySelector('.tools #' + id))
  }));
  ok('the card says what the table is for', !!hd.sub && /order/i.test(hd.sub), hd.sub);
  /* The order list is the reason the table exists, so it sits with the line
     describing what you are looking at rather than as a fourth way to get a
     file out of the page. */
  ok('the order list sits with the scope, not the file buttons', hd.csvInScope && !hd.csvInTools);
  ok('save / load / print stay together', hd.recordBtns);

  /* ---------------- it opens on what needs attention ---------------- */
  const load = await p.evaluate(VIS);
  ok('every panel is still rendered', load.rendered === 127, String(load.rendered));
  ok('but it opens on the flagged ones only', load.shown === 2, load.shown + ' shown: ' + load.ids.join(','));
  ok('and they are the two Conway has', load.ids.join(',') === '069,082', load.ids.join(','));
  ok('the scope line says so', /Showing\s*2\s*of\s*127/.test(load.scope.replace(/\s+/g, ' ')), load.scope);
  ok('and offers the way back', /Show all 127/.test(load.toggle), load.toggle);
  ok('the plan dims the rest', load.dimmed === 125, String(load.dimmed));

  /* What you see is what the order list will contain: the default scope uses
     the same predicate the CSV exports on, so the two cannot drift apart. */
  const same = await p.evaluate(() => {
    const flagged = GLASS.filter(x => st(x.id) !== 'ok').map(x => x.id).sort().join(',');
    const onScreen = [...document.querySelectorAll('#tb tr[data-id]')]
      .filter(r => r.offsetParent !== null).map(r => r.dataset.id).sort().join(',');
    return { flagged, onScreen };
  });
  ok('what is shown is exactly what the order list exports', same.flagged === same.onScreen,
     same.onScreen + ' vs ' + same.flagged);

  /* ---------------- print is the reference document ---------------- */
  await p.emulateMedia({ media: 'print' });
  await sleep(300);
  const pr = await p.evaluate(VIS);
  ok('print carries all 127 while the screen shows 2', pr.shown === 127, String(pr.shown));
  ok('print carries every section header', pr.groups === 5, String(pr.groups));
  ok('print drops the scope bar', await p.evaluate(() => {
    const s = document.querySelector('.scopebar');
    return !s || s.offsetParent === null;
  }));
  await p.emulateMedia({ media: 'screen' });
  await sleep(250);

  /* ---------------- the way back, and the tiles ---------------- */
  await p.click('#scopeToggle'); await sleep(350);
  const all = await p.evaluate(VIS);
  ok('show all reveals every panel', all.shown === 127, String(all.shown));
  ok('and every section header', all.groups === 5, String(all.groups));
  ok('the scope line follows', /All\s*127/.test(all.scope.replace(/\s+/g, ' ')), all.scope);
  ok('the toggle flips back', /needs attention \(2\)/.test(all.toggle), all.toggle);
  ok('nothing is dimmed when showing all', all.dimmed === 0, String(all.dimmed));

  await p.click('.tile[data-f="replace"]'); await sleep(350);
  const tile = await p.evaluate(VIS);
  ok('a status tile still filters', tile.shown === 1 && tile.ids[0] === '082', tile.ids.join(','));
  ok('and the scope line names it', /needing replacement/.test(tile.scope), tile.scope);
  ok('the plan agrees with the table', tile.dimmed === 126, String(tile.dimmed));

  /* ---------------- search ---------------- */
  await p.click('.tile[data-f="all"]'); await sleep(200);
  await p.fill('#q', '43'); await sleep(350);
  const q = await p.evaluate(VIS);
  ok('search narrows the table', q.shown > 0 && q.shown < 127, String(q.shown));
  ok('and the scope line quotes it', /matching/.test(q.scope) && q.scope.indexOf('43') >= 0, q.scope);
  await p.emulateMedia({ media: 'print' }); await sleep(300);
  ok('print still carries all 127 during a search', (await p.evaluate(VIS)).shown === 127);
  await p.emulateMedia({ media: 'screen' });
  await p.fill('#q', ''); await sleep(300);

  ok('nothing threw', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ---------------- clearing the last flagged panel ---------------- */
/* Scoped to what needs attention, marking the last one good empties the table.
   "No panels match" is the wrong words for having just fixed the lot. */
{
  const { ctx, p, errs } = await open(b);
  await p.evaluate(() => { filter = 'flagged'; table(); paint(); });
  await sleep(200);
  await p.evaluate(() => { set('069', { status: 'ok' }); set('082', { status: 'ok' }); });
  await sleep(500);
  const cleared = await p.evaluate(VIS);
  ok('the table empties when nothing is flagged', cleared.shown === 0, String(cleared.shown));
  ok('and says so in the right words', /nothing needs attention/i.test(cleared.none || ''), cleared.none);
  ok('the way back is still offered', /Show all 127/.test(cleared.toggle), cleared.toggle);

  /* And a rink with nothing flagged should not open scoped to an empty list. */
  await p.reload(); await sleep(1700);
  await p.evaluate(() => document.querySelectorAll('.sync-gate').forEach(e => e.remove()));
  await sleep(400);
  const fresh = await p.evaluate(VIS);
  ok('a rink with nothing flagged opens on all of them', fresh.shown === 127, String(fresh.shown));
  ok('and the scope line says all', /All\s*127/.test(fresh.scope.replace(/\s+/g, ' ')), fresh.scope);
  ok('nothing threw', errs.length === 0, errs[0]);
  await ctx.close();
}

await b.close();
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
