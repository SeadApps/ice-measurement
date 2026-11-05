/* The flow chart as a test.

   Run the fake Supabase first:  node dev/fake-supabase.js &
   then:                         node dev/navtest.js

   dev/navdata.js is the flow chart's access table as data. For each device width (390, 820, 1024, 1280) and
   each role, every page is opened by its address and must be what the table says: open, open but view only,
   open but showing the "use a phone or tablet" message (the builders on a laptop), or refused. Pages the
   chart has and a later phase builds are listed with built:false and are skipped until then. */
const k = require('./shellkit');
const { ok, sleep, B } = k;
const { DEVICES, PAGES } = require('./navdata');

(async () => {
await fetch(B + '/__reset');
await k.seed();
await k.addStaff({ id: 'pete', name: 'Pete', role: 'management', code: 'pete-code-1' });
await k.addStaff({ id: 'dana', name: 'Dana', role: 'staff', code: 'dana-code-1', facilities: ['f1', 'f2'] });
const b = await k.chromium.launch();
const errs = [];
const PEOPLE = { mgmt: ['pete', 'pete-code-1'], staff: ['dana', 'dana-code-1'] };

for (const dev of Object.keys(DEVICES)) {
  for (const role of ['mgmt', 'staff']) {
    const ctx = await b.newContext({ viewport: { width: DEVICES[dev], height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(c => { window.__SYNC_CONFIG__ = c; }, { url: B, anon: 'test' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(dev + ' ' + role + ': ' + String(e).split('\n')[0]));
    await p.goto(B + '/index.html#/');
    await p.waitForSelector('.sync-gate #sg-code'); await p.fill('.sync-gate #sg-code', k.ACCESS); await p.click('.sync-gate button');
    await p.waitForSelector('.sync-gate .sync-name[data-id="' + PEOPLE[role][0] + '"]'); await p.click('.sync-gate .sync-name[data-id="' + PEOPLE[role][0] + '"]');
    await p.fill('.sync-gate #sg-personal', PEOPLE[role][1]); await p.click('.sync-gate .sync-go');
    await sleep(3000);
    const vis = sel => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);

    for (const pg of PAGES) {
      if (pg.built === false) continue;
      const dv = pg[dev], rl = pg[role];
      const want = (!dv || !rl) ? 'refused' : dv === 'message' ? 'message' : rl === 'view' ? 'view' : 'open';
      await p.goto(B + pg.url); await sleep(2200);
      if (pg.open) { await p.click(pg.open).catch(() => {}); await sleep(500); }
      const seen = await vis(pg.probe);
      const msg = pg.msg ? await vis(pg.msg) : false;
      const inert = await p.evaluate(s => { const e = document.querySelector(s); return !e || !!e.closest('[inert]') || e.getClientRects().length === 0; }, pg.probe);
      const viewOnly = await p.evaluate(() => {
        const v = document.getElementById('viewOnly'), r = document.getElementById('prefRo');
        return !!((v && v.getClientRects().length) || (r && r.getClientRects().length));
      });
      let good, got;
      if (want === 'open') { good = seen && !msg; got = seen ? 'open' : 'not there'; }
      else if (want === 'view') { good = seen && viewOnly; got = seen ? (viewOnly ? 'view' : 'editable') : 'not there'; }
      else if (want === 'message') { good = msg && inert; got = msg ? (inert ? 'message' : 'message, still usable') : 'no message'; }
      else { good = !seen; got = seen ? 'open' : 'refused'; }
      ok(dev + ' (' + DEVICES[dev] + 'px) ' + role + ': ' + pg.id + ' is ' + want, good, 'was ' + got);
    }
    await ctx.close();
  }
}
ok('nothing threw anywhere', errs.length === 0, errs.slice(0, 3).join(' | '));
await k.done(b);
})();
