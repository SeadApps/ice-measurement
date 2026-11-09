/* Glass at a rink that is not Conway.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/glassscopetest.js

   Conway's glass is compiled into the program and was the fallback drawing for any sheet with no glass of its own, so a
   Manager at another rink opened Glass and saw Conway's 127 panels. A sheet with no glass now shows an empty state with a
   way to the Builder, and only an Admin's device binds Conway's glass to a surface (a Manager's own sheet is not Conway). */
const k = require('./shellkit');
const { ok, sleep, B } = k;

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'admin', code: 'pete-code-1' });
await k.addStaff({ id: 'gwen', name: 'Gwen', role: 'manager', code: 'gwen-code-1', facilities: ['f2'] });
const b = await k.chromium.launch();
const errs = [];

const open = async (hash, who, code) => {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  !! pageerror: ' + String(e).split('\n')[0]));
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/i.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '/glass.html#/f/' + hash);
  await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
  await p.waitForSelector('.sync-gate .sync-name[data-id="' + who + '"]'); await p.click('.sync-gate .sync-name[data-id="' + who + '"]');
  await p.fill('.sync-gate #sg-personal', code); await p.click('.sync-gate .sync-go');
  await p.waitForSelector('#shellbar .nav'); await sleep(3000);
  return { ctx, p };
};
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && !!(e.offsetWidth || e.offsetHeight); }, sel);

/* ---- a Manager scoped to Flynn, on a sheet with no glass ---- */
{
  const M = await open('f2/s/s2/rink', 'gwen', 'gwen-code-1'); const p = M.p;
  ok('the empty state is shown, naming the facility', await vis(p, '#noGlass') && /Flynn Rink/.test(await p.textContent('#noGlassName')));
  ok('Conway\'s plan, schedule and size strip are not', !(await vis(p, '#planCard')) && !(await vis(p, '.specstrip')) && !(await vis(p, '.grid')));
  ok('Conway\'s glass is not bound to her sheet', await p.evaluate(() => boundSheetId === null));
  ok('no glass binding was sent to the server', !(await k.rows()).some(r => r.kind === 'glass_binding'));
  await p.click('#noGlassBuild'); await sleep(800);
  ok('Open the Builder goes to the Builder, and the empty state steps aside', await p.evaluate(() => document.getElementById('glassWrap').dataset.page === 'build') && !(await vis(p, '#noGlass')));
  await M.ctx.close();
}
/* ---- an Admin: Conway's own glass is still Conway's, a sheet with none is empty ---- */
{
  const A = await open('f1/s/s1/rink', 'pete', 'pete-code-1'); const p = A.p;
  ok('Conway\'s sheet draws Conway\'s glass for an Admin', await vis(p, '#planCard') && !(await vis(p, '#noGlass')) && await p.evaluate(() => GLASS.length === 127));
  ok('and the Admin\'s device binds it to that sheet', await p.evaluate(() => boundSheetId === 's1'));
  await p.goto(B + '/glass.html#/f/f2/s/s2/rink'); await sleep(2500);
  ok('another rink\'s sheet with no glass is empty for an Admin too', await vis(p, '#noGlass') && !(await vis(p, '#planCard')));
  await p.click('#glassTabs [data-page="inventory"]'); await sleep(1000);
  ok('its Inventory tab stays on the address of that sheet, not Conways', /#\/f\/f2\/s\/s2\/inventory/.test(await p.evaluate(() => location.hash)), await p.evaluate(() => location.hash));
  ok('and is the stock of that arena, with no flagged glass of Conways wanted', /Flynn Rink/.test(await p.textContent('#spWhere')) && await p.evaluate(() => coverage().rows.length === 0));
  /* stock added here belongs to Flynn, not to Conway, whichever glass this device happens to be drawing */
  await p.evaluate(() => { addMovement(43, 75, '1/2"', 'tempered', 5, 'count'); store(); spares(); }); await sleep(2500);
  const mv = (await k.rows()).filter(r => r.kind === 'glass_spare' && !r.deleted);
  ok('stock added on the test sheet belongs to Flynn on the server, and none of it to Conway', mv.length === 1 && mv[0].body.fac === 'f2' && mv[0].facility_id === 'f2', JSON.stringify(mv.map(r => [r.body.fac, r.facility_id])));
  ok('and the Inventory page shows it', /5/.test(await p.textContent('#spStock')));
  await p.goto(B + '/glass.html#/f/f1/s/s1/inventory'); await sleep(2500);
  const cw = await p.evaluate(() => [Object.keys(stockOf('f1')).length, Object.keys(stockOf('f2')).length, activeFacilityId(), document.getElementById('spWhere').textContent]);
  ok('Conway Inventory does not hold it', cw[0] === 0 && cw[1] === 1 && /Conway/.test(cw[3]), JSON.stringify(cw));
  await A.ctx.close();
}
ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
